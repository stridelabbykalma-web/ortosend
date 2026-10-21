import { prisma } from "@/lib/db";

// Pacientes cuyas invitaciones fueron a ese móvil (el propio paciente o su
// tutor). Tras el traspaso de la cuenta a los 16 años, el móvil del ANTIGUO
// tutor deja de dar acceso: solo cuenta si el móvil es el del propio paciente.
export async function pacientesDelTelefono(phone: string) {
  const lista = await prisma.patient.findMany({
    where: { consentInvitations: { some: { toPhone: phone } }, consentLogs: { some: {} } },
    orderBy: { createdAt: "asc" },
  });
  return lista.filter((p) => !p.handoverAt || p.phone === phone);
}
