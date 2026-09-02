import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Sirve una captura subida (foto/vídeo) con el mismo control de acceso que la
// página del caso: clínica del estudio, prescriptor, taller, admin o titular.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; kind: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id: caseId, kind } = await ctx.params;
  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    include: { patient: true, clinic: true, capture: { include: { media: true } } },
  });
  if (!kase) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });

  const isOwner = user.role === "CLIENTE" && kase.patient.ownerId === user.id;
  const isClinicStaff =
    (user.role === "PROFESIONAL" || user.role === "ADMIN_CLINICA") &&
    user.clinicId === kase.clinicId;
  const isRx = user.role === "RECETADOR";
  const isTaller = user.role === "TALLER";
  const isAdmin = user.role === "ADMIN";
  if (!isOwner && !isClinicStaff && !isRx && !isTaller && !isAdmin)
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const media = kase.capture?.media.find((m) => m.kind === kind && m.confirmedAt);
  if (!media?.data)
    return NextResponse.json({ error: "Captura no disponible" }, { status: 404 });

  return new Response(Buffer.from(media.data), {
    headers: {
      "Content-Type": media.mime ?? "application/octet-stream",
      "Content-Length": String(media.data.length),
      "Cache-Control": "private, no-store",
    },
  });
}
