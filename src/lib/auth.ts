// Autenticación: sesión en cookie firmada (JWT jose) + hash de contraseña (bcryptjs).
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import type { Role, User } from "@prisma/client";

const COOKIE = "ortosend_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret");

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}
export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

// Duración de la sesión por tipo de cuenta. El personal (clínica, profesional,
// recetador, taller, admin) accede a datos de salud y a menudo desde
// dispositivos compartidos: su cookie es de sesión (muere al cerrar el
// navegador) y el token caduca a las 12 h aunque no lo cierren. El cliente
// mantiene la sesión 30 días en su propio móvil.
const STAFF_HOURS = 12;
const CLIENT_DAYS = 30;

export async function createSession(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const esCliente = user?.role === "CLIENTE";
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(esCliente ? `${CLIENT_DAYS}d` : `${STAFF_HOURS}h`)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // Sin maxAge la cookie es de sesión: desaparece al cerrar el navegador.
    ...(esCliente ? { maxAge: 60 * 60 * 24 * CLIENT_DAYS } : {}),
    path: "/",
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

// Usuario de la sesión actual (o null). Cacheado por petición.
export const getSessionUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const uid = payload.uid as string;
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user || !user.active) return null;
    return user;
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<User> {
  const u = await getSessionUser();
  if (!u) throw new Error("No autenticado");
  return u;
}

export async function requireRole(...roles: Role[]): Promise<User> {
  const u = await requireUser();
  if (!roles.includes(u.role)) throw new Error("Sin permiso");
  return u;
}

// Token de activación de cuenta (profesionales) — 72 h.
export const INVITE_HOURS = 72;
export async function createInviteToken(userId: string) {
  return new SignJWT({ uid: userId, kind: "invite" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${INVITE_HOURS}h`)
    .sign(secret());
}
// Token con el que el paciente toma el control de su cuenta al cumplir 16 años.
export async function createHandoverToken(patientId: string, days: number) {
  return new SignJWT({ pid: patientId, kind: "handover" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${days * 24}h`)
    .sign(secret());
}
export async function verifyHandoverToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.kind !== "handover") return null;
    return payload.pid as string;
  } catch {
    return null;
  }
}

export async function verifyInviteToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.kind !== "invite") return null;
    return payload.uid as string;
  } catch {
    return null;
  }
}


// Confirmación del email (enlace de 7 días). Lleva el email para que un cambio
// posterior lo invalide.
export async function createEmailToken(userId: string, email: string) {
  return new SignJWT({ uid: userId, email, kind: "verify" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}
export async function verifyEmailToken(token: string): Promise<{ uid: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.kind !== "verify") return null;
    return { uid: payload.uid as string, email: payload.email as string };
  } catch {
    return null;
  }
}

// Restablecer contraseña (enlace de 1 hora). Lleva una huella del hash actual:
// en cuanto la contraseña cambia, el enlace deja de valer (un solo uso).
const fingerprint = (hash: string | null) => (hash ?? "none").slice(-16);
export async function createResetToken(userId: string, passwordHash: string | null) {
  return new SignJWT({ uid: userId, fp: fingerprint(passwordHash), kind: "reset" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret());
}
export async function verifyResetToken(token: string): Promise<User | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.kind !== "reset") return null;
    const user = await prisma.user.findUnique({ where: { id: payload.uid as string } });
    if (!user || !user.active || fingerprint(user.passwordHash) !== payload.fp) return null;
    return user;
  } catch {
    return null;
  }
}

// Paso intermedio de /acceso: DNI y móvil ya escritos, a la espera del código
// de WhatsApp. Se guardan en una cookie firmada (no en la URL) durante 15 min.
const ACCESO_COOKIE = "ortosend_acceso";
export async function guardarAccesoPendiente(dni: string, telefono: string) {
  const token = await new SignJWT({ dni, tel: telefono, kind: "acceso" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret());
  (await cookies()).set(ACCESO_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 15 * 60,
    path: "/acceso",
  });
}
export async function leerAccesoPendiente(): Promise<{ dni: string; telefono: string } | null> {
  const t = (await cookies()).get(ACCESO_COOKIE)?.value;
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, secret());
    if (payload.kind !== "acceso") return null;
    return { dni: String(payload.dni), telefono: String(payload.tel) };
  } catch {
    return null;
  }
}
export async function borrarAccesoPendiente() {
  (await cookies()).delete({ name: ACCESO_COOKIE, path: "/acceso" });
}
