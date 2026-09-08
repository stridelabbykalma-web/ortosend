// Confirmación a mano desde el asistente: «este escaneo de la bandeja es de
// este paciente». Hace falta cuando llegó sin nadie esperando o con varios
// casos abiertos a la vez en la clínica.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { asociarEscaneo } from "@/lib/escaneos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireRole("PROFESIONAL", "ADMIN_CLINICA");
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  let body: { uploadId?: unknown; caseId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  const upload = await prisma.scanUpload.findUnique({ where: { id: String(body.uploadId ?? "") } });
  if (!upload || upload.clinicId !== user.clinicId || upload.status !== "recibido")
    return NextResponse.json({ error: "Escaneo desconocido" }, { status: 404 });
  try {
    const r = await asociarEscaneo(upload, String(body.caseId ?? ""), {
      clinicId: user.clinicId!,
      name: user.name,
      userId: user.id,
      agentId: null,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo asociar" }, { status: 409 });
  }
}
