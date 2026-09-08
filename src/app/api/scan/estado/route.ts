// Estado del escaneo de un caso para el asistente de captura: qué carpeta hay
// que elegir en RevoScan y si el archivo ya ha llegado. La pantalla consulta
// esta ruta cada pocos segundos mientras el profesional escanea.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ensureScanCode, puenteActivo } from "@/lib/cases";
import { SCAN_KIND } from "@/lib/format";
import { scanFolder } from "@/lib/scan";

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
    include: { patient: true, capture: { include: { media: true } } },
  });
  if (!kase || kase.clinicId !== user.clinicId)
    return NextResponse.json({ error: "Caso no accesible" }, { status: 404 });

  const code = kase.scanCode ?? (await ensureScanCode(kase.id));
  const scan = kase.capture?.media.find((m) => m.kind === SCAN_KIND && m.confirmedAt);
  const puente = await puenteActivo(user.clinicId);

  return NextResponse.json({
    ok: true,
    code,
    folder: scanFolder(kase.number, code, kase.patient.name),
    paciente: kase.patient.name,
    caso: kase.number,
    hecho: !!scan,
    archivo: (scan?.meta as { archivo?: string } | null)?.archivo ?? null,
    bytes: scan?.sizeBytes ?? null,
    puente,
  });
}
