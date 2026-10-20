// Latido del asistente de captura: cada dispositivo abierto en un estudio avisa
// cada pocos segundos de que sigue ahí y en qué paso va. La respuesta devuelve
// la actividad de los OTROS dispositivos del mismo profesional en ese caso,
// para avisar («se está usando en otro dispositivo») y poder saltar a su paso.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Un dispositivo se considera activo si ha latido en los últimos 90 s.
const ACTIVO_MS = 90 * 1000;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "PROFESIONAL" && user.role !== "ADMIN_CLINICA"))
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  let body: { caseId?: string; deviceId?: string; paso?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "payload no válido" }, { status: 400 });
  }
  const caseId = String(body.caseId ?? "");
  const deviceId = String(body.deviceId ?? "").slice(0, 64);
  const paso = Math.max(0, Math.min(99, Number(body.paso) || 0));
  if (!caseId || !deviceId) return NextResponse.json({ error: "faltan datos" }, { status: 400 });
  const kase = await prisma.case.findUnique({ where: { id: caseId }, select: { clinicId: true } });
  if (!kase || kase.clinicId !== user.clinicId) return NextResponse.json({ error: "no autorizado" }, { status: 403 });

  await prisma.studySession.upsert({
    where: { caseId_userId_deviceId: { caseId, userId: user.id, deviceId } },
    create: { caseId, userId: user.id, deviceId, paso },
    update: { paso, lastSeenAt: new Date() },
  });
  const otro = await prisma.studySession.findFirst({
    where: {
      caseId,
      userId: user.id,
      deviceId: { not: deviceId },
      lastSeenAt: { gt: new Date(Date.now() - ACTIVO_MS) },
    },
    orderBy: { lastSeenAt: "desc" },
  });
  return NextResponse.json(
    otro ? { otro: { paso: otro.paso, haceSegundos: Math.round((Date.now() - otro.lastSeenAt.getTime()) / 1000) } } : { otro: null }
  );
}
