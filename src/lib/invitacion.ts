// Invitación de cuenta (Flujo B): la clínica crea el caso y el paciente (o su
// tutor) activa la cuenta desde un enlace de 72 h. Aquí se envía, se reenvía y
// se calcula su estado; el cron reenvía las caducadas un número limitado de veces.
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { createInviteToken } from "./auth";
import { notify, notifyEmail } from "./cases";

export const INVITE_HOURS = 72;
export const MAX_AUTO_RESENDS = 3; // reenvíos automáticos tras la invitación inicial

export type EstadoInvitacion = "activada" | "pendiente" | "caducada" | "sin_invitar";

export function invitacionCaducaEl(invitedAt: Date) {
  return new Date(invitedAt.getTime() + INVITE_HOURS * 3600 * 1000);
}

export function estadoInvitacion(u: Pick<User, "activatedAt" | "invitedAt" | "passwordHash">): EstadoInvitacion {
  if (u.activatedAt || u.passwordHash) return "activada";
  if (!u.invitedAt) return "sin_invitar";
  return invitacionCaducaEl(u.invitedAt) > new Date() ? "pendiente" : "caducada";
}

// Envía (o reenvía) la invitación por WhatsApp y email y la anota en el usuario.
export async function enviarInvitacion(
  user: Pick<User, "id" | "name" | "phone" | "email">,
  extra: { clinica?: string; nota?: string; template?: string } = {}
) {
  const token = await createInviteToken(user.id);
  const payload = {
    enlace: `/activar?token=${token}`,
    validez: `${INVITE_HOURS} h`,
    nombre: user.name,
    clinica: extra.clinica,
    nota: extra.nota,
  };
  const template = extra.template ?? "invitacion_cuenta";
  if (user.phone) await notify(user.phone, template, payload);
  if (user.email) await notifyEmail(user.email, template, payload);
  await prisma.user.update({
    where: { id: user.id },
    data: { invitedAt: new Date(), inviteCount: { increment: 1 } },
  });
  return token;
}
