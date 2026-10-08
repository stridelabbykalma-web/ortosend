// Registro web: las mismas 5 casillas y el mismo consent_log que el alta por WhatsApp.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { estadoActual, obligatoriosEnVigor } from "@/lib/consent/registro";
import { faltanObligatorios, leerConsentimientos, registrarConsentimientosWeb } from "@/lib/consent/web";

const form = (marcas: string[]) => {
  const f = new FormData();
  for (const m of marcas) f.set(m, "on");
  return f;
};
const TODAS = ["c_privacidad", "c_salud", "c_tratamiento", "c_condiciones"];

describe("registro web", () => {
  it("exige los cuatro obligatorios; marketing es opcional", () => {
    expect(faltanObligatorios(leerConsentimientos(form(TODAS)))).toBe(false);
    expect(faltanObligatorios(leerConsentimientos(form(["c_privacidad", "c_salud"])))).toBe(true);
  });

  it("registra cada documento en consent_log con canal web_registro y versión vigente", async () => {
    const u = await prisma.user.create({ data: { role: "CLIENTE", name: "Web Uno", email: "web.uno@test.com", phone: "699111222" } });
    const p = await prisma.patient.create({ data: { ownerId: u.id, name: "Web Uno", status: "ACEPTADO" } });
    await registrarConsentimientosWeb(prisma, {
      patientId: p.id,
      marcas: leerConsentimientos(form(TODAS)),
      actor: "paciente",
      actorUserId: u.id,
      ip: "1.2.3.4",
    });
    const e = await estadoActual(prisma, p.id);
    expect(obligatoriosEnVigor(e)).toBe(true);
    expect(e.MARKETING?.action).toBe("RECHAZADO");
    const filas = await prisma.consentLog.findMany({ where: { patientId: p.id } });
    expect(filas).toHaveLength(5);
    expect(filas.every((f) => f.channel === "web_registro" && f.legalTextId)).toBe(true);
  });
});
