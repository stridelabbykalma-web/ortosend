// Avisos del tratamiento por ManyChat: salen por WhatsApp cuando su flujo está
// configurado; si no (o sin consentimiento), por email. Nunca sale la «nota».
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { usarManyChat, CAMPOS } from "@/lib/manychat";
import { avisarPaciente } from "@/lib/cases";
import { FakeManyChat } from "../fake-manychat";

let mc: FakeManyChat;
let n = 0;

async function paciente(opts: { whatsapp: boolean; email?: string | null }) {
  n++;
  const phone = String(699000000 + n);
  const owner = await prisma.user.create({
    data: { role: "CLIENTE", name: `Ana Pérez ${n}`, phone, email: opts.email === undefined ? `ana${n}@test.com` : opts.email },
  });
  return prisma.patient.create({
    data: {
      ownerId: owner.id,
      name: `Ana Pérez ${n}`,
      status: "ACEPTADO",
      consents: { whatsapp: { aceptado: opts.whatsapp } },
    },
  });
}

const notifs = (template: string, caseId: string) =>
  prisma.notification.findMany({ where: { template, payload: { path: ["caseId"], equals: caseId } } });

beforeEach(() => {
  mc = new FakeManyChat();
  usarManyChat(mc);
  process.env.MANYCHAT_FLOWS_AVISOS = JSON.stringify({ cita_confirmada: "flow_cita", no_prescrito: "flow_no_rx", cuenta_traspasada: "flow_traspaso" });
});
afterEach(() => {
  delete process.env.MANYCHAT_FLOWS_AVISOS;
});

describe("avisos por ManyChat", () => {
  it("con flujo configurado sale por WhatsApp con los huecos logísticos y sin email", async () => {
    const p = await paciente({ whatsapp: true });
    await avisarPaciente(p.id, "cita_confirmada", {
      caseId: "c1",
      clinica: "Clínica Girona Centre",
      direccion: "C/ Mayor 1",
      fecha: "2026-10-14T08:00:00.000Z",
      nota: "Trae tu calzado habitual",
    });
    expect(mc.llamadas).toContainEqual(expect.objectContaining({ op: "flujo", flow: "flow_cita" }));
    expect(mc.campo(CAMPOS.avisoClinica)).toBe("Clínica Girona Centre");
    expect(mc.campo(CAMPOS.avisoDireccion)).toBe("C/ Mayor 1");
    expect(mc.campo(CAMPOS.avisoFecha)).toMatch(/miércoles, 14 de octubre de 2026.*10:00/);
    expect(mc.campo(CAMPOS.avisoEnlace)).toMatch(/^https:\/\/.+\/panel$/);
    const ns = await notifs("cita_confirmada", "c1");
    expect(ns.map((x) => [x.channel, !!x.sentAt])).toEqual([["whatsapp", true]]);
  });

  it("la nota (puede llevar detalle clínico) nunca sale hacia ManyChat", async () => {
    const p = await paciente({ whatsapp: true });
    await avisarPaciente(p.id, "no_prescrito", { caseId: "c2", nota: "Recomendación: fascitis plantar, fisioterapia" });
    expect(mc.llamadas.some((l) => l.op === "flujo")).toBe(true);
    expect(JSON.stringify(mc.llamadas)).not.toMatch(/fascitis|fisioterapia|Recomendación/);
  });

  it("sin flujo configurado (mensaje aún no aprobado) cae al email", async () => {
    const p = await paciente({ whatsapp: true });
    await avisarPaciente(p.id, "enviado", { caseId: "c3", nota: "En camino" });
    expect(mc.llamadas).toHaveLength(0);
    const ns = await notifs("enviado", "c3");
    expect(ns.map((x) => x.channel).sort()).toEqual(["email", "whatsapp"]);
    expect(ns.find((x) => x.channel === "whatsapp")?.sentAt).toBeNull();
  });

  it("si no aceptó WhatsApp, solo email y nada a ManyChat", async () => {
    const p = await paciente({ whatsapp: false });
    await avisarPaciente(p.id, "cita_confirmada", { caseId: "c4", clinica: "X" });
    expect(mc.llamadas).toHaveLength(0);
    expect((await notifs("cita_confirmada", "c4")).map((x) => x.channel)).toEqual(["email"]);
  });

  it("si ManyChat falla, cae al email", async () => {
    const p = await paciente({ whatsapp: true });
    mc.fallar = true;
    await avisarPaciente(p.id, "cita_confirmada", { caseId: "c5", clinica: "X" });
    const ns = await notifs("cita_confirmada", "c5");
    expect(ns.map((x) => x.channel).sort()).toEqual(["email", "whatsapp"]);
  });

  it("los cambios de titularidad van por WhatsApp y además por email", async () => {
    const p = await paciente({ whatsapp: true });
    await avisarPaciente(p.id, "cuenta_traspasada", { caseId: "c6" });
    expect((await notifs("cuenta_traspasada", "c6")).map((x) => x.channel).sort()).toEqual(["email", "whatsapp"]);
  });

  it("reutiliza el contacto de ManyChat del alta por WhatsApp", async () => {
    const p = await paciente({ whatsapp: true });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: p.ownerId! } });
    await prisma.consentInvitation.create({
      data: {
        patientId: p.id,
        refHash: `hash-${p.id}`,
        recipient: "paciente",
        toPhone: owner.phone!,
        legalTextIds: {},
        manychatSubscriberId: "sub_del_alta",
        expiresAt: new Date(),
        createdById: owner.id,
      },
    });
    await avisarPaciente(p.id, "cita_confirmada", { caseId: "c7", clinica: "X" });
    expect(mc.llamadas.some((l) => l.op === "contacto")).toBe(false);
    expect(mc.llamadas).toContainEqual(expect.objectContaining({ op: "flujo", sub: "sub_del_alta" }));
  });
});
