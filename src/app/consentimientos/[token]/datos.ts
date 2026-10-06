import { prisma } from "@/lib/db";

// Pacientes cuyas invitaciones fueron a ese móvil (el propio paciente o su tutor).
export function pacientesDelTelefono(phone: string) {
  return prisma.patient.findMany({
    where: { consentInvitations: { some: { toPhone: phone } }, consentLogs: { some: {} } },
    orderBy: { createdAt: "asc" },
  });
}
