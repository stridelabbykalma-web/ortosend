// Subida real de capturas del estudio (vídeos del protocolo y fotos clínicas).
// El check verde de la checklist solo existe cuando esta ruta confirma y
// persiste el archivo (prototipo: Postgres; producción: R2/S3 por fragmentos).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { audit, pushEvent } from "@/lib/cases";
import { MEDIA_LABEL, FOTO_KINDS, VIDEO_KINDS } from "@/lib/format";
import { CAPTURE_GUIDES } from "@/lib/capture-guide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = ["video/webm", "video/mp4", "image/jpeg", "image/png"];
const UPLOAD_KINDS: string[] = [...VIDEO_KINDS.map(([k]) => k), ...FOTO_KINDS.map(([k]) => k)];

export async function POST(req: Request) {
  let user;
  try {
    user = await requireRole("PROFESIONAL", "ADMIN_CLINICA");
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!user.clinicId)
    return NextResponse.json({ error: "Usuario sin clínica asignada" }, { status: 403 });

  const form = await req.formData();
  const caseId = String(form.get("caseId") ?? "");
  const kind = String(form.get("kind") ?? "");
  const file = form.get("file");

  if (!UPLOAD_KINDS.includes(kind))
    return NextResponse.json({ error: "Elemento de captura desconocido" }, { status: 400 });
  if (!(file instanceof File))
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  const mime = file.type.split(";")[0];
  if (!ALLOWED_MIME.includes(mime))
    return NextResponse.json({ error: `Formato no admitido (${mime || "desconocido"})` }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES)
    return NextResponse.json(
      { error: "El archivo debe ocupar entre 1 byte y 4 MB" },
      { status: 413 }
    );

  const kase = await prisma.case.findUnique({ where: { id: caseId }, include: { capture: true } });
  if (!kase || kase.clinicId !== user.clinicId)
    return NextResponse.json({ error: "Caso no accesible" }, { status: 404 });
  if (!["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"].includes(kase.state))
    return NextResponse.json({ error: "El estudio no está en curso" }, { status: 409 });

  const capture =
    kase.capture ?? (await prisma.capture.create({ data: { caseId } }));
  if (kase.state === "CITA_RESERVADA") {
    await prisma.case.update({ where: { id: caseId }, data: { state: "ESTUDIO_EN_CURSO" } });
    await pushEvent(caseId, "Estudio iniciado en clínica", user.name);
  }

  // Solo se guardan métricas conocidas del estudio de captura, nunca JSON arbitrario.
  let meta: object | undefined;
  try {
    const raw = JSON.parse(String(form.get("meta") ?? "null"));
    if (raw && typeof raw === "object")
      meta = {
        seconds: typeof raw.seconds === "number" ? raw.seconds : undefined,
        targetSeconds: typeof raw.targetSeconds === "number" ? raw.targetSeconds : undefined,
        validPct: typeof raw.validPct === "number" ? raw.validPct : undefined,
        validSeconds: typeof raw.validSeconds === "number" ? raw.validSeconds : undefined,
        minValidSeconds: typeof raw.minValidSeconds === "number" ? raw.minValidSeconds : undefined,
        mime,
        pose: typeof raw.pose === "string" ? raw.pose.slice(0, 40) : undefined,
      };
  } catch {
    // meta inválida: se ignora
  }

  // Umbral de calidad del protocolo: si el análisis de pose funcionó, el clip
  // debe acumular el tiempo mínimo con encuadre válido (misma regla que el estudio).
  const guide = CAPTURE_GUIDES[kind];
  const m = meta as { validSeconds?: number; pose?: string } | undefined;
  if (
    guide?.minValidSeconds &&
    m?.pose === "pose_landmarker_lite" &&
    typeof m.validSeconds === "number" &&
    m.validSeconds < guide.minValidSeconds
  )
    return NextResponse.json(
      {
        error: `Solo ${m.validSeconds} s con encuadre válido; el protocolo exige ${guide.minValidSeconds} s. Repite la grabación.`,
      },
      { status: 422 }
    );

  const bytes = new Uint8Array(await file.arrayBuffer());
  const asset = await prisma.$transaction(async (tx) => {
    const existing = await tx.mediaAsset.findFirst({ where: { captureId: capture.id, kind } });
    let assetId: string;
    if (existing) {
      await tx.mediaBlob.deleteMany({ where: { mediaId: existing.id } });
      assetId = existing.id;
    } else {
      const created = await tx.mediaAsset.create({
        data: { captureId: capture.id, kind, url: "" },
      });
      assetId = created.id;
    }
    await tx.mediaBlob.create({ data: { mediaId: assetId, mime, bytes } });
    return tx.mediaAsset.update({
      where: { id: assetId },
      data: {
        url: `/api/media/${assetId}`,
        sizeBytes: bytes.length,
        meta,
        confirmedAt: new Date(), // confirmación real del servidor → check verde
      },
    });
  });

  await pushEvent(
    caseId,
    `Captura subida y confirmada: ${MEDIA_LABEL[kind] ?? kind}`,
    user.name
  );
  await audit(user.id, "media.upload", `case:${kase.number}:${kind}`);
  return NextResponse.json({ ok: true, id: asset.id, url: asset.url });
}
