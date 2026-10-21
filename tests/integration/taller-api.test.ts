// API del taller para Ortosend Taller (programa del taller) contra Postgres real:
// entrar con el usuario de TALLER, lista en orden de salida, hoja de confección con coste,
// materiales y ajustes, y cambios de estado con las mismas guardas que el panel.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { POST as entrar } from "@/app/api/taller/sesion/route";
import { GET as listar } from "@/app/api/taller/pedidos/route";
import { GET as detalle } from "@/app/api/taller/pedidos/[id]/route";
import { PUT as guardarHoja } from "@/app/api/taller/pedidos/[id]/hoja/route";
import { POST as fresado } from "@/app/api/taller/pedidos/[id]/fresado/route";
import { POST as confeccion } from "@/app/api/taller/pedidos/[id]/confeccion/route";
import { GET as verMateriales, PUT as guardarMateriales } from "@/app/api/taller/materiales/route";
import { GET as verAjustes, PUT as guardarAjustes } from "@/app/api/taller/ajustes/route";
import { POST as registrarMaterial } from "@/app/api/taller/pedidos/[id]/materiales/route";
import { POST as anular } from "@/app/api/taller/consumos/[id]/anular/route";
import { GET as buscarLote } from "@/app/api/taller/lotes/route";
import { GET as verMedia } from "@/app/api/media/[id]/route";
import { GET as verRecetaPdf } from "@/app/api/rx-pdf/[caseId]/route";

// Foto de la etiqueta (un JPEG mínimo) + lo leído del código de barras.
const formMaterial = (token: string, campos: Record<string, string>, conFoto = true) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  if (conFoto) f.set("foto", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])], "etiqueta.jpg", { type: "image/jpeg" }));
  return new Request(URL, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: f });
};

const URL = "http://localhost/api/taller";
const pet = (metodo: string, token?: string, body?: unknown) =>
  new Request(URL, {
    method: metodo,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const conId = (id: string) => ({ params: Promise.resolve({ id }) });

let token = "";
let tokenAdmin = "";
let tallerId = "";
let clinicId = "";
const casos: Record<string, string> = {};

async function crearCaso(nombre: string, opciones: { pagadoHaceDias: number; fase: "MECANIZADO" | "CONFECCION"; estado?: "FABRICACION" | "DISENO"; aceptado?: boolean }) {
  const patient = await prisma.patient.create({
    data: { name: nombre, lastName: "Prueba", clinicId, status: opciones.aceptado === false ? "REVOCADO" : "ACEPTADO" },
  });
  const pagado = new Date(Date.now() - opciones.pagadoHaceDias * 24 * 3600 * 1000);
  const kase = await prisma.case.create({
    data: {
      patientId: patient.id,
      clinicId,
      flow: "B",
      state: opciones.estado ?? "FABRICACION",
      fabPhase: opciones.estado === "DISENO" ? null : opciones.fase,
      delivery: "CLINICA",
      payment: { create: { paidAt: pagado } },
      prescription: {
        create: {
          prescriberId: tallerId,
          prescriberName: "Dra. Receta",
          collegiateNum: "123",
          assessment: "—",
          diagnosis: "Pie plano",
          fabricationOrder: "Plantilla EVA con relleno de arco",
          orderLeft: "Skive medial 4 mm",
          usageGuidelines: "—",
        },
      },
    },
  });
  return kase.id;
}

beforeAll(async () => {
  const c = await prisma.clinic.create({ data: { name: "Clínica Taller", address: "C/ 1", town: "Lleida", postalCode: "25001" } });
  clinicId = c.id;
  const u = await prisma.user.create({
    data: { role: "TALLER", name: "Toni Taller", email: "taller@ortosend.test", passwordHash: await hashPassword("clave-taller") },
  });
  tallerId = u.id;
  await prisma.user.create({
    data: { role: "ADMIN", name: "Admin", email: "admin@ortosend.test", passwordHash: await hashPassword("clave-admin") },
  });
  await prisma.user.create({
    data: { role: "PROFESIONAL", name: "Pro", email: "pro@ortosend.test", passwordHash: await hashPassword("clave-pro"), clinicId },
  });
  casos.reciente = await crearCaso("Reciente", { pagadoHaceDias: 0, fase: "MECANIZADO" });
  casos.antiguo = await crearCaso("Antiguo", { pagadoHaceDias: 12, fase: "CONFECCION" });
  casos.revocado = await crearCaso("Revocado", { pagadoHaceDias: 1, fase: "MECANIZADO", aceptado: false });
});

describe("entrar", () => {
  it("con el usuario de taller devuelve un token; mal o sin ser de taller, no", async () => {
    expect((await entrar(pet("POST", undefined, { email: "taller@ortosend.test", password: "mal" }))).status).toBe(401);
    const pro = await entrar(pet("POST", undefined, { email: "pro@ortosend.test", password: "clave-pro" }));
    expect(pro.status).toBe(403);
    const r = await entrar(pet("POST", undefined, { email: " Taller@Ortosend.test ", password: "clave-taller" }));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.nombre).toBe("Toni Taller");
    token = j.token;
    tokenAdmin = (await (await entrar(pet("POST", undefined, { email: "admin@ortosend.test", password: "clave-admin" }))).json()).token;
  });
  it("sin token o con token falso: 401", async () => {
    expect((await listar(pet("GET"))).status).toBe(401);
    expect((await listar(pet("GET", "falso"))).status).toBe(401);
  });
});

describe("pedidos", () => {
  it("en el orden de salida: el fuera de plazo primero", async () => {
    const r = await listar(pet("GET", token));
    expect(r.status).toBe(200);
    const { pedidos } = await r.json();
    const nuestros = pedidos.filter((p: { id: string }) => Object.values(casos).includes(p.id));
    expect(nuestros[0].id).toBe(casos.antiguo);
    expect(nuestros[0].plazo.nivel).toBe("fuera");
    expect(nuestros[0]).toMatchObject({ paciente: "Antiguo Prueba", clinica: "Clínica Taller", paso: "Confección" });
    // Datos mínimos: nada clínico en la lista.
    expect(JSON.stringify(pedidos)).not.toMatch(/Pie plano|diagn/i);
  });
  it("el detalle trae la pauta por pie y deja constancia del acceso", async () => {
    const r = await detalle(pet("GET", token), conId(casos.reciente));
    const d = await r.json();
    expect(d.pies[0]).toMatchObject({ pie: "I", pauta: "Skive medial 4 mm", especifica: true });
    expect(d.pies[1]).toMatchObject({ pie: "D", pauta: "Plantilla EVA con relleno de arco", especifica: false });
    expect(d.hoja).toBeNull();
    const log = await prisma.auditLog.findFirst({ where: { userId: tallerId, action: "case.view" }, orderBy: { at: "desc" } });
    expect(log?.detail).toMatchObject({ via: "rectificador" });
  });
});

describe("expediente del pedido (receta, vídeos y fotos, cuestionario y exploración)", () => {
  let videoId = "";
  beforeAll(async () => {
    await prisma.case.update({ where: { id: casos.reciente }, data: { reason: "Dolor de talón al correr" } });
    await prisma.prescription.update({
      where: { caseId: casos.reciente },
      data: { pdfBytes: Buffer.from("%PDF-1.4 receta"), pdfSha256: "abc", assessment: "Pronación marcada" },
    });
    const captura = await prisma.capture.create({
      data: { caseId: casos.reciente, questionnaire: {}, physicalExam: {} },
    });
    const video = await prisma.mediaAsset.create({
      data: { captureId: captura.id, kind: "video_post_descalzo", url: "", confirmedAt: new Date(), meta: { seconds: 6, mime: "video/webm" } },
    });
    videoId = video.id;
    await prisma.mediaAsset.update({
      where: { id: video.id },
      data: { url: `/api/media/${video.id}`, blob: { create: { mime: "video/webm", bytes: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) } } },
    });
    const foto = await prisma.mediaAsset.create({
      data: {
        captureId: captura.id,
        kind: "foto_posterior",
        url: "",
        confirmedAt: new Date(),
        meta: { helbing: { dcha: { deg: 7, lado: "valgo" }, izq: { deg: 4, lado: "neutro" } } },
      },
    });
    await prisma.mediaAsset.update({
      where: { id: foto.id },
      data: { url: `/api/media/${foto.id}`, blob: { create: { mime: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) } } },
    });
    await prisma.mediaAsset.create({
      data: { captureId: captura.id, kind: "scan_espumas", url: "", confirmedAt: new Date(), meta: { proyecto: "Reciente 600111222" } },
    });
  });

  it("el detalle trae la receta, los vídeos y fotos con su análisis, el cuestionario y el escaneo", async () => {
    const d = await (await detalle(pet("GET", token), conId(casos.reciente))).json();
    expect(d.aviso).toBeNull();
    expect(d.diagnostico).toBe("Pie plano");
    expect(d.receta).toMatchObject({
      prescriptor: "Dra. Receta",
      colegiado: "123",
      diagnostico: "Pie plano",
      valoracion: "Pronación marcada",
      pauta: "Plantilla EVA con relleno de arco",
      pautaIzq: "Skive medial 4 mm",
      pdf: `/api/rx-pdf/${casos.reciente}`,
    });
    expect(d.estudio.map((m: { tipo: string }) => m.tipo)).toEqual(["video", "foto"]);
    expect(d.estudio[0]).toMatchObject({ url: `/api/media/${videoId}`, segundos: 6, mime: "video/webm" });
    expect(d.estudio[1].resumen.join(" ")).toMatch(/Helbing.*7° valgo/);
    expect(d.expediente[0]).toMatchObject({ titulo: "Cuestionario clínico" });
    expect(d.expediente[0].filas[0]).toEqual(["Motivo indicado al reservar", "Dolor de talón al correr"]);
    expect(d.escaneo).toEqual({ proyecto: "Reciente 600111222", clinica: "Clínica Taller" });
  });

  it("sin consentimientos en vigor no trae nada clínico", async () => {
    const d = await (await detalle(pet("GET", token), conId(casos.revocado))).json();
    expect(d.receta).toBeNull();
    expect(d.estudio).toBeNull();
    expect(d.expediente).toBeNull();
    expect(d.aviso).toMatch(/consentimientos/);
  });

  it("el vídeo y la receta firmada se bajan con el token del programa, y queda registrado", async () => {
    const v = await verMedia(pet("GET", token), conId(videoId));
    expect(v.status).toBe(200);
    expect(v.headers.get("content-type")).toBe("video/webm");
    expect(new Uint8Array(await v.arrayBuffer())).toEqual(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));
    const r = await verRecetaPdf(pet("GET", token), { params: Promise.resolve({ caseId: casos.reciente }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(await r.text()).toMatch(/^%PDF/);
    const acciones = (await prisma.auditLog.findMany({ where: { userId: tallerId, action: { in: ["media.view", "prescription.pdf"] } } }))
      .map((l) => l.action);
    expect(acciones).toEqual(expect.arrayContaining(["media.view", "prescription.pdf"]));
  });

  it("sin token o con un token falso no se baja nada", async () => {
    expect((await verMedia(pet("GET"), conId(videoId))).status).toBe(401);
    expect((await verMedia(pet("GET", "falso"), conId(videoId))).status).toBe(401);
    expect((await verRecetaPdf(pet("GET", "falso"), { params: Promise.resolve({ caseId: casos.reciente }) })).status).toBe(401);
  });
});

describe("hoja de confección y coste", () => {
  it("el taller no ve costes ni precios; el administrador sí", async () => {
    expect((await verAjustes(pet("GET", token))).status).toBe(403);
    expect((await guardarAjustes(pet("PUT", token, { precioHoraCents: 1 }))).status).toBe(403);
    const ajustes = await guardarAjustes(
      pet("PUT", tokenAdmin, { precioHoraCents: 2400, costeCncMinutoCents: 10, costeMoldeCents: 500, minutosCnc: 30, minutosConfeccion: 40 })
    );
    expect(ajustes.status).toBe(200);
    const delTaller = (await (await verMateriales(pet("GET", token))).json()).materiales;
    const eva = delTaller.find((m: { id: string }) => m.id === "mat_eva_3_45");
    expect(eva.nombre).toBe("EVA 3 mm");
    expect(eva).not.toHaveProperty("precioCents");
    expect(eva).not.toHaveProperty("paresPorPlancha");
    const delAdmin = (await (await verMateriales(pet("GET", tokenAdmin))).json()).materiales;
    expect(delAdmin.find((m: { id: string }) => m.id === "mat_eva_3_45")).toMatchObject({ precioCents: 2500, paresPorPlancha: 20 });
  });
  it("guarda la hoja; el coste se calcula en la web pero solo lo ve el administrador", async () => {
    const r = await guardarHoja(
      pet("PUT", token, {
        proceso: "TERMOFORMADO",
        capas: [{ materialId: "mat_eva_3_45", pies: "par" }, { materialId: "mat_forro_piel", pies: "par", notas: "negro" }],
        minutosCnc: 20,
        minutosConfeccion: 30,
        notas: "Revisar arco",
      }),
      conId(casos.reciente)
    );
    expect(r.status).toBe(200);
    const { hoja } = await r.json();
    expect(hoja).not.toHaveProperty("coste");
    expect(hoja.capas[1]).toEqual({ materialId: "mat_forro_piel", pies: "par", notas: "negro", nombre: "Forro piel sintética" });
    expect(hoja.actualizadoPor).toBe("Toni Taller");
    const comoAdmin = (await (await detalle(pet("GET", tokenAdmin), conId(casos.reciente))).json()).hoja;
    expect(comoAdmin.coste).toEqual({ materialCents: 125 + 100, fresadoCents: 20 * 10 + 500, manoObraCents: 1200, totalCents: 225 + 700 + 1200 });
    expect(comoAdmin.capas[1].cents).toBe(100);
    const delTaller = (await (await detalle(pet("GET", token), conId(casos.reciente))).json()).hoja;
    expect(JSON.stringify(delTaller)).not.toMatch(/cents|coste/i);
  });
  it("rechaza datos malos", async () => {
    const malo = await guardarHoja(pet("PUT", token, { proceso: "OTRO", capas: [] }), conId(casos.reciente));
    expect(malo.status).toBe(400);
    const sinMaterial = await guardarHoja(pet("PUT", token, { proceso: "CAPAS", capas: [{ materialId: "no-existe" }] }), conId(casos.reciente));
    expect(sinMaterial.status).toBe(400);
    expect((await sinMaterial.json()).error).toMatch(/material/);
  });
  it("con el consentimiento retirado no se edita", async () => {
    const r = await guardarHoja(pet("PUT", token, { proceso: "CAPAS", capas: [] }), conId(casos.revocado));
    expect(r.status).toBe(409);
  });
});

describe("estados", () => {
  it("molde fresado → confección; dos veces no", async () => {
    const r = await fresado(pet("POST", token, { lote: "L-07" }), conId(casos.reciente));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ fase: "CONFECCION", lote: "L-07" });
    const otra = await fresado(pet("POST", token, { lote: "L-07" }), conId(casos.reciente));
    expect(otra.status).toBe(409);
  });
  it("confección terminada → calidad, solo con los materiales registrados (trazabilidad)", async () => {
    const sin = await confeccion(pet("POST", token, { material: "EVA lote M-1" }), conId(casos.antiguo));
    expect(sin.status).toBe(409);
    expect((await sin.json()).error).toMatch(/Registra antes los materiales/);
    // Se escanea la etiqueta GS1 de la plancha: foto + lote + caducidad.
    const codigo = "]C1010841234567890517271231" + "10EVA-7781";
    const r1 = await registrarMaterial(
      formMaterial(token, { codigo, lote: "EVA-7781", caducidad: "2027-12-31", gtin: "08412345678905", materialId: "mat_eva_3_45", pies: "par" }),
      conId(casos.antiguo)
    );
    expect(r1.status).toBe(200);
    const { material } = await r1.json();
    expect(material).toMatchObject({ material: "EVA 3 mm", lote: "EVA-7781", caducidad: "2027-12-31", pies: "par", quien: "Toni Taller" });
    expect(material.foto).toMatch(/^\/api\/media\//);
    // La siguiente vez el mismo código se reconoce solo.
    const conocido = await (await buscarLote(new Request(`${URL}/lotes?codigo=${encodeURIComponent(codigo)}`, { headers: { authorization: `Bearer ${token}` } }))).json();
    expect(conocido.lote).toMatchObject({ lote: "EVA-7781", materialId: "mat_eva_3_45" });
    expect(conocido.etiqueta).toMatchObject({ esGs1: true, lote: "EVA-7781", caducidad: "2027-12-31" });
    // Sin código legible: lote escrito a mano (y sin foto también vale, aunque se recomienda).
    const r2 = await registrarMaterial(formMaterial(token, { codigo: "", lote: "f-22", materialId: "mat_forro_piel", pies: "I" }, false), conId(casos.antiguo));
    expect(r2.status).toBe(200);
    expect((await registrarMaterial(formMaterial(token, { lote: "", materialId: "mat_forro_piel" }), conId(casos.antiguo))).status).toBe(400);
    // Un registro equivocado se anula (con motivo), no se borra.
    const r3 = await registrarMaterial(formMaterial(token, { lote: "X1", materialId: "mat_pp_2" }), conId(casos.antiguo));
    const malo = (await r3.json()).material;
    expect((await anular(pet("POST", token, { motivo: "" }), conId(malo.id))).status).toBe(400);
    expect((await anular(pet("POST", token, { motivo: "No era esa plancha" }), conId(malo.id))).status).toBe(200);
    expect((await anular(pet("POST", token, { motivo: "otra vez" }), conId(malo.id))).status).toBe(409);
    await expect(prisma.consumoMaterial.delete({ where: { id: malo.id } })).rejects.toThrow();
    await expect(prisma.consumoMaterial.update({ where: { id: malo.id }, data: { pies: "D" } })).rejects.toThrow();
    const det = await (await detalle(pet("GET", token), conId(casos.antiguo))).json();
    expect(det.materiales).toHaveLength(3);
    expect(det.materiales[2].anulado).toMatchObject({ quien: "Toni Taller", motivo: "No era esa plancha" });
    // Ahora sí: el material del par se apunta solo con lo registrado (sin el anulado).
    const r = await confeccion(pet("POST", token, {}), conId(casos.antiguo));
    expect(r.status).toBe(200);
    const k = await prisma.case.findUniqueOrThrow({ where: { id: casos.antiguo }, include: { events: true } });
    expect(k.state).toBe("CALIDAD");
    expect(k.material).toBe("EVA 3 mm lote EVA-7781, Forro piel sintética lote f-22");
    expect(k.events.map((e) => e.text).join(" ")).toMatch(/Material registrado: EVA 3 mm · lote EVA-7781 \(par\)/);
  });
});

describe("materiales y ajustes", () => {
  it("el taller edita la lista sin tocar los precios", async () => {
    const { materiales } = await (await verMateriales(pet("GET", token))).json();
    const cambiados = materiales.map((m: { id: string; nombre: string }) =>
      m.id === "mat_eva_3_45" ? { ...m, nombre: "EVA 3 mm negra", precioCents: 1 } : m
    );
    cambiados.push({ nombre: "Corcho 2 mm", tipo: "REFUERZO", grosorMm: 2 });
    const r = await guardarMateriales(pet("PUT", token, { materiales: cambiados }));
    expect(r.status).toBe(200);
    expect(JSON.stringify(await r.json())).not.toMatch(/precioCents/);
    const eva = await prisma.material.findUniqueOrThrow({ where: { id: "mat_eva_3_45" } });
    expect(eva).toMatchObject({ nombre: "EVA 3 mm negra", precioCents: 2500, paresPorPlancha: 20 });
    expect(await prisma.material.findFirst({ where: { nombre: "Corcho 2 mm" } })).toMatchObject({ precioCents: 0 });
  });
  it("el administrador: la lista se guarda entera, se cambian precios y los que faltan se desactivan", async () => {
    const { materiales } = await (await verMateriales(pet("GET", tokenAdmin))).json();
    const nuevos = materiales
      .filter((m: { id: string }) => m.id !== "mat_cola")
      .map((m: { id: string; precioCents: number }) => (m.id === "mat_eva_5_30" ? { ...m, precioCents: 4000 } : m));
    nuevos.push({ nombre: "Corcho 3 mm", tipo: "REFUERZO", grosorMm: 3, precioCents: 1200, paresPorPlancha: 10 });
    const r = await guardarMateriales(pet("PUT", tokenAdmin, { materiales: nuevos }));
    expect(r.status).toBe(200);
    const todos = await prisma.material.findMany();
    expect(todos.find((m) => m.id === "mat_eva_5_30")?.precioCents).toBe(4000);
    expect(todos.find((m) => m.id === "mat_cola")?.activo).toBe(false);
    expect(todos.find((m) => m.nombre === "Corcho 3 mm")).toBeTruthy();
    const malo = await guardarMateriales(pet("PUT", tokenAdmin, { materiales: [{ nombre: "", precioCents: 1 }] }));
    expect(malo.status).toBe(400);
  });
  it("ajustes (administrador)", async () => {
    const { ajustes } = await (await verAjustes(pet("GET", tokenAdmin))).json();
    expect(ajustes).toMatchObject({ precioHoraCents: 2400, costeMoldeCents: 500 });
    expect((await guardarAjustes(pet("PUT", tokenAdmin, { precioHoraCents: -1 }))).status).toBe(400);
  });
  it("al cambiar la contraseña el token deja de valer", async () => {
    await prisma.user.update({ where: { id: tallerId }, data: { passwordHash: await hashPassword("otra-clave") } });
    expect((await listar(pet("GET", token))).status).toBe(401);
  });
});

describe("personal del taller", () => {
  it("el administrador da de alta, la persona recibe la invitación y al darla de baja deja de entrar", async () => {
    const { invitarPersonalTaller, reenviarInvitacionTaller, activarPersonalTaller } = await import("@/lib/personal-taller");
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN", email: "admin@ortosend.test" } });
    const { user, enlace } = await invitarPersonalTaller(admin, { nombre: "Rosa Taller", email: "Rosa@Ortosend.test", telefono: "612 345 678" });
    expect(user).toMatchObject({ role: "TALLER", email: "rosa@ortosend.test", active: true });
    expect(enlace).toMatch(/^\/activar\?token=/);
    const aviso = await prisma.notification.findFirst({ where: { template: "invitacion_profesional" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(aviso?.payload)).toMatch(/taller de Ortosend/);
    await expect(invitarPersonalTaller(admin, { nombre: "Otra", email: "rosa@ortosend.test", telefono: "612345679" })).rejects.toThrow(/Ya existe/);
    await expect(invitarPersonalTaller(admin, { nombre: "", email: "x@y.es", telefono: "612345670" })).rejects.toThrow(/nombre/);
    expect(await reenviarInvitacionTaller(admin, user.id)).toMatch(/^\/activar/);
    // Crea su contraseña (como en /activar) y entra con su móvil o email.
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword("clave-rosa"), activatedAt: new Date() } });
    const r = await entrar(pet("POST", undefined, { email: "612345678", password: "clave-rosa" }));
    expect(r.status).toBe(200);
    const suToken = (await r.json()).token;
    expect((await listar(pet("GET", suToken))).status).toBe(200);
    await activarPersonalTaller(admin, user.id, false);
    expect((await listar(pet("GET", suToken))).status).toBe(401);
    expect((await entrar(pet("POST", undefined, { email: "rosa@ortosend.test", password: "clave-rosa" }))).status).toBe(401);
    await activarPersonalTaller(admin, user.id, true);
    expect((await listar(pet("GET", suToken))).status).toBe(200);
  });
});
