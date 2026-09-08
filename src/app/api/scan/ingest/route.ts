// ============================================================
// Ingesta del escaneo — el archivo de RevoScan se asocia solo al paciente
// ============================================================
// El puente local (tools/puente-escaneo) vigila la carpeta donde RevoScan
// guarda los escaneos. Cuando aparece un modelo 3D dentro de una carpeta
// ORT-00123-XXXXXXXX lo sube aquí: el código identifica el caso, y con él
// el paciente. El profesional no renombra nada ni sube nada a mano.
//
//   GET  → saludo del puente: qué carpetas debe tener creadas ahora mismo.
//   POST → un escaneo (multipart: code + file) → MediaAsset del caso.
//
// La misma ruta acepta al profesional con sesión iniciada (respaldo manual
// desde el navegador si la clínica todavía no tiene el puente instalado).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, verifyScanToken } from "@/lib/auth";
import { audit, ensureScanCode, pushEvent } from "@/lib/cases";
import { SCAN_KIND } from "@/lib/format";
import { SCAN_MAX_BYTES, SCAN_MIME, fmtMB, parseScanFolder, scanExt, scanFolder } from "@/lib/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAPTURE_STATES = ["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"] as const;

type Actor = { clinicId: string; name: string; userId: string | null };

// Puente (token firmado) o profesional de la clínica (cookie de sesión).
async function actorOf(req: Request): Promise<Actor | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (token) {
    const agentId = await verifyScanToken(token);
    if (!agentId) return null;
    const agent = await prisma.scanAgent.findUnique({ where: { id: agentId } });
    if (!agent || agent.revokedAt) return null;
    await prisma.scanAgent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });
    return { clinicId: agent.clinicId, name: `${agent.name} (puente)`, userId: null };
  }
  const user = await getSessionUser();
  if (!user || !user.clinicId) return null;
  if (user.role !== "PROFESIONAL" && user.role !== "ADMIN_CLINICA") return null;
  return { clinicId: user.clinicId, name: user.name, userId: user.id };
}

// Carpetas que el puente debe tener creadas: un caso en estudio = una carpeta.
export async function GET(req: Request) {
  const actor = await actorOf(req);
  if (!actor) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const clinic = await prisma.clinic.findUnique({ where: { id: actor.clinicId } });
  const abiertos = await prisma.case.findMany({
    where: { clinicId: actor.clinicId, state: { in: [...CAPTURE_STATES] } },
    include: { patient: true, capture: { include: { media: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const carpetas = [];
  for (const k of abiertos) {
    const code = k.scanCode ?? (await ensureScanCode(k.id));
    carpetas.push({
      caso: k.number,
      folder: scanFolder(k.number, code, k.patient.name),
      // Ya recibido: el puente deja de esperar archivos de esta carpeta.
      hecho: !!k.capture?.media.some((m) => m.kind === SCAN_KIND && m.confirmedAt),
    });
  }
  return NextResponse.json({
    ok: true,
    clinica: clinic?.name ?? "",
    extensiones: Object.keys(SCAN_MIME),
    maxBytes: SCAN_MAX_BYTES,
    carpetas,
  });
}

export async function POST(req: Request) {
  const actor = await actorOf(req);
  if (!actor) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const form = await req.formData();
  // El puente manda la ruta entera del archivo; el navegador, solo el código.
  const ref = String(form.get("code") ?? form.get("path") ?? "");
  const file = form.get("file");
  const parsed = parseScanFolder(ref);
  if (!parsed)
    return NextResponse.json(
      { error: "La carpeta no lleva un código de caso de Ortosend (ORT-00000-XXXXXXXX)" },
      { status: 400 }
    );
  if (!(file instanceof File)) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  const nombre = String(form.get("nombre") || file.name || "escaneo");
  const ext = scanExt(nombre);
  if (!ext)
    return NextResponse.json(
      { error: `Formato de escaneo no admitido (${nombre.split(".").pop() ?? "sin extensión"})` },
      { status: 415 }
    );
  if (file.size === 0 || file.size > SCAN_MAX_BYTES)
    return NextResponse.json(
      { error: `El escaneo debe ocupar entre 1 byte y ${fmtMB(SCAN_MAX_BYTES)}` },
      { status: 413 }
    );

  const kase = await prisma.case.findUnique({
    where: { scanCode: parsed.code },
    include: { capture: true, patient: true },
  });
  // El número de caso va en el nombre de la carpeta solo para que se lea; si
  // no cuadra con el código, la carpeta se renombró a mano y no se acepta.
  if (!kase || kase.number !== parsed.number)
    return NextResponse.json({ error: "Carpeta desconocida: ningún caso usa ese código" }, { status: 404 });
  if (kase.clinicId !== actor.clinicId)
    return NextResponse.json({ error: "El caso es de otra clínica" }, { status: 403 });
  if (!CAPTURE_STATES.includes(kase.state as (typeof CAPTURE_STATES)[number]))
    return NextResponse.json({ error: "El estudio ya no está en curso" }, { status: 409 });

  const capture = kase.capture ?? (await prisma.capture.create({ data: { caseId: kase.id } }));
  if (kase.state === "CITA_RESERVADA") {
    await prisma.case.update({ where: { id: kase.id }, data: { state: "ESTUDIO_EN_CURSO" } });
    await pushEvent(kase.id, "Estudio iniciado en clínica", actor.name);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = SCAN_MIME[ext];
  const asset = await prisma.$transaction(async (tx) => {
    // Un escaneo por caso: si se repite (segundo intento del molde), sustituye.
    const existing = await tx.mediaAsset.findFirst({ where: { captureId: capture.id, kind: SCAN_KIND } });
    let assetId: string;
    if (existing) {
      await tx.mediaBlob.deleteMany({ where: { mediaId: existing.id } });
      assetId = existing.id;
    } else {
      assetId = (await tx.mediaAsset.create({ data: { captureId: capture.id, kind: SCAN_KIND, url: "" } })).id;
    }
    await tx.mediaBlob.create({ data: { mediaId: assetId, mime, bytes } });
    return tx.mediaAsset.update({
      where: { id: assetId },
      data: {
        url: `/api/media/${assetId}`,
        sizeBytes: bytes.length,
        meta: { mime, archivo: nombre.slice(0, 120), origen: actor.userId ? "navegador" : "puente" },
        confirmedAt: new Date(), // check verde SOLO con confirmación del servidor
      },
    });
  });

  await pushEvent(
    kase.id,
    `Escaneo de las espumas recibido y asociado al paciente: ${nombre} (${fmtMB(bytes.length)})`,
    actor.name
  );
  if (actor.userId) await audit(actor.userId, "media.upload", `case:${kase.number}:${SCAN_KIND}`);

  return NextResponse.json({
    ok: true,
    id: asset.id,
    url: asset.url,
    caso: kase.number,
    paciente: kase.patient.name,
  });
}
