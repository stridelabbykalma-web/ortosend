// Paso 1 de la subida directa: el puente (o el navegador) dice qué archivo va
// a subir y el servidor le devuelve una URL firmada de R2 para dejarlo allí
// sin pasar por aquí (sin límite de tamaño). Si R2 no está configurado, se
// le indica que lo mande por /api/scan/ingest (modo servidor).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorOf } from "@/lib/escaneos";
import { SCAN_MIME, SCAN_SERVER_MAX_BYTES, safeFilename, safeLabel, scanExt } from "@/lib/scan";
import { presignPut, r2Configured } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actor = await actorOf(req);
  if (!actor) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  let body: { nombre?: unknown; bytes?: unknown; encoding?: unknown; storedBytes?: unknown; proyecto?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const nombre = safeFilename(String(body.nombre ?? ""));
  const bytes = Number(body.bytes);
  const ext = scanExt(nombre);
  if (!ext) return NextResponse.json({ error: `Formato de escaneo no admitido (${nombre})` }, { status: 415 });
  if (!Number.isInteger(bytes) || bytes <= 0)
    return NextResponse.json({ error: "Tamaño del archivo desconocido" }, { status: 400 });
  // Comprimido con gzip en origen: se almacena tal cual (ocupa menos) y se
  // sirve con Content-Encoding, así que el taller recibe el mesh original.
  const encoding = body.encoding === "gzip" ? "gzip" : null;
  const storedBytes = encoding ? Number(body.storedBytes) : bytes;
  if (!Number.isInteger(storedBytes) || storedBytes <= 0)
    return NextResponse.json({ error: "Tamaño comprimido desconocido" }, { status: 400 });

  if (!r2Configured())
    return NextResponse.json({
      ok: true,
      modo: "servidor",
      maxBytes: SCAN_SERVER_MAX_BYTES,
      aviso: "R2 no configurado: el archivo pasa por el servidor, con su límite de tamaño",
    });

  const mime = SCAN_MIME[ext];
  const upload = await prisma.scanUpload.create({
    data: {
      clinicId: actor.clinicId,
      agentId: actor.agentId,
      uploadedBy: actor.name,
      filename: nombre,
      label: safeLabel(body.proyecto),
      mime,
      sizeBytes: bytes,
      encoding,
      storedBytes,
      storage: "r2",
      status: "pendiente",
    },
  });
  const key = `escaneos/${actor.clinicId}/${upload.id}/${nombre}`;
  await prisma.scanUpload.update({ where: { id: upload.id }, data: { key } });
  const url = await presignPut(key, mime, storedBytes, encoding);
  const headers: Record<string, string> = { "Content-Type": mime };
  if (encoding) headers["Content-Encoding"] = encoding;
  return NextResponse.json({ ok: true, modo: "directo", uploadId: upload.id, url, headers });
}
