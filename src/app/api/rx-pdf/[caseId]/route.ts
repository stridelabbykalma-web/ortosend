// Descarga del PDF de la prescripción (generado e inmutable desde la firma).
// Acceso: el personal que puede ver el caso (clínica del caso, recetador
// central, taller, admin) con registro en AuditLog; el paciente titular, solo
// con el token de lectura de 10 min (?t=…) que obtiene re-confirmando su
// contraseña, igual que la vista web del documento.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/cases";
import { esCentral } from "@/lib/rx-route";
import { TALLER_STATES } from "@/lib/taller";
import { verifyDocToken } from "@/lib/doc-token";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      clinic: { select: { hasPrescriber: true } },
      patient: { select: { ownerId: true } },
      prescription: { select: { pdfBytes: true, pdfSha256: true, prescriberId: true } },
    },
  });
  if (!kase?.prescription?.pdfBytes) return NextResponse.json({ error: "sin PDF" }, { status: 404 });

  const isOwner = user.role === "CLIENTE" && kase.patient.ownerId === user.id;
  // Mismas ventanas por estado que la ficha del caso: el recetador central
  // mientras valora (o si la receta es suya) y el taller desde que hay pedido.
  const isStaff =
    ((user.role === "PROFESIONAL" || user.role === "ADMIN_CLINICA") && user.clinicId === kase.clinicId) ||
    (user.role === "RECETADOR" &&
      esCentral(kase) &&
      (["EN_PRESCRIPCION", "EN_CONTACTO", "PENDIENTE_PAGO"].includes(kase.state) || kase.prescription.prescriberId === user.id)) ||
    (user.role === "TALLER" && ([...TALLER_STATES, "ENTREGADO", "CERRADO"] as string[]).includes(kase.state)) ||
    user.role === "ADMIN";
  if (isOwner) {
    const t = new URL(request.url).searchParams.get("t") ?? "";
    if (!(await verifyDocToken(t, caseId))) return NextResponse.json({ error: "confirma tu contraseña para descargar" }, { status: 403 });
  } else if (!isStaff) {
    return NextResponse.json({ error: "no autorizado" }, { status: 403 });
  }
  await audit(user.id, "prescription.pdf", `case:${kase.number}`, kase.patientId, { sha256: kase.prescription.pdfSha256 });
  return new NextResponse(Buffer.from(kase.prescription.pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="prescripcion-caso-${kase.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
