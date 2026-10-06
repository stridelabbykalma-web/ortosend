// Utilidades sobre casos: eventos, notificaciones, reparto y liberación.
import type { Patient, User } from "@prisma/client";
import { prisma } from "./db";
import { OPEN_CASE_TIMEOUT_MIN } from "./states";
import { BARO_KINDS, CAPTURA_VISUAL, SCAN_KIND } from "./format";
import { deliverEmail, renderEmail } from "./email";
import { enviarAvisoWhatsApp } from "./avisos";

export async function pushEvent(caseId: string, text: string, actor: string) {
  await prisma.caseEvent.create({ data: { caseId, text, actor } });
}

// Canal WhatsApp (ManyChat): cada aviso queda en Notification y, si su flujo de
// ManyChat está configurado, sale de verdad. Solo logística + enlace, nunca
// contenido clínico (ver src/lib/avisos.ts). Devuelve true si se envió.
export async function notify(toPhone: string, template: string, payload: Record<string, unknown> = {}, nombre = "") {
  const sent = await enviarAvisoWhatsApp(toPhone, nombre || String(payload.nombre ?? ""), template, payload);
  await prisma.notification.create({
    data: { channel: "whatsapp", toPhone, template, payload: payload as object, sentAt: sent ? new Date() : null },
  });
  return sent;
}

// Canal email (respaldo y avisos legales): encola el aviso y, si hay proveedor
// configurado, lo envía en el acto (ver src/lib/email.ts).
export async function notifyEmail(toEmail: string, template: string, payload: Record<string, unknown> = {}) {
  if (!toEmail) return;
  const { subject, text } = renderEmail(template, payload);
  const sent = await deliverEmail(toEmail, subject, text);
  await prisma.notification.create({
    data: {
      channel: "email",
      toEmail,
      template,
      payload: { ...payload, asunto: subject } as object,
      sentAt: sent ? new Date() : null,
    },
  });
}

// Avisos que además van siempre por email (cambios de titularidad de la cuenta).
const SIEMPRE_EMAIL = new Set(["cuenta_traspasada", "mayoria_edad_titular", "mayoria_edad_sin_email"]);

// Avisos al titular de un paciente: por WhatsApp si lo aceptó; por email si no
// salió por WhatsApp (sin consentimiento, sin flujo configurado o fallo).
export async function notifyOwner(
  owner: { name?: string; phone: string | null; email: string | null },
  consents: unknown,
  template: string,
  payload: Record<string, unknown> = {}
) {
  const wa = (consents as { whatsapp?: { aceptado?: boolean } } | null)?.whatsapp?.aceptado;
  const datos = { nombre: owner.name, ...payload };
  const porWhatsApp = owner.phone && wa ? await notify(owner.phone, template, datos, owner.name) : false;
  if (owner.email && (!porWhatsApp || SIEMPRE_EMAIL.has(template))) await notifyEmail(owner.email, template, datos);
}

// Aviso al titular de un paciente a partir de su id (quien sea: cuenta, paciente o tutor).
export async function avisarPaciente(patientId: string, template: string, payload: Record<string, unknown> = {}) {
  const p = await prisma.patient.findUnique({ where: { id: patientId }, include: { owner: true } });
  if (!p) return;
  const t = titularDe(p);
  const paciente = p.isMinor || (p.owner && p.owner.name !== p.name) ? p.name : undefined;
  await notifyOwner(t, p.consents, template, { ...(paciente ? { paciente } : {}), ...payload });
}

export async function audit(userId: string, action: string, target: string, patientId?: string | null) {
  await prisma.auditLog.create({ data: { userId, action, target, patientId: patientId ?? null } });
}

// Persona de contacto de un paciente: el titular de la cuenta o, si el paciente
// dado de alta por su profesional aún no la ha creado, él mismo o su tutor.
export type Titular = { name: string; phone: string | null; email: string | null };
type PacienteConTitular = Pick<Patient, "name" | "lastName" | "isMinor" | "phone" | "email" | "tutorName" | "tutorPhone" | "tutorEmail"> & {
  owner?: Pick<User, "name" | "phone" | "email"> | null;
};
export function titularDe(p: PacienteConTitular): Titular {
  if (p.owner) return { name: p.owner.name, phone: p.owner.phone, email: p.owner.email };
  return p.isMinor
    ? { name: p.tutorName ?? "", phone: p.tutorPhone, email: p.tutorEmail }
    : { name: [p.name, p.lastName].filter(Boolean).join(" "), phone: p.phone, email: p.email };
}
export async function titularDePaciente(patientId: string): Promise<Titular | null> {
  const p = await prisma.patient.findUnique({ where: { id: patientId }, include: { owner: true } });
  return p ? titularDe(p) : null;
}

// Libera casos abiertos por un usuario (al cerrar sesión).
export async function releaseAllBy(userId: string) {
  await prisma.case.updateMany({ where: { openBy: userId }, data: { openBy: null, openAt: null } });
}

// Liberación perezosa por inactividad (45 min): se ejecuta antes de leer colas.
export async function releaseStale() {
  const cutoff = new Date(Date.now() - OPEN_CASE_TIMEOUT_MIN * 60 * 1000);
  await prisma.case.updateMany({
    where: { openBy: { not: null }, openAt: { lt: cutoff } },
    data: { openBy: null, openAt: null },
  });
}

// Checklist bloqueante del estudio: todo en verde o no hay envío.
export type Checklist = {
  cuestionario: boolean;
  exploracion: boolean;
  escaneos: boolean; // escaneo de las espumas fenólicas
  capturas: number; // vídeos + fotos confirmados, de CAPTURA_VISUAL.length
  baro: boolean;
  completa: boolean;
};

export function checklistOf(capture: {
  questionnaire: unknown;
  physicalExam: unknown;
  media: { kind: string; confirmedAt: Date | null }[];
} | null): Checklist {
  const media = capture?.media.filter((m) => m.confirmedAt) ?? [];
  const has = (k: string) => media.some((m) => m.kind === k);
  const capturas = CAPTURA_VISUAL.filter(([k]) => has(k)).length;
  // El modo guiado guarda por secciones con done:false hasta terminar el bloque;
  // los datos antiguos (sin done) cuentan como completos.
  const blockDone = (x: unknown) => !!x && (x as { done?: boolean }).done !== false;
  const cuestionario = blockDone(capture?.questionnaire);
  const exploracion = blockDone(capture?.physicalExam);
  const escaneos = has(SCAN_KIND);
  const baro = BARO_KINDS.every(([k]) => has(k));
  return {
    cuestionario,
    exploracion,
    escaneos,
    capturas,
    baro,
    completa:
      cuestionario && exploracion && escaneos && capturas >= CAPTURA_VISUAL.length && baro,
  };
}

