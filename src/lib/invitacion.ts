// Invitación de la clínica (Flujo B). La clínica solo registra los datos
// esenciales del paciente y envía el enlace; la cuenta, los consentimientos y el
// caso se crean cuando el paciente (o su tutor) acepta en /invitacion.
import { randomBytes } from "crypto";
import type { Invitation } from "@prisma/client";
import { prisma } from "./db";
import { notify, notifyEmail } from "./cases";

export const INVITE_HOURS = 72;
export const MAX_AUTO_RESENDS = 3; // reenvíos automáticos del cron tras la invitación inicial

export type EstadoInvitacion = "pendiente" | "caducada" | "aceptada" | "cancelada";

export function estadoInvitacion(inv: Pick<Invitation, "status" | "expiresAt">): EstadoInvitacion {
  if (inv.status === "aceptada") return "aceptada";
  if (inv.status === "cancelada") return "cancelada";
  return inv.expiresAt > new Date() ? "pendiente" : "caducada";
}

export const nuevoTokenInvitacion = () => randomBytes(24).toString("base64url");
export const caducidadInvitacion = () => new Date(Date.now() + INVITE_HOURS * 3600 * 1000);
export const enlaceInvitacion = (token: string) => `/invitacion?token=${token}`;

// Envía la invitación por WhatsApp y email (con el token vigente).
export async function enviarInvitacion(inv: Invitation, clinica: string, nota?: string) {
  const payload = {
    enlace: enlaceInvitacion(inv.token),
    validez: `${INVITE_HOURS} h`,
    nombre: inv.tutorName ?? inv.name,
    paciente: inv.isMinor ? inv.name : undefined,
    clinica,
    nota,
  };
  await notify(inv.phone, "invitacion_cuenta", payload);
  if (inv.email) await notifyEmail(inv.email, "invitacion_cuenta", payload);
}

// Reenvío: token y caducidad nuevos, contador de envíos.
export async function reenviarInvitacion(inv: Invitation, clinica: string, nota?: string) {
  const updated = await prisma.invitation.update({
    where: { id: inv.id },
    data: { token: nuevoTokenInvitacion(), expiresAt: caducidadInvitacion(), sentAt: new Date(), sentCount: { increment: 1 } },
  });
  await enviarInvitacion(updated, clinica, nota);
  return updated;
}
