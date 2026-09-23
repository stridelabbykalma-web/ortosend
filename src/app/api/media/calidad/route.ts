// Foto obligatoria del par en control de calidad: subida real desde el taller.
// Se guarda como captura del caso (kind foto_calidad) y el caso apunta a ella;
// sin esta foto no se aprueba calidad. Se sirve por /api/media/[id] con el
// mismo control de acceso que el resto de capturas.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { audit, pushEvent } from "@/lib/cases";
import { QC_KIND } from "@/lib/taller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

export async function POST(req: Request) {
  let user;
  try {
    user = await requireRole("TALLER", "ADMIN");
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const form = await req.formData();
  const caseId = String(form.get("caseId") ?? "");
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Falta la foto" }, { status: 400 });
  const mime = file.type.split(";")[0];
  if (!ALLOWED_MIME.includes(mime))
    return NextResponse.json({ error: `Formato no admitido (${mime || "desconocido"})` }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES)
    return NextResponse.json({ error: "La foto debe ocupar entre 1 byte y 4 MB" }, { status: 413 });

  const kase = await prisma.case.findUnique({ where: { id: caseId }, include: { capture: true } });
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
  if (kase.state !== "CALIDAD")
    return NextResponse.json({ error: "El caso no está en control de calidad" }, { status: 409 });

  const capture = kase.capture ?? (await prisma.capture.create({ data: { caseId } }));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const asset = await prisma.$transaction(async (tx) => {
    const existing = await tx.mediaAsset.findFirst({ where: { captureId: capture.id, kind: QC_KIND } });
    let assetId: string;
    if (existing) {
      await tx.mediaBlob.deleteMany({ where: { mediaId: existing.id } });
      assetId = existing.id;
    } else {
      const created = await tx.mediaAsset.create({ data: { captureId: capture.id, kind: QC_KIND, url: "" } });
      assetId = created.id;
    }
    await tx.mediaBlob.create({ data: { mediaId: assetId, mime, bytes } });
    const a = await tx.mediaAsset.update({
      where: { id: assetId },
      data: { url: `/api/media/${assetId}`, sizeBytes: bytes.length, meta: { mime }, confirmedAt: new Date() },
    });
    await tx.case.update({ where: { id: caseId }, data: { qcPhotoUrl: a.url } });
    return a;
  });

  await pushEvent(caseId, "Foto del par adjuntada en control de calidad", user.name);
  await audit(user.id, "media.upload", `case:${kase.number}:${QC_KIND}`);
  return NextResponse.json({ ok: true, id: asset.id, url: asset.url });
}
