// Lo que consulta el paso del escaneo del asistente cada pocos segundos.
// Cada consulta renueva scanWaitingAt: mientras esta pantalla esté abierta,
// el escaneo que llegue del puente es de este caso. Devuelve los escaneos ya
// asociados, la bandeja de la clínica (por si hay que confirmar a mano) y si
// el puente da señal.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { CAPTURE_STATES, bandejaDe, puenteActivo } from "@/lib/escaneos";
import { SCAN_KIND } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let user;
  try {
    user = await requireRole("PROFESIONAL", "ADMIN_CLINICA");
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const caseId = new URL(req.url).searchParams.get("caseId") ?? "";
  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    include: { patient: true, capture: { include: { media: { where: { kind: SCAN_KIND, confirmedAt: { not: null } } } } } },
  });
  if (!kase || kase.clinicId !== user.clinicId)
    return NextResponse.json({ error: "Caso no accesible" }, { status: 404 });

  if (CAPTURE_STATES.includes(kase.state as (typeof CAPTURE_STATES)[number]))
    await prisma.case.update({ where: { id: caseId }, data: { scanWaitingAt: new Date() } });

  const escaneos = (kase.capture?.media ?? []).map((m) => ({
    id: m.id,
    archivo: (m.meta as { archivo?: string } | null)?.archivo ?? "escaneo",
    bytes: m.sizeBytes ?? 0,
    at: m.confirmedAt,
  }));
  return NextResponse.json({
    ok: true,
    paciente: kase.patient.name,
    caso: kase.number,
    hecho: escaneos.length > 0,
    escaneos,
    bandeja: await bandejaDe(user.clinicId),
    puente: await puenteActivo(user.clinicId),
  });
}
