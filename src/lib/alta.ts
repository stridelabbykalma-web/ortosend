// Alta de pacientes iniciada por el profesional, con consentimiento documento a
// documento por WhatsApp (ManyChat). Ver docs/ALTA-WHATSAPP.md.
//
//   pre-alta ─► WhatsApp ─► Privacidad ─► Datos de salud ─► Tratamiento ─► Condiciones ─► Marketing
//   PENDIENTE                (cada respuesta llega al webhook y se guarda en consent_log)
//                                                                 └► ACEPTADO: se abre la ficha
//
// Todo lo que cambia el estado de un paciente pasa por aquí, para que el panel,
// el webhook, el cron y los tests compartan las mismas reglas.
import { nombreCompleto } from "./nombre";
import type { ConsentAction, ConsentInvitation, ConsentType, Patient, PatientStatus, Prisma, User } from "@prisma/client";
import { prisma } from "./db";
import { isValidPhone, normalizeEmail, normalizePhone } from "./contacto";
import { EDAD_MAYORIA_SALUD, esMenor, parseBirth } from "./edad";
import { CAMPOS, ETIQUETAS, FLUJOS, aE164, manychat } from "./manychat";
import { ORDEN, OBLIGATORIOS, SLUG, ETIQUETA, esObligatorio } from "./consent/tipos";
import { registrar, textosVigentes } from "./consent/registro";
import { INVITACION_HORAS, hashSecreto, horasDesdeAhora, nuevoSecreto } from "./consent/tokens";
import { notifyEmail } from "./cases";

type Tx = Prisma.TransactionClient;
type Profesional = Pick<User, "id" | "name" | "clinicId">;

export const RECORDATORIO_HORAS = 24;

// Frase que acompaña al alta del contacto en ManyChat (prueba del opt-in).
export const DECLARACION_PROFESIONAL =
  "Declaro que he informado al paciente y que me ha autorizado a facilitar su contacto a Ortosend para recibir un WhatsApp de confirmación.";

// A quién van los mensajes: al paciente o, si es menor de 16, a su tutor.
export function destinatario(p: Pick<Patient, "isMinor" | "name" | "lastName" | "phone" | "email" | "tutorName" | "tutorPhone" | "tutorEmail">) {
  return p.isMinor
    ? { recipient: "tutor" as const, nombre: p.tutorName ?? "", telefono: p.tutorPhone ?? "", email: p.tutorEmail }
    : { recipient: "paciente" as const, nombre: p.name, telefono: p.phone ?? "", email: p.email };
}

export { nombreCompleto };

// ---------------------------------------------------------------- pre-alta

export type DatosPreAlta = {
  nombre: string;
  apellidos: string;
  telefono: string;
  email: string;
  fechaNacimiento: string;
  declaracion: boolean;
  tutorNombre: string;
  tutorTelefono: string;
  tutorEmail: string;
};

export function leerPreAlta(f: FormData): DatosPreAlta {
  const s = (k: string) => String(f.get(k) ?? "").trim();
  return {
    nombre: s("nombre"),
    apellidos: s("apellidos"),
    telefono: s("telefono"),
    email: s("email"),
    fechaNacimiento: s("fechaNacimiento"),
    declaracion: f.get("declaracion") === "on",
    tutorNombre: s("tutorNombre"),
    tutorTelefono: s("tutorTelefono"),
    tutorEmail: s("tutorEmail"),
  };
}

export type ResultadoPreAlta = { ok: true; patient: Patient; envio: ResultadoEnvio } | { ok: false; error: string };

export async function crearPreAlta(pro: Profesional, d: DatosPreAlta): Promise<ResultadoPreAlta> {
  if (!pro.clinicId) return { ok: false, error: "Tu usuario no tiene clínica asignada" };
  if (!d.declaracion)
    return { ok: false, error: "Marca la declaración de que el paciente te ha autorizado a facilitar su contacto" };
  if (!d.nombre || !d.apellidos) return { ok: false, error: "Nombre y apellidos son obligatorios" };
  const birth = parseBirth(d.fechaNacimiento);
  if (!birth) return { ok: false, error: "Indica una fecha de nacimiento válida" };
  const menor = esMenor(birth);
  const telefono = normalizePhone(d.telefono);
  const email = normalizeEmail(d.email) || null;
  if (email && !email.includes("@")) return { ok: false, error: "Email no válido" };
  if (!menor && !isValidPhone(telefono)) return { ok: false, error: "Móvil del paciente no válido (formato internacional, p. ej. +34 600 112 233)" };
  if (menor && telefono && !isValidPhone(telefono)) return { ok: false, error: "Móvil del paciente no válido" };
  const tutorTelefono = normalizePhone(d.tutorTelefono);
  const tutorEmail = normalizeEmail(d.tutorEmail) || null;
  if (menor) {
    if (!d.tutorNombre)
      return { ok: false, error: `Paciente menor de ${EDAD_MAYORIA_SALUD} años: indica el nombre de su padre, madre o tutor legal` };
    if (!isValidPhone(tutorTelefono)) return { ok: false, error: "Móvil del tutor no válido" };
    if (tutorEmail && !tutorEmail.includes("@")) return { ok: false, error: "Email del tutor no válido" };
  }
  const toPhone = menor ? tutorTelefono : telefono;
  // Un móvil solo puede tener un alta en curso: ManyChat guarda un único «ref»
  // por contacto. La comprobación y la creación van en la misma transacción con
  // un cerrojo por teléfono: un doble clic ya no crea dos pacientes.
  let patient: Patient;
  try {
    patient = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"prealta:" + toPhone}))`;
      const enCurso = await invitacionActivaDelTelefono(toPhone, undefined, tx);
      if (enCurso) throw new AltaEnCurso(nombreCompleto(enCurso.patient));
      return crearPacientePreAlta(tx, d, { birth, menor, telefono, email, tutorTelefono, tutorEmail, pro });
    });
  } catch (e) {
    if (e instanceof AltaEnCurso)
      return {
        ok: false,
        error: `Ese móvil ya tiene un alta en curso (${e.message}). Espera a que termine o caduque antes de dar de alta a otro paciente con el mismo móvil.`,
      };
    throw e;
  }
  await auditar(pro.id, "patient.prealta", patient.id, { menor, destinatario: menor ? "tutor" : "paciente" });
  const envio = await enviarInvitacion(patient.id, pro.id);
  return { ok: true, patient: (await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })), envio };
}

class AltaEnCurso extends Error {}

function crearPacientePreAlta(
  tx: Tx,
  d: DatosPreAlta,
  x: { birth: Date; menor: boolean; telefono: string; email: string | null; tutorTelefono: string; tutorEmail: string | null; pro: Profesional }
) {
  return tx.patient.create({
    data: {
      name: d.nombre,
      lastName: d.apellidos,
      birthDate: x.birth,
      isMinor: x.menor,
      phone: x.telefono || null,
      email: x.email,
      status: "PENDIENTE",
      professionalId: x.pro.id,
      clinicId: x.pro.clinicId,
      tutorName: x.menor ? d.tutorNombre : null,
      tutorPhone: x.menor ? x.tutorTelefono : null,
      tutorEmail: x.menor ? x.tutorEmail : null,
    },
  });
}

async function invitacionActivaDelTelefono(toPhone: string, salvoPaciente?: string, db: Tx | typeof prisma = prisma) {
  return db.consentInvitation.findFirst({
    where: {
      toPhone,
      invalidatedAt: null,
      completedAt: null,
      expiresAt: { gt: new Date() },
      sendStatus: { not: "ERROR" },
      ...(salvoPaciente ? { patientId: { not: salvoPaciente } } : {}),
    },
    include: { patient: true },
  });
}

// ---------------------------------------------------------------- envío

export type ResultadoEnvio = { ok: true; invitation: ConsentInvitation } | { ok: false; error: string; invitation: ConsentInvitation };

// Crea una invitación nueva (invalida las anteriores), lanza el WhatsApp y, si el
// destinatario tiene email, envía también el enlace web de aceptación: así el alta
// no se queda atascada cuando el móvil no tiene WhatsApp.
export async function enviarInvitacion(patientId: string, actorUserId: string): Promise<ResultadoEnvio> {
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } });
  const dest = destinatario(patient);
  const textos = await textosVigentes(prisma);
  const ref = nuevoSecreto();
  const webToken = nuevoSecreto();
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.consentInvitation.updateMany({
      where: { patientId, invalidatedAt: null, completedAt: null },
      data: { invalidatedAt: new Date() },
    });
    return tx.consentInvitation.create({
      data: {
        patientId,
        refHash: hashSecreto(ref),
        webTokenHash: hashSecreto(webToken),
        recipient: dest.recipient,
        toPhone: dest.telefono,
        toEmail: dest.email ?? null,
        legalTextIds: Object.fromEntries(ORDEN.map((t) => [t, textos[t].id])),
        expiresAt: horasDesdeAhora(INVITACION_HORAS),
        createdById: actorUserId,
      },
    });
  });

  // Respaldo por email (independiente de que el WhatsApp salga o no).
  const emailEnviado = await enviarEmailAlta(invitation.id, webToken, patient, dest);

  try {
    const mc = manychat();
    const subscriberId = await mc.buscarOCrearContacto({
      telefonoE164: aE164(dest.telefono),
      nombre: dest.nombre.split(" ")[0] || dest.nombre,
      apellidos: patient.isMinor ? null : patient.lastName,
      fraseConsentimiento: DECLARACION_PROFESIONAL,
    });
    await mc.ponerCampos(subscriberId, { [CAMPOS.ref]: ref, [CAMPOS.paciente]: patient.name });
    const respuesta = await mc.lanzarFlujo(subscriberId, FLUJOS.invitacion());
    const ok = await prisma.consentInvitation.update({
      where: { id: invitation.id },
      data: {
        manychatSubscriberId: subscriberId,
        manychatResponse: (respuesta ?? {}) as object,
        sendStatus: "ENVIADO",
        sentAt: new Date(),
      },
    });
    await prisma.patient.update({ where: { id: patientId }, data: { status: siguienteEstadoTrasEnvio(patient.status) } });
    return { ok: true, invitation: ok };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    const ko = await prisma.consentInvitation.update({
      where: { id: invitation.id },
      data: { sendStatus: "ERROR", sendError: msg, manychatResponse: { error: msg } },
    });
    // Con el email fuera, el alta sigue viva aunque WhatsApp falle.
    await prisma.patient.update({
      where: { id: patientId },
      data: { status: emailEnviado ? siguienteEstadoTrasEnvio(patient.status) : "ERROR_ENVIO" },
    });
    return { ok: false, error: msg, invitation: ko };
  }
}

// Envía (o reenvía) por email el enlace web para aceptar los documentos.
async function enviarEmailAlta(
  invitationId: string,
  webToken: string,
  patient: Pick<Patient, "name" | "isMinor">,
  dest: ReturnType<typeof destinatario>
): Promise<boolean> {
  if (!dest.email) return false;
  const sent = await notifyEmail(dest.email, "alta_documentos", {
    nombre: dest.nombre,
    paciente: patient.isMinor ? patient.name : undefined,
    enlace: `/alta/${webToken}`,
    validez: `${INVITACION_HORAS} horas`,
  });
  if (sent) await prisma.consentInvitation.update({ where: { id: invitationId }, data: { emailSentAt: new Date() } });
  return sent;
}

// Genera un enlace web nuevo para la invitación vigente (el anterior deja de
// valer) y lo devuelve: para abrirlo en un dispositivo de la clínica o
// reenviarlo. Si el destinatario tiene email, se le reenvía el enlace nuevo en
// el acto — el anterior queda invalidado y, si no, su email quedaría muerto.
export async function nuevoEnlaceWeb(
  patientId: string
): Promise<{ ok: true; token: string; emailReenviado: boolean } | { ok: false; error: string }> {
  const inv = await prisma.consentInvitation.findFirst({
    where: { patientId, invalidatedAt: null, completedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!inv) return { ok: false, error: "No hay ninguna invitación vigente: reenvía primero la invitación." };
  const token = nuevoSecreto();
  await prisma.consentInvitation.update({ where: { id: inv.id }, data: { webTokenHash: hashSecreto(token) } });
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } });
  const dest = destinatario(patient);
  const emailReenviado = dest.email ? await enviarEmailAlta(inv.id, token, patient, dest) : false;
  return { ok: true, token, emailReenviado };
}

// Reenvía por email el enlace de aceptación (con token nuevo) de la invitación vigente.
export async function reenviarEmailAlta(patientId: string, actor: Pick<User, "id">): Promise<{ ok: boolean; error?: string }> {
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } });
  if (!destinatario(patient).email)
    return { ok: false, error: "Este alta no tiene email de contacto. Añádelo dando de alta de nuevo o usa WhatsApp." };
  const r = await nuevoEnlaceWeb(patientId);
  if (!r.ok) return r;
  await auditar(actor.id, "patient.reenvio_email", patientId);
  return { ok: true };
}

// Un reenvío a un paciente REVOCADO lo devuelve a PENDIENTE (vuelve a aceptar
// los textos); el resto de estados no aceptados también quedan PENDIENTE.
function siguienteEstadoTrasEnvio(actual: PatientStatus): PatientStatus {
  return actual === "ACEPTADO" ? "ACEPTADO" : "PENDIENTE";
}

export const REENVIABLE: PatientStatus[] = ["PENDIENTE", "CADUCADO", "ERROR_ENVIO", "RECHAZADO", "REVOCADO"];

export async function reenviar(patientId: string, actor: Pick<User, "id" | "name">): Promise<ResultadoEnvio | { ok: false; error: string }> {
  const p = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } });
  if (!REENVIABLE.includes(p.status)) return { ok: false, error: "Este paciente ya ha aceptado los documentos" };
  const otro = await invitacionActivaDelTelefono(destinatario(p).telefono, p.id);
  if (otro) return { ok: false, error: `Ese móvil tiene otra alta en curso (${nombreCompleto(otro.patient)}). Espera a que termine.` };
  const r = await enviarInvitacion(patientId, actor.id);
  await auditar(actor.id, "patient.reenvio", patientId, { ok: r.ok });
  return r;
}

// ---------------------------------------------------------------- webhook de ManyChat

export type AccionWebhook = "empezar" | "respuesta" | "revisar";
export type EntradaWebhook = {
  ref: string;
  subscriberId?: string | null;
  // Móvil del contacto de WhatsApp. Permite empezar sin «ref» cuando es el propio
  // paciente quien escribe ALTA (QR en la consulta): WhatsApp garantiza el número.
  telefono?: string | null;
  accion: AccionWebhook;
  documento?: string | null; // slug
  respuesta?: "acepto" | "rechazo" | null;
};
export type SalidaWebhook = {
  estado: "ok" | "rechazado" | "fin" | "caducado" | "invalido";
  // Lo que ManyChat debe mostrar a continuación (campo ortosend_siguiente):
  // privacidad | salud | tratamiento | condiciones | marketing | fin | rechazado | caducado | invalido
  siguiente: string;
  documento_rechazado?: string;
  paciente?: string;
  // Solo en «empezar»: el ref vigente, para que ManyChat lo guarde en ortosend_ref.
  ref?: string;
};

type Ultimas = Partial<Record<ConsentType, ConsentAction>>;

async function ultimasDeInvitacion(tx: Tx, invitationId: string): Promise<Ultimas> {
  const rows = await tx.consentLog.findMany({ where: { invitationId }, orderBy: { seq: "asc" } });
  const out: Ultimas = {};
  for (const r of rows) out[r.type] = r.action;
  return out;
}

// Primer documento pendiente: un obligatorio sin aceptar o el de marketing sin responder.
function documentoEsperado(u: Ultimas): ConsentType | null {
  for (const t of ORDEN) {
    if (esObligatorio(t) ? u[t] !== "ACEPTADO" : !u[t]) return t;
  }
  return null;
}

function salida(u: Ultimas, paciente: string): SalidaWebhook {
  const esperado = documentoEsperado(u);
  if (!esperado) return { estado: "fin", siguiente: "fin", paciente };
  if (u[esperado] === "RECHAZADO")
    return { estado: "rechazado", siguiente: "rechazado", documento_rechazado: SLUG[esperado], paciente };
  return { estado: "ok", siguiente: SLUG[esperado], paciente };
}

const INVALIDO: SalidaWebhook = { estado: "invalido", siguiente: "invalido" };
const CADUCADO: SalidaWebhook = { estado: "caducado", siguiente: "caducado" };

// ManyChat deja el marcador sin sustituir ({{cuf_123}}) cuando el campo está vacío.
const limpio = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return !t || t.startsWith("{{") ? "" : t;
};

// El paciente (o su tutor) escribe ALTA desde su móvil: se busca su alta pendiente por
// número y se le asigna un ref nuevo (el anterior, si se llegó a enviar, deja de valer).
async function reclamarPorTelefono(telefonoRaw: string, subscriberId: string | null) {
  const toPhone = normalizePhone(telefonoRaw);
  if (!toPhone) return null;
  const inv = await prisma.consentInvitation.findFirst({
    where: { toPhone, invalidatedAt: null, completedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!inv) return null;
  const ref = nuevoSecreto();
  await prisma.consentInvitation.update({
    where: { id: inv.id },
    data: { refHash: hashSecreto(ref), ...(subscriberId ? { manychatSubscriberId: subscriberId } : {}) },
  });
  await prisma.patient.updateMany({ where: { id: inv.patientId, status: "ERROR_ENVIO" }, data: { status: "PENDIENTE" } });
  return ref;
}

export async function procesarWebhook(e: EntradaWebhook): Promise<SalidaWebhook> {
  const ref = limpio(e.ref);
  let out = ref ? await procesarConRef({ ...e, ref }) : INVALIDO;
  if (e.accion !== "empezar") return out;
  // Al empezar sin ref utilizable se intenta por el móvil del contacto. El ref
  // guardado en ManyChat puede ser inválido, pero también de un alta ANTERIOR ya
  // terminada o caducada (segundo hijo del mismo tutor, reinvitación tras una
  // revocación): en todos esos casos manda el alta pendiente del teléfono.
  let vigente = ref;
  const telefono = limpio(e.telefono);
  if (["invalido", "fin", "caducado"].includes(out.estado) && telefono) {
    const nuevo = await reclamarPorTelefono(telefono, limpio(e.subscriberId) || null);
    if (nuevo) {
      vigente = nuevo;
      out = await procesarConRef({ ...e, ref: nuevo, subscriberId: limpio(e.subscriberId) || null });
    }
  }
  return { ...out, ref: out.estado === "invalido" ? "" : vigente };
}

async function procesarConRef(e: EntradaWebhook): Promise<SalidaWebhook> {
  const previa = await prisma.consentInvitation.findUnique({ where: { refHash: hashSecreto(e.ref) } });
  if (!previa) return INVALIDO;
  const sub = limpio(e.subscriberId);
  if (sub && previa.manychatSubscriberId && sub !== previa.manychatSubscriberId) return INVALIDO;
  if (previa.invalidatedAt) return INVALIDO;

  type Efecto = { aceptado?: boolean; marketing?: boolean };
  const efecto: Efecto = {};
  const res = await prisma.$transaction(async (tx) => {
    // Serializa las pulsaciones de una misma invitación (doble toque, reintentos de ManyChat).
    await tx.$executeRaw`SELECT 1 FROM "consent_invitations" WHERE "id" = ${previa.id} FOR UPDATE`;
    // Releída tras el bloqueo: un «Reenviar» simultáneo puede haberla invalidado.
    const inv = await tx.consentInvitation.findUniqueOrThrow({ where: { id: previa.id } });
    if (inv.invalidatedAt) return INVALIDO;
    const patient = await tx.patient.findUniqueOrThrow({ where: { id: inv.patientId } });
    const u = await ultimasDeInvitacion(tx, inv.id);
    const terminada = !!inv.completedAt;
    // Tras aceptar los obligatorios aún puede responder al de marketing aunque pasen las 72 h.
    if (!terminada && inv.expiresAt <= new Date()) {
      if (patient.status === "PENDIENTE" || patient.status === "RECHAZADO")
        await tx.patient.update({ where: { id: patient.id }, data: { status: "CADUCADO" } });
      return CADUCADO;
    }
    if (e.accion === "empezar") {
      if (!inv.startedAt) await tx.consentInvitation.update({ where: { id: inv.id }, data: { startedAt: new Date() } });
      return salida(u, patient.name);
    }
    const esperado = documentoEsperado(u);
    if (e.accion === "revisar") {
      if (esperado && u[esperado] === "RECHAZADO") {
        await tx.patient.update({ where: { id: patient.id }, data: { status: "PENDIENTE" } });
        return { estado: "ok", siguiente: SLUG[esperado], paciente: patient.name } satisfies SalidaWebhook;
      }
      return salida(u, patient.name);
    }
    // accion === "respuesta"
    const tipo = ORDEN.find((t) => SLUG[t] === e.documento);
    if (!tipo || (e.respuesta !== "acepto" && e.respuesta !== "rechazo")) return salida(u, patient.name);
    // Botón de un mensaje anterior o doble pulsación: no se registra nada.
    if (tipo !== esperado) return salida(u, patient.name);
    const action: ConsentAction = e.respuesta === "acepto" ? "ACEPTADO" : "RECHAZADO";
    if (u[tipo] === action) return salida(u, patient.name);
    const textos = inv.legalTextIds as Record<string, string>;
    await registrar(tx, {
      patientId: patient.id,
      professionalId: patient.professionalId,
      type: tipo,
      action,
      legalTextId: textos[tipo],
      actor: inv.recipient === "tutor" ? "tutor" : "paciente",
      channel: "whatsapp",
      invitationId: inv.id,
      externalRef: sub || inv.manychatSubscriberId,
    });
    u[tipo] = action;
    if (action === "RECHAZADO" && esObligatorio(tipo)) {
      await tx.patient.update({ where: { id: patient.id }, data: { status: "RECHAZADO" } });
    } else if (esObligatorio(tipo) && OBLIGATORIOS.every((t) => u[t] === "ACEPTADO") && !terminada) {
      await tx.consentInvitation.update({ where: { id: inv.id }, data: { completedAt: new Date(), confirmPending: true } });
      // Avisos operativos por WhatsApp (cita, pago, envío): el paciente ya conversa
      // con Ortosend por ese canal. Se refleja en el histórico que usa notifyOwner.
      const consents = { ...((patient.consents as object) ?? {}), whatsapp: { aceptado: true, fecha: new Date().toISOString(), via: "alta_whatsapp" } };
      await tx.patient.update({ where: { id: patient.id }, data: { status: "ACEPTADO", consents } });
      await abrirFichaTrasAceptar(tx, patient, "whatsapp");
      efecto.aceptado = true;
    } else if (tipo === "MARKETING") {
      efecto.marketing = action === "ACEPTADO";
    }
    return salida(u, patient.name);
  });

  // Efectos fuera de la transacción: si ManyChat falla, el cron lo reintenta.
  if (efecto.aceptado) await confirmarEnManyChat(previa.id);
  if (efecto.marketing && previa.manychatSubscriberId)
    await manychat().ponerEtiqueta(previa.manychatSubscriberId, ETIQUETAS.marketingOk).catch(() => {});
  return res;
}

// La ficha clínica (caso + captura) nace al aceptar los cuatro obligatorios
// (por WhatsApp o por el enlace web). Si vuelve tras una revocación y ya tiene
// un caso abierto, se reutiliza.
export async function abrirFichaTrasAceptar(tx: Tx, patient: Patient, via: "whatsapp" | "web" = "whatsapp") {
  const canal = via === "web" ? "por la web" : "por WhatsApp";
  if (!patient.clinicId) return;
  const abierto = await tx.case.findFirst({
    where: { patientId: patient.id, state: { notIn: ["CERRADO", "NO_PRESCRITO", "NO_CONVERTIDO", "ENTREGADO"] } },
  });
  if (abierto) {
    await tx.caseEvent.create({ data: { caseId: abierto.id, text: `Consentimientos aceptados de nuevo ${canal}`, actor: "sistema" } });
    return;
  }
  const kase = await tx.case.create({
    data: { patientId: patient.id, clinicId: patient.clinicId, state: "ESTUDIO_EN_CURSO", flow: "B" },
  });
  await tx.capture.create({ data: { caseId: kase.id } });
  await tx.caseEvent.create({
    data: {
      caseId: kase.id,
      text: `Consentimientos aceptados ${canal}${patient.isMinor ? ` por su tutor (${patient.tutorName})` : ""}: ficha abierta`,
      actor: "sistema",
    },
  });
}

// Etiqueta consent_ok en ManyChat. confirmPending queda a true si falla.
export async function confirmarEnManyChat(invitationId: string) {
  const inv = await prisma.consentInvitation.findUnique({ where: { id: invitationId } });
  if (!inv?.manychatSubscriberId || !inv.confirmPending) return false;
  try {
    await manychat().ponerEtiqueta(inv.manychatSubscriberId, ETIQUETAS.consentOk);
    await prisma.consentInvitation.update({ where: { id: inv.id }, data: { confirmPending: false } });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- caducidad, recordatorio y reintentos

// Pacientes PENDIENTE o RECHAZADO cuya invitación ha vencido → CADUCADO.
// Se llama desde el polling del panel (al momento) y desde el cron.
export async function caducarVencidas(where: Prisma.PatientWhereInput = {}) {
  const vencidos = await prisma.patient.findMany({
    where: {
      ...where,
      status: { in: ["PENDIENTE", "RECHAZADO"] },
      consentInvitations: { some: {} },
      NOT: { consentInvitations: { some: { invalidatedAt: null, completedAt: null, expiresAt: { gt: new Date() } } } },
    },
    select: { id: true },
  });
  if (!vencidos.length) return 0;
  const r = await prisma.patient.updateMany({
    where: { id: { in: vencidos.map((v) => v.id) }, status: { in: ["PENDIENTE", "RECHAZADO"] } },
    data: { status: "CADUCADO" },
  });
  return r.count;
}

export async function enviarRecordatorios(now = new Date()) {
  const invs = await prisma.consentInvitation.findMany({
    where: {
      sendStatus: "ENVIADO",
      completedAt: null,
      invalidatedAt: null,
      reminderSentAt: null,
      expiresAt: { gt: now },
      sentAt: { lte: new Date(now.getTime() - RECORDATORIO_HORAS * 3600 * 1000) },
      patient: { status: "PENDIENTE" },
    },
  });
  let n = 0;
  for (const inv of invs) {
    if (!inv.manychatSubscriberId) continue;
    try {
      await manychat().lanzarFlujo(inv.manychatSubscriberId, FLUJOS.recordatorio());
      await prisma.consentInvitation.update({ where: { id: inv.id }, data: { reminderSentAt: now } });
      n++;
    } catch {
      /* se reintenta en la próxima pasada */
    }
  }
  return n;
}

export async function reintentarConfirmaciones() {
  const pend = await prisma.consentInvitation.findMany({ where: { confirmPending: true, completedAt: { not: null } } });
  let n = 0;
  for (const inv of pend) if (await confirmarEnManyChat(inv.id)) n++;
  return n;
}

// ---------------------------------------------------------------- revocación

export type Revocacion = {
  patientId: string;
  type: ConsentType;
  actor: "paciente" | "tutor" | "profesional";
  channel: "web_gestion" | "web_perfil" | "panel";
  actorUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

// Retirar nunca borra ni edita: añade una fila REVOCADO. Si es un obligatorio, el
// paciente pasa a REVOCADO (ficha en solo lectura, sin casos nuevos, fabricación
// detenida). La ficha se conserva por obligación legal.
export async function revocar(r: Revocacion) {
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: r.patientId } });
  const textos = await textosVigentes(prisma);
  const res = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Patient" WHERE "id" = ${patient.id} FOR UPDATE`;
    const ultima = await tx.consentLog.findFirst({ where: { patientId: patient.id, type: r.type }, orderBy: { seq: "desc" } });
    if (ultima?.action !== "ACEPTADO") return { cambiado: false };
    await registrar(tx, {
      patientId: patient.id,
      professionalId: patient.professionalId,
      type: r.type,
      action: "REVOCADO",
      legalTextId: ultima.legalTextId ?? textos[r.type].id,
      actor: r.actor,
      actorUserId: r.actorUserId,
      ip: r.ip,
      userAgent: r.userAgent,
      channel: r.channel,
    });
    if (esObligatorio(r.type)) {
      await tx.patient.update({ where: { id: patient.id }, data: { status: "REVOCADO" } });
      const casos = await tx.case.findMany({ where: { patientId: patient.id, state: { notIn: ["CERRADO", "NO_PRESCRITO", "NO_CONVERTIDO"] } } });
      for (const c of casos)
        await tx.caseEvent.create({
          data: {
            caseId: c.id,
            text: `Consentimiento retirado (${ETIQUETA[r.type]}): tratamiento y fabricación detenidos. La ficha queda en solo lectura.`,
            actor: r.actor,
          },
        });
    }
    return { cambiado: true };
  });
  if (res.cambiado) {
    const sub = await subscriberDe(patient.id);
    if (sub) {
      const etiqueta = r.type === "MARKETING" ? ETIQUETAS.marketingOk : ETIQUETAS.consentOk;
      await manychat().quitarEtiqueta(sub, etiqueta).catch(() => {});
    }
    if (r.actorUserId) await auditar(r.actorUserId, "consent.revoke", patient.id, { type: r.type, channel: r.channel });
  }
  return res.cambiado;
}

// El de marketing se puede volver a aceptar desde el perfil o el enlace de gestión.
// Los obligatorios solo con una invitación nueva del profesional (vuelve a leerlos).
export async function reactivarMarketing(r: Omit<Revocacion, "type">) {
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: r.patientId } });
  const textos = await textosVigentes(prisma);
  const ultima = await prisma.consentLog.findFirst({ where: { patientId: patient.id, type: "MARKETING" }, orderBy: { seq: "desc" } });
  if (ultima?.action === "ACEPTADO") return false;
  await registrar(prisma, {
    patientId: patient.id,
    professionalId: patient.professionalId,
    type: "MARKETING",
    action: "ACEPTADO",
    legalTextId: textos.MARKETING.id,
    actor: r.actor,
    actorUserId: r.actorUserId,
    ip: r.ip,
    userAgent: r.userAgent,
    channel: r.channel,
  });
  const sub = await subscriberDe(patient.id);
  if (sub) await manychat().ponerEtiqueta(sub, ETIQUETAS.marketingOk).catch(() => {});
  return true;
}

async function subscriberDe(patientId: string) {
  const inv = await prisma.consentInvitation.findFirst({
    where: { patientId, manychatSubscriberId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  return inv?.manychatSubscriberId ?? null;
}

// ---------------------------------------------------------------- acceso a la ficha

// Quién puede ver la ficha de un paciente: su clínica (el profesional que lo dio
// de alta y sus compañeros), taller, recetador central y administración.
export function puedeVerFicha(user: Pick<User, "role" | "clinicId">, patient: Pick<Patient, "clinicId">) {
  if (user.role === "TALLER" || user.role === "RECETADOR" || user.role === "ADMIN") return true;
  return (user.role === "PROFESIONAL" || user.role === "ADMIN_CLINICA") && !!user.clinicId && user.clinicId === patient.clinicId;
}

// Solo con los obligatorios en vigor se puede tratar (editar, avanzar, fabricar).
export const tratamientoPermitido = (p: Pick<Patient, "status">) => p.status === "ACEPTADO";

export async function exigirTratamientoPermitido(patientId: string) {
  const p = await prisma.patient.findUnique({ where: { id: patientId }, select: { status: true } });
  if (!p || !tratamientoPermitido(p))
    throw new Error("El paciente ha retirado su consentimiento o aún no lo ha dado: la ficha está en solo lectura");
}

export async function auditar(userId: string, accion: string, patientId: string | null, detalle?: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: { userId, action: accion, target: patientId ? `patient:${patientId}` : "-", patientId, detail: (detalle ?? undefined) as object | undefined },
  });
}

// ---------------------------------------------------------------- panel en vivo

export type EstadoPanel = {
  id: string;
  nombre: string;
  status: PatientStatus;
  aceptados: number; // de los 4 obligatorios, en la invitación vigente
  total: number;
  envio: "PENDIENTE" | "ENVIADO" | "ERROR" | null;
  enviadoAt: string | null;
  expiraAt: string | null;
  accesoEnviado: boolean;
  cuenta: boolean;
  casoId: string | null;
};

export async function estadoPanel(clinicId: string, ids?: string[]): Promise<EstadoPanel[]> {
  await caducarVencidas({ clinicId });
  const pacientes = await prisma.patient.findMany({
    where: { clinicId, professionalId: { not: null }, ...(ids ? { id: { in: ids } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      consentInvitations: { orderBy: { createdAt: "desc" }, take: 1, include: { consentLogs: true } },
      cases: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
    },
  });
  return pacientes.map((p) => {
    const inv = p.consentInvitations[0];
    const ult: Ultimas = {};
    for (const l of [...(inv?.consentLogs ?? [])].sort((a, b) => Number(a.seq - b.seq))) ult[l.type] = l.action;
    return {
      id: p.id,
      nombre: nombreCompleto(p),
      status: p.status,
      aceptados: OBLIGATORIOS.filter((t) => ult[t] === "ACEPTADO").length,
      total: OBLIGATORIOS.length,
      envio: inv?.sendStatus ?? null,
      enviadoAt: inv?.sentAt?.toISOString() ?? null,
      expiraAt: inv?.expiresAt.toISOString() ?? null,
      accesoEnviado: !!p.accessSentAt,
      cuenta: !!p.ownerId,
      casoId: p.cases[0]?.id ?? null,
    };
  });
}
