// ManyChat no permite buscar un contacto de WhatsApp por su número, así que reutilizamos el
// contacto que ya conocemos de altas anteriores de ese móvil (el webhook lo guarda en la invitación).
import { prisma } from "./db";

export async function subscriberConocido(telefono: string): Promise<string | null> {
  const inv = await prisma.consentInvitation.findFirst({
    where: { toPhone: telefono, manychatSubscriberId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { manychatSubscriberId: true },
  });
  return inv?.manychatSubscriberId ?? null;
}
