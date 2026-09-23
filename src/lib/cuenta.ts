// Ciclo de vida de la cuenta del cliente (Flujo A): bienvenida con el resumen
// de la cuenta, confirmación del email y recuperación de contraseña.
import type { User } from "@prisma/client";
import { createEmailToken, createResetToken } from "./auth";
import { notifyEmail } from "./cases";

export const VERIFY_DAYS = 7;
export const RESET_HOURS = 1;

// Al crear la cuenta: bienvenida + datos de acceso + enlace para confirmar el email.
export async function enviarBienvenida(user: Pick<User, "id" | "name" | "email" | "phone">) {
  if (!user.email) return;
  const token = await createEmailToken(user.id, user.email);
  await notifyEmail(user.email, "cuenta_creada", {
    nombre: user.name,
    email: user.email,
    movil: user.phone ?? "—",
    enlace: `/verificar?token=${token}`,
    validez: `${VERIFY_DAYS} días`,
  });
}

// Reenvío o email nuevo: solo el enlace de confirmación.
export async function enviarVerificacionEmail(user: Pick<User, "id" | "name" | "email">) {
  if (!user.email) return;
  const token = await createEmailToken(user.id, user.email);
  await notifyEmail(user.email, "verificar_email", {
    nombre: user.name,
    enlace: `/verificar?token=${token}`,
    validez: `${VERIFY_DAYS} días`,
  });
}

// Enlace de restablecimiento (1 h, un solo uso).
export async function enviarRecuperacion(user: User) {
  if (!user.email) return;
  const token = await createResetToken(user.id, user.passwordHash);
  await notifyEmail(user.email, "recuperar_contrasena", {
    nombre: user.name,
    enlace: `/restablecer?token=${token}`,
    validez: `${RESET_HOURS} hora`,
  });
}

export async function avisarContrasenaCambiada(user: Pick<User, "name" | "email">) {
  if (!user.email) return;
  await notifyEmail(user.email, "contrasena_cambiada", { nombre: user.name });
}
