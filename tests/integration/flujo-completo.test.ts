// Flujo completo contra Postgres real (esquema temporal con todas las migraciones):
// pre-alta → WhatsApp → aceptación documento a documento → ficha desbloqueada →
// acceso con DNI + móvil + código → revocación. ManyChat es un doble que registra
// cada llamada para comprobar que nunca salen datos de salud.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { usarManyChat, CAMPOS, ETIQUETAS } from "@/lib/manychat";
import {
  caducarVencidas,
  crearPreAlta,
  enviarRecordatorios,
  estadoPanel,
  exigirTratamientoPermitido,
  procesarWebhook,
  puedeVerFicha,
  reactivarMarketing,
  reenviar,
  reintentarConfirmaciones,
  revocar,
  tratamientoPermitido,
  type DatosPreAlta,
  type SalidaWebhook,
} from "@/lib/alta";
import { crearCuentaConCodigo, enviarAcceso, solicitarCodigo } from "@/lib/acceso";
import { estadoActual } from "@/lib/consent/registro";
import { POST as webhookPOST } from "@/app/api/manychat/consentimiento/route";
import { FakeManyChat } from "../fake-manychat";

let mc: FakeManyChat;
let clinicId: string;
let otraClinicaId: string;
let pro: { id: string; name: string; clinicId: string | null };
let tel = 600100000;
const nuevoTel = () => String(++tel);

const datos = (over: Partial<DatosPreAlta> = {}): DatosPreAlta => ({
  nombre: "Lucía",
  apellidos: "Martín Soler",
  telefono: nuevoTel(),
  email: "",
  fechaNacimiento: "1988-05-10",
  declaracion: true,
  tutorNombre: "",
  tutorTelefono: "",
  tutorEmail: "",
  ...over,
});

async function altaAdulto(over: Partial<DatosPreAlta> = {}) {
  const r = await crearPreAlta(pro, datos(over));
  if (!r.ok) throw new Error(r.error);
  return { patient: r.patient, ref: mc.campo(CAMPOS.ref)!, sub: r.envio.invitation.manychatSubscriberId! };
}

const responder = (ref: string, documento: string, respuesta: "acepto" | "rechazo", subscriberId?: string) =>
  procesarWebhook({ ref, subscriberId, accion: "respuesta", documento, respuesta });

async function aceptarObligatorios(ref: string) {
  await procesarWebhook({ ref, accion: "empezar" });
  let out: SalidaWebhook | null = null;
  for (const d of ["privacidad", "salud", "tratamiento", "condiciones"]) out = await responder(ref, d, "acepto");
  return out!;
}

beforeAll(async () => {
  const c = await prisma.clinic.create({ data: { name: "Clínica Test", address: "C/ Mayor 1", town: "Girona", postalCode: "17001" } });
  const c2 = await prisma.clinic.create({ data: { name: "Otra", address: "C/ Menor 2", town: "Reus", postalCode: "43201" } });
  clinicId = c.id;
  otraClinicaId = c2.id;
  pro = await prisma.user.create({ data: { role: "PROFESIONAL", name: "Dra. Pons", clinicId } });
});

beforeEach(() => {
  mc = new FakeManyChat();
  usarManyChat(mc);
});

describe("1. pre-alta", () => {
  it("sin la declaración del profesional no se crea nada", async () => {
    const antes = await prisma.patient.count();
    const r = await crearPreAlta(pro, datos({ declaracion: false }));
    expect(r.ok).toBe(false);
    expect(await prisma.patient.count()).toBe(antes);
    expect(mc.llamadas).toHaveLength(0);
  });

  it("crea el paciente PENDIENTE, guarda solo el hash del ref y envía el WhatsApp", async () => {
    const { patient, ref } = await altaAdulto();
    expect(patient.status).toBe("PENDIENTE");
    expect(patient.professionalId).toBe(pro.id);
    const inv = await prisma.consentInvitation.findFirstOrThrow({ where: { patientId: patient.id } });
    expect(inv.sendStatus).toBe("ENVIADO");
    expect(inv.sentAt).not.toBeNull();
    expect(inv.manychatSubscriberId).toMatch(/^sub_/);
    expect(inv.recipient).toBe("paciente");
    expect(inv.refHash).not.toContain(ref);
    expect(ref.length).toBeGreaterThanOrEqual(43); // 32 bytes
    const horas = (inv.expiresAt.getTime() - inv.createdAt.getTime()) / 3600_000;
    expect(Math.round(horas)).toBe(72);
    expect(mc.llamadas.find((l) => l.op === "flujo")).toMatchObject({ flow: "flow_invitacion" });
  });

  it("a ManyChat solo van nombre, móvil y el ref opaco (nada de salud)", async () => {
    await altaAdulto();
    const salida = JSON.stringify(mc.llamadas);
    expect(salida).not.toMatch(/1988|nacimiento|diagn|salud|plantilla|clínica test/i);
    const campos = mc.llamadas.filter((l) => l.op === "campos").flatMap((l) => Object.keys((l as { campos: object }).campos));
    expect(new Set(campos)).toEqual(new Set([CAMPOS.ref, CAMPOS.paciente]));
  });

  it("menor de 16: los mensajes van al tutor", async () => {
    const tutorTel = nuevoTel();
    const r = await crearPreAlta(pro, datos({ fechaNacimiento: "2014-03-01", telefono: "", tutorNombre: "Marc Soler", tutorTelefono: tutorTel }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patient.isMinor).toBe(true);
    const inv = await prisma.consentInvitation.findFirstOrThrow({ where: { patientId: r.patient.id } });
    expect(inv.recipient).toBe("tutor");
    expect(inv.toPhone).toBe(tutorTel);
    const contacto = mc.llamadas.find((l) => l.op === "contacto");
    expect(contacto).toMatchObject({ contacto: { telefonoE164: `+34${tutorTel}`, nombre: "Marc" } });
  });

  it("menor sin datos del tutor: error", async () => {
    const r = await crearPreAlta(pro, datos({ fechaNacimiento: "2015-01-01", telefono: "" }));
    expect(r).toMatchObject({ ok: false });
  });

  it("no permite dos altas en curso con el mismo móvil", async () => {
    const t = nuevoTel();
    await altaAdulto({ telefono: t });
    const r = await crearPreAlta(pro, datos({ telefono: t, nombre: "Otro" }));
    expect(r).toMatchObject({ ok: false });
  });
});

describe("2. envío fallido y reenvío", () => {
  it("si ManyChat falla queda ERROR_ENVIO; reenviar invalida el anterior y genera otro", async () => {
    mc.fallar = true;
    const r = await crearPreAlta(pro, datos());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envio.ok).toBe(false);
    expect(r.patient.status).toBe("ERROR_ENVIO");
    const fallida = await prisma.consentInvitation.findFirstOrThrow({ where: { patientId: r.patient.id } });
    expect(fallida.sendStatus).toBe("ERROR");
    expect(fallida.sendError).toMatch(/caído/);

    mc.fallar = false;
    const r2 = await reenviar(r.patient.id, pro);
    expect(r2.ok).toBe(true);
    const ref = mc.campo(CAMPOS.ref)!;
    const invs = await prisma.consentInvitation.findMany({ where: { patientId: r.patient.id }, orderBy: { createdAt: "asc" } });
    expect(invs).toHaveLength(2);
    expect(invs[0].invalidatedAt).not.toBeNull();
    expect(invs[1].sendStatus).toBe("ENVIADO");
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: r.patient.id } })).status).toBe("PENDIENTE");
    expect((await procesarWebhook({ ref, accion: "empezar" })).siguiente).toBe("privacidad");
  });

  it("el ref anterior deja de valer tras un reenvío", async () => {
    const { patient, ref } = await altaAdulto();
    await reenviar(patient.id, pro);
    expect(await procesarWebhook({ ref, accion: "empezar" })).toMatchObject({ estado: "invalido" });
  });
});

describe("3. aceptación documento a documento", () => {
  it("recorre los cinco documentos y abre la ficha al aceptar los cuatro obligatorios", async () => {
    const { patient, ref, sub } = await altaAdulto();
    expect(await procesarWebhook({ ref, subscriberId: sub, accion: "empezar" })).toMatchObject({ estado: "ok", siguiente: "privacidad" });
    expect(await responder(ref, "privacidad", "acepto", sub)).toMatchObject({ siguiente: "salud" });
    expect(await responder(ref, "salud", "acepto", sub)).toMatchObject({ siguiente: "tratamiento" });
    expect(await responder(ref, "tratamiento", "acepto", sub)).toMatchObject({ siguiente: "condiciones" });

    // Mientras tanto la ficha sigue cerrada.
    expect(await prisma.case.count({ where: { patientId: patient.id } })).toBe(0);
    const [enCurso] = await estadoPanel(clinicId, [patient.id]);
    expect(enCurso).toMatchObject({ status: "PENDIENTE", aceptados: 3, total: 4 });

    expect(await responder(ref, "condiciones", "acepto", sub)).toMatchObject({ siguiente: "marketing" });
    const p = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id }, include: { cases: true } });
    expect(p.status).toBe("ACEPTADO");
    expect(p.cases).toHaveLength(1);
    expect(p.cases[0].state).toBe("ESTUDIO_EN_CURSO");
    expect(mc.llamadas).toContainEqual({ op: "etiqueta", sub, etiqueta: ETIQUETAS.consentOk });

    expect(await responder(ref, "marketing", "rechazo", sub)).toMatchObject({ estado: "fin", siguiente: "fin" });
    const log = await prisma.consentLog.findMany({ where: { patientId: patient.id }, orderBy: { seq: "asc" } });
    expect(log.map((l) => [l.type, l.action])).toEqual([
      ["PRIVACIDAD", "ACEPTADO"],
      ["DATOS_SALUD", "ACEPTADO"],
      ["TRATAMIENTO", "ACEPTADO"],
      ["CONDICIONES", "ACEPTADO"],
      ["MARKETING", "RECHAZADO"],
    ]);
    const inv = await prisma.consentInvitation.findFirstOrThrow({ where: { patientId: patient.id } });
    for (const l of log) {
      expect(l.legalTextId).toBe((inv.legalTextIds as Record<string, string>)[l.type]);
      expect(l).toMatchObject({ channel: "whatsapp", actor: "paciente", invitationId: inv.id, externalRef: sub, professionalId: pro.id });
      expect(l.rowHash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect((await estadoPanel(clinicId, [patient.id]))[0]).toMatchObject({ status: "ACEPTADO", aceptados: 4 });
  });

  it("doble pulsación o botón antiguo: no duplica filas", async () => {
    const { patient, ref } = await altaAdulto();
    await responder(ref, "privacidad", "acepto");
    await responder(ref, "privacidad", "acepto");
    await responder(ref, "condiciones", "acepto"); // fuera de orden
    expect(await prisma.consentLog.count({ where: { patientId: patient.id } })).toBe(1);
  });

  it("dos pulsaciones simultáneas: una sola fila", async () => {
    const { patient, ref } = await altaAdulto();
    await Promise.all([responder(ref, "privacidad", "acepto"), responder(ref, "privacidad", "acepto"), responder(ref, "privacidad", "acepto")]);
    expect(await prisma.consentLog.count({ where: { patientId: patient.id } })).toBe(1);
  });

  it("No acepto en un obligatorio → RECHAZADO; Revisar permite cambiar de opinión", async () => {
    const { patient, ref } = await altaAdulto();
    await responder(ref, "privacidad", "acepto");
    expect(await responder(ref, "salud", "rechazo")).toMatchObject({ estado: "rechazado", documento_rechazado: "salud" });
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).status).toBe("RECHAZADO");
    // no avanza a los siguientes
    expect(await responder(ref, "tratamiento", "acepto")).toMatchObject({ estado: "rechazado" });

    expect(await procesarWebhook({ ref, accion: "revisar" })).toMatchObject({ estado: "ok", siguiente: "salud" });
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).status).toBe("PENDIENTE");
    for (const d of ["salud", "tratamiento", "condiciones"]) await responder(ref, d, "acepto");
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).status).toBe("ACEPTADO");
    const acciones = (await prisma.consentLog.findMany({ where: { patientId: patient.id, type: "DATOS_SALUD" }, orderBy: { seq: "asc" } })).map((l) => l.action);
    expect(acciones).toEqual(["RECHAZADO", "ACEPTADO"]);
  });

  it("un subscriber distinto al de la invitación no puede responder", async () => {
    const { ref } = await altaAdulto();
    expect(await procesarWebhook({ ref, subscriberId: "sub_intruso", accion: "empezar" })).toMatchObject({ estado: "invalido" });
  });

  it("pasadas las 72 h: caducado, no se registra y el paciente pasa a CADUCADO", async () => {
    const { patient, ref } = await altaAdulto();
    await responder(ref, "privacidad", "acepto");
    await prisma.consentInvitation.updateMany({ where: { patientId: patient.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await responder(ref, "salud", "acepto")).toMatchObject({ estado: "caducado", siguiente: "caducado" });
    expect(await prisma.consentLog.count({ where: { patientId: patient.id } })).toBe(1);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).status).toBe("CADUCADO");
    // reenvío: vuelve a PENDIENTE con un plazo nuevo
    expect((await reenviar(patient.id, pro)).ok).toBe(true);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).status).toBe("PENDIENTE");
  });

  it("el cron caduca las altas vencidas aunque nadie abra el chat", async () => {
    const { patient } = await altaAdulto();
    await prisma.consentInvitation.updateMany({ where: { patientId: patient.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await caducarVencidas({ id: patient.id })).toBe(1);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).status).toBe("CADUCADO");
  });

  it("recordatorio a las 24 h, una sola vez", async () => {
    const { patient } = await altaAdulto();
    await prisma.consentInvitation.updateMany({ where: { patientId: patient.id }, data: { sentAt: new Date(Date.now() - 25 * 3600_000) } });
    mc.llamadas = [];
    expect(await enviarRecordatorios()).toBeGreaterThanOrEqual(1);
    expect(mc.llamadas).toContainEqual(expect.objectContaining({ op: "flujo", flow: "flow_recordatorio" }));
    const n = mc.llamadas.length;
    await enviarRecordatorios();
    expect(mc.llamadas.filter((l) => l.op === "flujo" && l.flow === "flow_recordatorio" && l.sub === `sub_34${patient.phone}`).length).toBe(1);
    expect(mc.llamadas.length).toBeGreaterThanOrEqual(n);
  });

  it("si la etiqueta consent_ok falla al aceptar, el cron la reintenta", async () => {
    const { patient, ref, sub } = await altaAdulto();
    for (const d of ["privacidad", "salud", "tratamiento"]) await responder(ref, d, "acepto");
    mc.fallar = true;
    await responder(ref, "condiciones", "acepto");
    mc.fallar = false;
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).status).toBe("ACEPTADO");
    expect((await prisma.consentInvitation.findFirstOrThrow({ where: { patientId: patient.id } })).confirmPending).toBe(true);
    await reintentarConfirmaciones();
    expect(mc.llamadas).toContainEqual({ op: "etiqueta", sub, etiqueta: ETIQUETAS.consentOk });
    expect((await prisma.consentInvitation.findFirstOrThrow({ where: { patientId: patient.id } })).confirmPending).toBe(false);
  });
});

describe("4. ficha clínica", () => {
  it("solo su clínica, taller, recetador y admin; editable solo con consentimiento en vigor", async () => {
    const { patient, ref } = await altaAdulto();
    expect(tratamientoPermitido(patient)).toBe(false);
    await aceptarObligatorios(ref);
    const p = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(tratamientoPermitido(p)).toBe(true);
    await expect(exigirTratamientoPermitido(p.id)).resolves.toBeUndefined();
    expect(puedeVerFicha({ role: "PROFESIONAL", clinicId }, p)).toBe(true);
    expect(puedeVerFicha({ role: "ADMIN_CLINICA", clinicId }, p)).toBe(true);
    expect(puedeVerFicha({ role: "PROFESIONAL", clinicId: otraClinicaId }, p)).toBe(false);
    expect(puedeVerFicha({ role: "CLIENTE", clinicId: null }, p)).toBe(false);
    expect(puedeVerFicha({ role: "TALLER", clinicId: null }, p)).toBe(true);
    expect(puedeVerFicha({ role: "RECETADOR", clinicId: null }, p)).toBe(true);
  });
});

describe("5. acceso con DNI + móvil + código", () => {
  async function pacienteAceptadoConAcceso(dni: string) {
    const { patient, ref } = await altaAdulto();
    await aceptarObligatorios(ref);
    expect(await enviarAcceso(patient.id, pro)).toMatchObject({ ok: false }); // falta DNI
    await prisma.patient.update({ where: { id: patient.id }, data: { dni } });
    expect(await enviarAcceso(patient.id, pro)).toMatchObject({ ok: true, canal: "whatsapp" });
    expect(mc.campo(CAMPOS.urlAcceso)).toMatch(/\/acceso$/);
    return prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
  }

  it("crea la cuenta solo con el código correcto y la vincula al paciente", async () => {
    const p = await pacienteAceptadoConAcceso("12345678Z");
    mc.llamadas = [];
    // DNI que no coincide: misma respuesta y ningún código
    expect(await solicitarCodigo("87654321X", p.phone!)).toEqual({ ok: true });
    expect(mc.campo(CAMPOS.codigo)).toBeNull();
    // DNI con letra mal: error de formato
    expect((await solicitarCodigo("12345678A", p.phone!)).ok).toBe(false);

    expect(await solicitarCodigo("12345678-z", p.phone!)).toEqual({ ok: true });
    const codigo = mc.campo(CAMPOS.codigo)!;
    expect(codigo).toMatch(/^\d{6}$/);
    expect(mc.llamadas).toContainEqual(expect.objectContaining({ op: "flujo", flow: "flow_codigo" }));
    const otro = codigo === "000000" ? "000001" : "000000";
    expect(await crearCuentaConCodigo("12345678Z", p.phone!, otro, "una-clave-larga")).toMatchObject({ ok: false });
    expect(await crearCuentaConCodigo("12345678Z", p.phone!, codigo, "corta")).toMatchObject({ ok: false });
    const r = await crearCuentaConCodigo("12345678Z", p.phone!, codigo, "una-clave-larga");
    expect(r).toMatchObject({ ok: true, nueva: true });
    if (!r.ok) return;
    const u = await prisma.user.findUniqueOrThrow({ where: { id: r.userId } });
    expect(u).toMatchObject({ role: "CLIENTE", phone: p.phone });
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(u.id);
    // el código ya no vale
    expect(await crearCuentaConCodigo("12345678Z", p.phone!, codigo, "una-clave-larga")).toMatchObject({ ok: false });
  });

  it("5 intentos fallidos anulan el código", async () => {
    const p = await pacienteAceptadoConAcceso("X1234567L");
    await solicitarCodigo("X1234567L", p.phone!);
    const codigo = mc.campo(CAMPOS.codigo)!;
    const mal = codigo === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) await crearCuentaConCodigo("X1234567L", p.phone!, mal, "una-clave-larga");
    expect(await crearCuentaConCodigo("X1234567L", p.phone!, codigo, "una-clave-larga")).toMatchObject({ ok: false });
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBeNull();
  });

  it("si el móvil ya tiene cuenta, añade el paciente sin tocar la contraseña", async () => {
    const p = await pacienteAceptadoConAcceso("Y1234567X");
    const existente = await prisma.user.create({ data: { role: "CLIENTE", name: "Ya existía", phone: p.phone, passwordHash: "hash-original" } });
    await solicitarCodigo("Y1234567X", p.phone!);
    const r = await crearCuentaConCodigo("Y1234567X", p.phone!, mc.campo(CAMPOS.codigo)!, "otra-clave-larga");
    expect(r).toMatchObject({ ok: true, nueva: false, userId: existente.id });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: existente.id } })).passwordHash).toBe("hash-original");
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(existente.id);
  });
});

describe("6. revocación", () => {
  it("retirar datos de salud: fila nueva REVOCADO, ficha en solo lectura y evento en el caso", async () => {
    const { patient, ref, sub } = await altaAdulto();
    await aceptarObligatorios(ref);
    const antes = await prisma.consentLog.count({ where: { patientId: patient.id } });
    expect(await revocar({ patientId: patient.id, type: "DATOS_SALUD", actor: "paciente", channel: "web_gestion", ip: "1.2.3.4", userAgent: "test" })).toBe(true);
    const p = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id }, include: { cases: { include: { events: true } } } });
    expect(p.status).toBe("REVOCADO");
    expect(await prisma.consentLog.count({ where: { patientId: patient.id } })).toBe(antes + 1);
    const ultima = await prisma.consentLog.findFirstOrThrow({ where: { patientId: patient.id }, orderBy: { seq: "desc" } });
    expect(ultima).toMatchObject({ type: "DATOS_SALUD", action: "REVOCADO", ip: "1.2.3.4", channel: "web_gestion" });
    // la ficha no se borra
    expect(p.cases).toHaveLength(1);
    expect(p.cases[0].events.some((e) => /retirado/.test(e.text))).toBe(true);
    await expect(exigirTratamientoPermitido(p.id)).rejects.toThrow(/solo lectura/);
    expect(mc.llamadas).toContainEqual({ op: "quitar", sub, etiqueta: ETIQUETAS.consentOk });
    // revocar dos veces no duplica
    expect(await revocar({ patientId: patient.id, type: "DATOS_SALUD", actor: "paciente", channel: "web_gestion" })).toBe(false);
  });

  it("volver tras revocar: nueva invitación y aceptar otra vez reutiliza el caso abierto", async () => {
    const { patient, ref } = await altaAdulto();
    await aceptarObligatorios(ref);
    await revocar({ patientId: patient.id, type: "TRATAMIENTO", actor: "profesional", channel: "panel", actorUserId: pro.id });
    expect((await reenviar(patient.id, pro)).ok).toBe(true);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).status).toBe("PENDIENTE");
    await aceptarObligatorios(mc.campo(CAMPOS.ref)!);
    const p = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id }, include: { cases: true } });
    expect(p.status).toBe("ACEPTADO");
    expect(p.cases).toHaveLength(1);
    const audit = await prisma.auditLog.findFirst({ where: { patientId: patient.id, action: "consent.revoke" } });
    expect(audit?.userId).toBe(pro.id);
  });

  it("marketing: retirar y reactivar no afecta al tratamiento", async () => {
    const { patient, ref, sub } = await altaAdulto();
    await aceptarObligatorios(ref);
    await responder(ref, "marketing", "acepto");
    expect(mc.llamadas).toContainEqual({ op: "etiqueta", sub, etiqueta: ETIQUETAS.marketingOk });
    await revocar({ patientId: patient.id, type: "MARKETING", actor: "paciente", channel: "web_perfil" });
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } })).status).toBe("ACEPTADO");
    expect(mc.llamadas).toContainEqual({ op: "quitar", sub, etiqueta: ETIQUETAS.marketingOk });
    expect(await reactivarMarketing({ patientId: patient.id, actor: "paciente", channel: "web_perfil" })).toBe(true);
    expect((await estadoActual(prisma, patient.id)).MARKETING?.action).toBe("ACEPTADO");
  });
});

describe("7. webhook HTTP", () => {
  const llamar = (body: unknown, secret?: string) =>
    webhookPOST(
      new Request("http://localhost/api/manychat/consentimiento", {
        method: "POST",
        headers: { "content-type": "application/json", ...(secret ? { "x-ortosend-secret": secret } : {}) },
        body: JSON.stringify(body),
      })
    );

  it("rechaza llamadas sin la clave secreta", async () => {
    const { ref } = await altaAdulto();
    expect((await llamar({ ref, accion: "empezar" })).status).toBe(401);
    expect((await llamar({ ref, accion: "empezar" }, "otra")).status).toBe(401);
  });

  it("con la clave responde lo siguiente que debe mostrar ManyChat", async () => {
    const { ref, sub } = await altaAdulto();
    const res = await llamar({ ref, subscriber_id: sub, accion: "respuesta", documento: "privacidad", respuesta: "Acepto" }, "webhook-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ estado: "ok", siguiente: "salud" });
  });
});
