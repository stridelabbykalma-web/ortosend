// Arreglos de la revisión de seguridad previa al lanzamiento, contra Postgres real.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createAppToken, hashPassword } from "@/lib/auth";
import { registrarSaludReserva, estadoActual } from "@/lib/consent/registro";
import { CAMPO_TRAMPA, pareceBot } from "@/lib/antibot";
import { GET as verMedia } from "@/app/api/media/[id]/route";

const pet = (token: string) => new Request("http://localhost/api/media/x", { headers: { authorization: `Bearer ${token}` } });
const conId = (id: string) => ({ params: Promise.resolve({ id }) });

let clinicId = "";
let tokenTaller = "";
let tokenAdmin = "";

async function casoConVideo(estado: "ESTUDIO_EN_CURSO" | "FABRICACION") {
  const patient = await prisma.patient.create({ data: { name: `Paciente ${estado}`, clinicId, status: "ACEPTADO" } });
  const kase = await prisma.case.create({
    data: { patientId: patient.id, clinicId, flow: "B", state: estado, fabPhase: estado === "FABRICACION" ? "MECANIZADO" : null },
  });
  const captura = await prisma.capture.create({ data: { caseId: kase.id } });
  const m = await prisma.mediaAsset.create({
    data: { captureId: captura.id, kind: "video_post_descalzo", url: "", confirmedAt: new Date() },
  });
  await prisma.mediaAsset.update({
    where: { id: m.id },
    data: { url: `/api/media/${m.id}`, blob: { create: { mime: "video/webm", bytes: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) } } },
  });
  return { patientId: patient.id, mediaId: m.id };
}

beforeAll(async () => {
  clinicId = (await prisma.clinic.create({ data: { name: "Clínica Seguridad", address: "C/ 1", town: "Lleida", postalCode: "25001" } })).id;
  const taller = await prisma.user.create({
    data: { role: "TALLER", name: "Taller", email: "taller-seg@ortosend.test", passwordHash: await hashPassword("clave-taller") },
  });
  const admin = await prisma.user.create({
    data: { role: "ADMIN", name: "Admin", email: "admin-seg@ortosend.test", passwordHash: await hashPassword("clave-admin") },
  });
  tokenTaller = await createAppToken(taller);
  tokenAdmin = await createAppToken(admin);
});

describe("vídeos y fotos: el taller solo los de sus pedidos", () => {
  it("un caso aún en estudio no lo ve el taller (sí el administrador); uno en fabricación, sí", async () => {
    const enEstudio = await casoConVideo("ESTUDIO_EN_CURSO");
    expect((await verMedia(pet(tokenTaller), conId(enEstudio.mediaId))).status).toBe(403);
    expect((await verMedia(pet(tokenAdmin), conId(enEstudio.mediaId))).status).toBe(200);
    const enTaller = await casoConVideo("FABRICACION");
    const r = await verMedia(pet(tokenTaller), conId(enTaller.mediaId));
    expect(r.status).toBe(200);
    // Datos de salud: sin caché en el navegador y sin interpretarse como otra cosa.
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("consentimiento de la reserva web en el registro inalterable", () => {
  it("queda en consent_log con la versión del texto en vigor, el canal y quién", async () => {
    const { patientId } = await casoConVideo("ESTUDIO_EN_CURSO");
    const owner = await prisma.user.create({ data: { role: "CLIENTE", name: "Titular", email: "titular-seg@ortosend.test" } });
    await registrarSaludReserva(prisma, { patientId, actor: "paciente", actorUserId: owner.id, ip: "1.2.3.4", userAgent: "Prueba" });
    const fila = await prisma.consentLog.findFirstOrThrow({ where: { patientId } });
    expect(fila).toMatchObject({ type: "DATOS_SALUD", action: "ACEPTADO", channel: "web_reserva", ip: "1.2.3.4", actorUserId: owner.id });
    expect(fila.rowHash).not.toBe("");
    expect((await estadoActual(prisma, patientId)).DATOS_SALUD?.action).toBe("ACEPTADO");
  });
});

describe("formularios públicos: campo trampa", () => {
  it("si se rellena el campo invisible se rechaza; vacío pasa (sin Turnstile configurado)", async () => {
    const f = new FormData();
    expect(await pareceBot(f)).toBeNull();
    f.set(CAMPO_TRAMPA, "http://spam.example");
    expect(await pareceBot(f)).toMatch(/No hemos podido/);
  });
});
