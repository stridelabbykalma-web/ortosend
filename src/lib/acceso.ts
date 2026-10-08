// Acceso del paciente a su perfil: cuando el profesional ha completado la ficha
// pulsa «Enviar acceso». El paciente (o su tutor) entra en /acceso, escribe su
// DNI y su móvil y recibe un código de 6 cifras por WhatsApp; con él crea su
// contraseña. DNI y móvil no son secretos: el código prueba que tiene el móvil.
import type { Patient, User } from "@prisma/client";
import { prisma } from "./db";
import { hashPassword } from "./auth";
import { notifyEmail } from "./cases";
import { isValidDni, normalizeDni, normalizeEmail, normalizePhone } from "./contacto";
import { EMPRESA } from "./legal";
import { CAMPOS, FLUJOS, aE164, manychat } from "./manychat";
import { auditar, destinatario } from "./alta";
import { CODIGO_INTENTOS, CODIGO_MINUTOS, hashCodigo, mismoHash, nuevoCodigo } from "./consent/tokens";

export const URL_ACCESO = () => `${EMPRESA.web}/acceso`;
export const ESPERA_TRAS_BLOQUEO_MIN = 15;

// DNI que identifica la cuenta: el del paciente o, si es menor, el de su tutor.
export const dniTitular = (p: Pick<Patient, "isMinor" | "dni" | "tutorDni">) => (p.isMinor ? p.tutorDni : p.dni);

// ---------------------------------------------------------------- enviar acceso (profesional)

export async function enviarAcceso(patientId: string, actor: Pick<User, "id">): Promise<{ ok: true; canal: string } | { ok: false; error: string }> {
  const p = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } });
  if (p.status !== "ACEPTADO") return { ok: false, error: "El paciente aún no ha aceptado los documentos" };
  const dni = dniTitular(p);
  if (!dni || !isValidDni(dni))
    return { ok: false, error: p.isMinor ? "Completa el DNI del tutor antes de enviar el acceso" : "Completa el DNI del paciente antes de enviar el acceso" };
  if (p.ownerId) return { ok: false, error: "El paciente ya tiene cuenta" };
  const dest = destinatario(p);
  const inv = await prisma.consentInvitation.findFirst({
    where: { patientId, manychatSubscriberId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  let canal = "";
  if (inv?.manychatSubscriberId) {
    try {
      await manychat().ponerCampos(inv.manychatSubscriberId, { [CAMPOS.urlAcceso]: URL_ACCESO() });
      await manychat().lanzarFlujo(inv.manychatSubscriberId, FLUJOS.acceso());
      canal = "whatsapp";
    } catch {
      /* cae al email */
    }
  }
  if (!canal && dest.email) {
    await notifyEmail(dest.email, "acceso_listo", { nombre: dest.nombre, paciente: p.isMinor ? p.name : undefined, enlace: "/acceso" });
    canal = "email";
  }
  if (!canal) return { ok: false, error: "No se pudo enviar por WhatsApp y no hay email. Revisa la configuración de ManyChat o añade un email." };
  await prisma.patient.update({ where: { id: patientId }, data: { accessSentAt: new Date() } });
  await auditar(actor.id, "patient.acceso_enviado", patientId, { canal });
  return { ok: true, canal };
}

// ---------------------------------------------------------------- paso 1: DNI + móvil → código

// Pacientes que ese DNI + móvil pueden reclamar: aceptados, con acceso enviado y sin cuenta.
async function candidatos(dni: string, telefono: string) {
  return prisma.patient.findMany({
    where: {
      status: "ACEPTADO",
      accessSentAt: { not: null },
      ownerId: null,
      OR: [
        { isMinor: false, dni, phone: telefono },
        { isMinor: true, tutorDni: dni, tutorPhone: telefono },
      ],
    },
  });
}

// Respuesta siempre igual, exista o no el paciente, para no revelar quién es paciente.
export async function solicitarCodigo(dniRaw: string, telefonoRaw: string): Promise<{ ok: boolean; error?: string }> {
  const dni = normalizeDni(dniRaw);
  const telefono = normalizePhone(telefonoRaw);
  if (!isValidDni(dni)) return { ok: false, error: "Revisa el DNI o NIE: la letra no coincide" };
  if (!telefono) return { ok: false, error: "Indica tu móvil" };
  const lista = await candidatos(dni, telefono);
  if (!lista.length) return { ok: true };
  // Bloqueo: tras agotar los intentos, espera antes de pedir otro código.
  const ultimo = await prisma.accessCode.findFirst({ where: { phone: telefono }, orderBy: { createdAt: "desc" } });
  if (
    ultimo &&
    ultimo.attempts >= CODIGO_INTENTOS &&
    ultimo.createdAt > new Date(Date.now() - ESPERA_TRAS_BLOQUEO_MIN * 60 * 1000)
  )
    return { ok: true };
  // Un código cada minuto como mucho.
  if (ultimo && !ultimo.usedAt && ultimo.createdAt > new Date(Date.now() - 60 * 1000)) return { ok: true };
  const codigo = nuevoCodigo();
  await prisma.accessCode.updateMany({ where: { phone: telefono, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.accessCode.create({
    data: {
      patientId: lista[0].id,
      phone: telefono,
      codeHash: hashCodigo(codigo),
      expiresAt: new Date(Date.now() + CODIGO_MINUTOS * 60 * 1000),
    },
  });
  const inv = await prisma.consentInvitation.findFirst({
    where: { patientId: { in: lista.map((p) => p.id) }, manychatSubscriberId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  const sub = inv?.manychatSubscriberId ?? (await manychat().buscarOCrearContacto({
    telefonoE164: aE164(telefono),
    nombre: destinatario(lista[0]).nombre,
    fraseConsentimiento: "Código de acceso solicitado por el titular en ortosend.com",
  }).catch(() => null));
  if (sub) {
    await manychat().ponerCampos(sub, { [CAMPOS.codigo]: codigo }).catch(() => {});
    await manychat().lanzarFlujo(sub, FLUJOS.codigo()).catch(() => {});
  }
  return { ok: true };
}

// ---------------------------------------------------------------- paso 2: código + contraseña → cuenta

export type ResultadoCuenta =
  | { ok: true; userId: string; nueva: boolean }
  | { ok: false; error: string };

export async function crearCuentaConCodigo(dniRaw: string, telefonoRaw: string, codigo: string, password: string): Promise<ResultadoCuenta> {
  const dni = normalizeDni(dniRaw);
  const telefono = normalizePhone(telefonoRaw);
  const generico = { ok: false as const, error: "Código incorrecto o caducado. Pide uno nuevo." };
  if (password.length < 10) return { ok: false, error: "La contraseña debe tener al menos 10 caracteres" };
  const ac = await prisma.accessCode.findFirst({ where: { phone: telefono, usedAt: null }, orderBy: { createdAt: "desc" } });
  if (!ac || ac.expiresAt <= new Date() || ac.attempts >= CODIGO_INTENTOS) return generico;
  // Cuenta el intento antes de comparar (dos peticiones a la vez no suman intentos gratis).
  const claimed = await prisma.accessCode.updateMany({
    where: { id: ac.id, attempts: { lt: CODIGO_INTENTOS }, usedAt: null },
    data: { attempts: { increment: 1 } },
  });
  if (!claimed.count) return generico;
  if (!mismoHash(hashCodigo(codigo.trim()), ac.codeHash)) {
    return ac.attempts + 1 >= CODIGO_INTENTOS
      ? { ok: false, error: `Demasiados intentos. Pide un código nuevo dentro de ${ESPERA_TRAS_BLOQUEO_MIN} minutos.` }
      : generico;
  }
  const lista = await candidatos(dni, telefono);
  if (!lista.length) return generico;
  const used = await prisma.accessCode.updateMany({ where: { id: ac.id, usedAt: null }, data: { usedAt: new Date() } });
  if (!used.count) return generico;

  // Solo se reutiliza una cuenta de tutor (madre con dos hijos) si ese móvil es de una única cuenta.
  const cuentas = lista[0].isMinor ? await prisma.user.findMany({ where: { phone: telefono }, take: 2 }) : [];
  const existente = cuentas.length === 1 ? cuentas[0] : null;
  if (existente) {
    // Ya tiene cuenta (p. ej. una madre con dos hijos): se le añaden los pacientes.
    // Nunca se cambia su contraseña desde aquí: entra con la que tiene.
    if (existente.role !== "CLIENTE") return { ok: false, error: "Ese móvil pertenece a una cuenta profesional. Contacta con Ortosend." };
    await prisma.patient.updateMany({ where: { id: { in: lista.map((p) => p.id) }, ownerId: null }, data: { ownerId: existente.id } });
    return { ok: true, userId: existente.id, nueva: false };
  }
  const titular = destinatario(lista[0]);
  const nombre = lista[0].isMinor ? titular.nombre : [lista[0].name, lista[0].lastName].filter(Boolean).join(" ");
  const email = normalizeEmail(titular.email) || null;
  const emailLibre = email ? !(await prisma.user.findUnique({ where: { email } })) : false;
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        role: "CLIENTE",
        name: nombre,
        phone: telefono,
        email: emailLibre ? email : null,
        passwordHash: await hashPassword(password),
        activatedAt: new Date(),
      },
    });
    await tx.patient.updateMany({ where: { id: { in: lista.map((p) => p.id) }, ownerId: null }, data: { ownerId: u.id } });
    return u;
  });
  await prisma.auditLog.create({ data: { userId: user.id, action: "account.create_whatsapp", target: `user:${user.id}` } });
  return { ok: true, userId: user.id, nueva: true };
}
