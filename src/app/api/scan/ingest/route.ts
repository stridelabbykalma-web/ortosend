// Modo «servidor» (sin R2): el escaneo viene entero en la petición y se guarda
// en Postgres. Vale para desarrollo y clínicas con archivos pequeños; en
// Vercel la petición se corta en ~4,5 MB. GET es el saludo del puente al
// arrancar (comprueba el token y sabe en qué modo trabajar).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorOf, autoasociar } from "@/lib/escaneos";
import { SCAN_EXTS, SCAN_MIME, SCAN_SERVER_MAX_BYTES, fmtMB, safeFilename, scanExt } from "@/lib/scan";
import { r2Configured } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actor = await actorOf(req);
  if (!actor) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const clinic = await prisma.clinic.findUnique({ where: { id: actor.clinicId } });
  return NextResponse.json({
    ok: true,
    clinica: clinic?.name ?? "",
    modo: r2Configured() ? "directo" : "servidor",
    extensiones: SCAN_EXTS,
    maxBytes: r2Configured() ? null : SCAN_SERVER_MAX_BYTES,
  });
}

export async function POST(req: Request) {
  const actor = await actorOf(req);
  if (!actor) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  const nombre = safeFilename(String(form.get("nombre") || file.name || ""));
  const ext = scanExt(nombre);
  if (!ext) return NextResponse.json({ error: `Formato de escaneo no admitido (${nombre})` }, { status: 415 });
  if (file.size === 0 || file.size > SCAN_SERVER_MAX_BYTES)
    return NextResponse.json(
      { error: `Sin R2 configurado el escaneo debe ocupar como máximo ${fmtMB(SCAN_SERVER_MAX_BYTES)}` },
      { status: 413 }
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Comprimido en origen: «bytes» es el tamaño original que declara el cliente.
  const encoding = String(form.get("encoding") ?? "") === "gzip" ? "gzip" : null;
  const original = encoding ? Number(form.get("bytes")) : bytes.length;
  const upload = await prisma.scanUpload.create({
    data: {
      clinicId: actor.clinicId,
      agentId: actor.agentId,
      uploadedBy: actor.name,
      filename: nombre,
      mime: SCAN_MIME[ext],
      sizeBytes: Number.isInteger(original) && original > 0 ? original : bytes.length,
      encoding,
      storedBytes: bytes.length,
      storage: "db",
      bytes,
      status: "recibido",
      receivedAt: new Date(),
    },
  });
  const asociado = await autoasociar(upload, actor);
  return NextResponse.json({ ok: true, uploadId: upload.id, caso: asociado?.caso ?? null, paciente: asociado?.paciente ?? null });
}
