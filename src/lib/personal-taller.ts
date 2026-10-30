// Personal del taller: el administrador da de alta a cada persona (nombre, email y móvil) y le llega una
// invitación para crear su contraseña (72 h). Cada uno entra con su usuario, y en cada material
// registrado, paso o hoja queda quién lo hizo. Al irse alguien, se da de baja (no se borra: el historial
// sigue diciendo quién hizo cada cosa).
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { createInviteToken } from "./auth";
import { audit, notifyOwner } from "./cases";
import { isValidPhone, normalizeEmail, normalizePhone } from "./contacto";
import { ErrorTaller } from "./taller-ops";

export async function listaPersonalTaller() {
  return prisma.user.findMany({ where: { role: "TALLER" }, orderBy: [{ active: "desc" }, { name: "asc" }] });
}

async function enviarInvitacion(user: Pick<User, "id" | "name" | "email" | "phone">) {
  const token = await createInviteToken(user.id);
  const enlace = `/activar?token=${token}`;
  await notifyOwner({ name: user.name, phone: user.phone, email: user.email }, { whatsapp: { aceptado: true } }, "invitacion_profesional", {
    enlace,
    validez: "72 h",
    nota: "Bienvenido/a al taller de Ortosend. Crea tu contraseña para entrar desde el móvil o el ordenador del taller.",
  });
  return enlace;
}

export async function invitarPersonalTaller(admin: Pick<User, "id">, datos: { nombre: string; email: string; telefono: string }) {
  const nombre = datos.nombre.trim().slice(0, 120);
  const email = normalizeEmail(datos.email);
  const phone = normalizePhone(datos.telefono);
  if (!nombre) throw new ErrorTaller("Escribe el nombre", 400);
  if (!email.includes("@")) throw new ErrorTaller("Escribe un email válido", 400);
  if (!isValidPhone(phone)) throw new ErrorTaller("Escribe un móvil válido", 400);
  const dup = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (dup) throw new ErrorTaller("Ya existe una cuenta con ese email o móvil", 409);
  const user = await prisma.user.create({ data: { role: "TALLER", name: nombre, email, phone, invitedAt: new Date() } });
  const enlace = await enviarInvitacion(user);
  await audit(admin.id, "taller.alta", `user:${user.id}`, null, { nombre });
  return { user, enlace };
}

export async function reenviarInvitacionTaller(admin: Pick<User, "id">, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "TALLER") throw new ErrorTaller("Persona no encontrada", 404);
  if (user.activatedAt || user.passwordHash) throw new ErrorTaller("Ya ha creado su contraseña: que entre con ella (o use «He olvidado mi contraseña»)");
  await prisma.user.update({ where: { id: user.id }, data: { invitedAt: new Date() } });
  await audit(admin.id, "taller.reinvitar", `user:${user.id}`, null);
  return enviarInvitacion(user);
}

export async function activarPersonalTaller(admin: Pick<User, "id">, userId: string, activo: boolean) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "TALLER") throw new ErrorTaller("Persona no encontrada", 404);
  await prisma.user.update({ where: { id: user.id }, data: { active: activo } });
  await audit(admin.id, activo ? "taller.reactivar" : "taller.baja", `user:${user.id}`, null);
}
