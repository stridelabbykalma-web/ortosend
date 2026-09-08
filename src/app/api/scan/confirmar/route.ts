// Paso 2 de la subida directa: el archivo ya está en R2. El servidor comprueba
// que existe con el tamaño anunciado, lo da por recibido y lo asocia al caso
// que está esperando (o lo deja en la bandeja de la clínica).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorOf, autoasociar } from "@/lib/escaneos";
import { objectSize } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const actor = await actorOf(req);
  if (!actor) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  let body: { uploadId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const upload = await prisma.scanUpload.findUnique({ where: { id: String(body.uploadId ?? "") } });
  if (!upload || upload.clinicId !== actor.clinicId || upload.storage !== "r2" || !upload.key)
    return NextResponse.json({ error: "Subida desconocida" }, { status: 404 });
  if (upload.status === "recibido")
    return NextResponse.json({ ok: true, caso: null, paciente: null, repetido: true });

  const size = await objectSize(upload.key);
  if (size === null) return NextResponse.json({ error: "El archivo no ha llegado al almacén" }, { status: 409 });
  const esperado = upload.storedBytes ?? upload.sizeBytes;
  if (size !== esperado)
    return NextResponse.json({ error: `El archivo llegó incompleto (${size} de ${esperado} bytes)` }, { status: 409 });

  const recibido = await prisma.scanUpload.update({
    where: { id: upload.id },
    data: { status: "recibido", receivedAt: new Date() },
  });
  const asociado = await autoasociar(recibido, actor);
  return NextResponse.json({ ok: true, caso: asociado?.caso ?? null, paciente: asociado?.paciente ?? null });
}
