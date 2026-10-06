// Protección a nivel de base de datos: consent_log, legal_texts y AuditLog solo
// admiten INSERT, la huella de los textos la calcula la BD y la cadena de
// hashes de consent_log delata cualquier alteración.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { publicarTexto, registrar, textosVigentes } from "@/lib/consent/registro";
import { createHash } from "crypto";

let patientId: string;
let userId: string;

beforeAll(async () => {
  const p = await prisma.patient.create({ data: { name: "Prueba", lastName: "Append", status: "ACEPTADO" } });
  patientId = p.id;
  userId = (await prisma.user.create({ data: { role: "ADMIN", name: "Admin test" } })).id;
  const textos = await textosVigentes(prisma);
  for (const t of ["PRIVACIDAD", "DATOS_SALUD"] as const)
    await registrar(prisma, { patientId, professionalId: null, type: t, action: "ACEPTADO", legalTextId: textos[t].id, actor: "paciente", channel: "whatsapp" });
});

describe("consent_log", () => {
  it("no admite UPDATE, DELETE ni TRUNCATE", async () => {
    await expect(prisma.consentLog.updateMany({ where: { patientId }, data: { action: "REVOCADO" } })).rejects.toThrow(/solo inserción/);
    await expect(prisma.consentLog.deleteMany({ where: { patientId } })).rejects.toThrow(/solo inserción/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "consent_log"`)).rejects.toThrow(/solo inserción/);
    expect(await prisma.consentLog.count({ where: { patientId } })).toBe(2);
  });

  it("no se puede borrar un paciente con consentimientos", async () => {
    await expect(prisma.patient.delete({ where: { id: patientId } })).rejects.toThrow();
  });

  it("la BD fija hora, orden y cadena de hashes; la verificación detecta alteraciones", async () => {
    const rows = await prisma.consentLog.findMany({ orderBy: { seq: "asc" } });
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].seq > rows[i - 1].seq).toBe(true);
      expect(rows[i].prevHash).toBe(rows[i - 1].rowHash);
    }
    expect(rows[0].prevHash).toBe("GENESIS");
    expect(await prisma.$queryRaw`SELECT * FROM consent_log_verify()`).toEqual([]);

    // Un superusuario que desactiva el trigger y altera una fila queda en evidencia.
    const victima = rows[rows.length - 1];
    await prisma.$executeRawUnsafe(`ALTER TABLE "consent_log" DISABLE TRIGGER consent_log_no_update`);
    await prisma.$executeRawUnsafe(`UPDATE "consent_log" SET "action" = 'REVOCADO' WHERE "id" = $1`, victima.id);
    const roto = await prisma.$queryRaw<{ seq: bigint; motivo: string }[]>`SELECT * FROM consent_log_verify()`;
    await prisma.$executeRawUnsafe(`UPDATE "consent_log" SET "action" = $2::"ConsentAction" WHERE "id" = $1`, victima.id, victima.action);
    await prisma.$executeRawUnsafe(`ALTER TABLE "consent_log" ENABLE TRIGGER consent_log_no_update`);
    expect(roto).toEqual([{ seq: victima.seq, motivo: "contenido alterado" }]);
    expect(await prisma.$queryRaw`SELECT * FROM consent_log_verify()`).toEqual([]);
  });
});

describe("legal_texts", () => {
  it("v1 de cada documento existe como placeholder, con su SHA-256 calculado por la BD", async () => {
    const textos = await textosVigentes(prisma);
    for (const t of Object.values(textos)) {
      expect(t.content).toMatch(/PENDIENTE/);
      expect(t.sha256).toBe(createHash("sha256").update(t.content, "utf8").digest("hex"));
    }
  });

  it("no se editan: cambiar un texto crea la versión siguiente", async () => {
    const v1 = (await textosVigentes(prisma)).CONDICIONES;
    await expect(prisma.legalText.update({ where: { id: v1.id }, data: { content: "otro" } })).rejects.toThrow(/solo inserción/);
    await expect(prisma.legalText.delete({ where: { id: v1.id } })).rejects.toThrow(/solo inserción/);
    const v2 = await publicarTexto(prisma, "CONDICIONES", "Condiciones del servicio", "Texto nuevo de condiciones");
    expect(v2.version).toBe(v1.version + 1);
    expect(v2.sha256).toBe(createHash("sha256").update("Texto nuevo de condiciones").digest("hex"));
    expect((await textosVigentes(prisma)).CONDICIONES.id).toBe(v2.id);
    expect((await prisma.legalText.findUniqueOrThrow({ where: { id: v1.id } })).content).toBe(v1.content);
  });
});

describe("AuditLog", () => {
  it("no admite UPDATE ni DELETE", async () => {
    const a = await prisma.auditLog.create({ data: { userId, action: "patient.view", target: `patient:${patientId}`, patientId } });
    await expect(prisma.auditLog.update({ where: { id: a.id }, data: { action: "x" } })).rejects.toThrow(/solo inserción/);
    await expect(prisma.auditLog.delete({ where: { id: a.id } })).rejects.toThrow(/solo inserción/);
  });
});
