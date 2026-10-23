// Operaciones del taller sobre un caso, compartidas por el panel web (server actions)
// y por la API dOrtosend Taller (programa del taller): mismas guardas, mismo registro
// de auditoría y mismos eventos en el historial del caso.
import type { Prisma, User } from "@prisma/client";
import { prisma } from "./db";
import { auditar, exigirTratamientoPermitido } from "./alta";
import { pushEvent } from "./cases";
import { TALLER_STATES, costeConfeccion, type CapaHoja, type PiesCapa } from "./taller";
import { contenidoCoincide, sinMetadatos } from "./archivos";

// Error con el código HTTP que corresponde (la API lo devuelve tal cual; el panel lo
// muestra como mensaje).
export class ErrorTaller extends Error {
  constructor(
    message: string,
    public status = 409
  ) {
    super(message);
  }
}

// Caso activo en el taller, comprobando que el paciente permite tratar sus datos.
// Deja constancia de la edición en el registro de auditoría (RGPD).
export async function casoParaEditar(caseId: string, user: Pick<User, "id">) {
  const kase = await prisma.case.findUnique({ where: { id: caseId } });
  if (!kase || !TALLER_STATES.includes(kase.state)) throw new ErrorTaller("Caso no activo en taller", 404);
  try {
    await exigirTratamientoPermitido(kase.patientId);
  } catch (e) {
    throw new ErrorTaller((e as Error).message, 409);
  }
  await auditar(user.id, "case.edit", kase.patientId, { caseId, rol: "taller" });
  return kase;
}

// Molde mecanizado → confección a mano (registra el lote de CNC).
export async function marcarMecanizado(caseId: string, user: Pick<User, "id" | "name">, lot: string) {
  const kase = await casoParaEditar(caseId, user);
  if (kase.state !== "FABRICACION" || kase.fabPhase !== "MECANIZADO")
    throw new ErrorTaller("El caso no está en mecanizado");
  const lote = lot.trim();
  await prisma.case.update({ where: { id: kase.id }, data: { fabPhase: "CONFECCION", lot: lote || kase.lot } });
  await pushEvent(kase.id, `Molde mecanizado (${lote || kase.lot || "—"}) — pasa a confección a mano`, user.name);
  return kase;
}

// Confección terminada (trazabilidad del material) → control de calidad.
export async function marcarConfeccion(caseId: string, user: Pick<User, "id" | "name">, material = "") {
  const kase = await casoParaEditar(caseId, user);
  if (kase.state !== "FABRICACION" || kase.fabPhase !== "CONFECCION")
    throw new ErrorTaller("El caso no está en confección");
  // Trazabilidad: sin los materiales registrados (foto del código de barras de cada plancha) no se termina.
  const consumos = await prisma.consumoMaterial.findMany({
    where: { caseId, anuladoAt: null },
    include: { lote: true, material: true },
    orderBy: { createdAt: "asc" },
  });
  if (consumos.length === 0)
    throw new ErrorTaller("Registra antes los materiales usados (foto del código de barras de cada plancha)", 409);
  const mat =
    material.trim() ||
    [...new Set(consumos.map((c) => `${c.material?.nombre ?? "Material"} lote ${c.lote.lote}`))].join(", ");
  await prisma.case.update({
    where: { id: kase.id },
    data: { state: "CALIDAD", material: mat, openBy: null, openAt: null },
  });
  await pushEvent(kase.id, `Confección terminada (material ${mat}) — a control de calidad`, user.name);
  return kase;
}

// ---------------------------------------------------------------- materiales y ajustes

export async function ajustesTaller() {
  return (
    (await prisma.ajustesTaller.findUnique({ where: { id: "taller" } })) ??
    (await prisma.ajustesTaller.create({ data: { id: "taller" } }))
  );
}

export async function materialesTaller(todos = false) {
  return prisma.material.findMany({
    where: todos ? {} : { activo: true },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
  });
}

// ---------------------------------------------------------------- hoja de confección

export type DatosHoja = {
  proceso: "TERMOFORMADO" | "CAPAS";
  capas: CapaHoja[];
  notas: string;
  minutosCnc: number;
  minutosConfeccion: number;
};

const PIES: PiesCapa[] = ["par", "I", "D"];

// Comprueba lo que llega de fuera (formulario o programa) y lo deja limpio.
export function limpiarHoja(entrada: unknown): DatosHoja {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const proceso = e.proceso === "CAPAS" ? "CAPAS" : e.proceso === "TERMOFORMADO" ? "TERMOFORMADO" : null;
  if (!proceso) throw new ErrorTaller("Indica el proceso: TERMOFORMADO o CAPAS", 400);
  if (!Array.isArray(e.capas)) throw new ErrorTaller("Las capas deben ser una lista", 400);
  if (e.capas.length > 20) throw new ErrorTaller("Demasiadas capas", 400);
  const capas = e.capas.map((c) => {
    const capa = (c ?? {}) as Record<string, unknown>;
    if (typeof capa.materialId !== "string" || !capa.materialId) throw new ErrorTaller("Cada capa necesita un material", 400);
    const pies = PIES.includes(capa.pies as PiesCapa) ? (capa.pies as PiesCapa) : "par";
    const notas = typeof capa.notas === "string" ? capa.notas.slice(0, 200) : "";
    return { materialId: capa.materialId, pies, ...(notas ? { notas } : {}) };
  });
  const minutos = (v: unknown, nombre: string) => {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 24 * 60) throw new ErrorTaller(`Minutos de ${nombre} no válidos`, 400);
    return Math.round(n);
  };
  return {
    proceso,
    capas,
    notas: typeof e.notas === "string" ? e.notas.slice(0, 2000) : "",
    minutosCnc: minutos(e.minutosCnc, "CNC"),
    minutosConfeccion: minutos(e.minutosConfeccion, "confección"),
  };
}

// Guarda la hoja del par y su coste (calculado con los precios de ahora: así queda
// fijo aunque los precios cambien después).
export async function guardarHoja(caseId: string, user: Pick<User, "id" | "name">, entrada: unknown) {
  const datos = limpiarHoja(entrada);
  await casoParaEditar(caseId, user);
  const [materiales, ajustes] = await Promise.all([materialesTaller(true), ajustesTaller()]);
  const ids = new Set(materiales.map((m) => m.id));
  const desconocido = datos.capas.find((c) => !ids.has(c.materialId));
  if (desconocido) throw new ErrorTaller("Hay una capa con un material que no existe", 400);
  const c = costeConfeccion(datos, materiales, ajustes);
  // Cada capa guarda también el nombre del material y su coste de ese momento (historial).
  const nombres = new Map(materiales.map((m) => [m.id, m.nombre]));
  const capas = datos.capas.map((capa, i) => ({ ...capa, nombre: nombres.get(capa.materialId), cents: c.capas[i].cents }));
  const data = {
    proceso: datos.proceso,
    capas: capas as unknown as Prisma.InputJsonValue,
    notas: datos.notas || null,
    minutosCnc: datos.minutosCnc,
    minutosConfeccion: datos.minutosConfeccion,
    costeMaterialCents: c.materialCents,
    costeFresadoCents: c.fresadoCents,
    costeManoObraCents: c.manoObraCents,
    costeTotalCents: c.totalCents,
    actualizadoPor: user.name,
  };
  const hoja = await prisma.hojaConfeccion.upsert({ where: { caseId }, create: { caseId, ...data }, update: data });
  await pushEvent(caseId, `Hoja de confección guardada (${datos.proceso === "CAPAS" ? "capas" : "termoformado"})`, user.name);
  return hoja;
}

// ---------------------------------------------------------------- edición del catálogo

export type DatosMaterial = {
  id?: string;
  nombre: string;
  tipo: "BASE" | "REFUERZO" | "FORRO" | "ADHESIVO" | "OTRO";
  grosorMm: number | null;
  dureza: string | null;
  planchaAnchoMm: number | null;
  planchaLargoMm: number | null;
  precioCents: number;
  paresPorPlancha: number;
  activo: boolean;
  orden: number;
};

const TIPOS = ["BASE", "REFUERZO", "FORRO", "ADHESIVO", "OTRO"] as const;

export function limpiarMaterial(entrada: unknown): DatosMaterial {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const nombre = typeof e.nombre === "string" ? e.nombre.trim().slice(0, 120) : "";
  if (!nombre) throw new ErrorTaller("Cada material necesita un nombre", 400);
  const num = (v: unknown, min: number, max: number) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new ErrorTaller(`Valor no válido en «${nombre}»`, 400);
    return n;
  };
  const precio = num(e.precioCents, 0, 10_000_000) ?? 0;
  const pares = num(e.paresPorPlancha, 0.01, 10_000) ?? 1;
  return {
    ...(typeof e.id === "string" && e.id ? { id: e.id } : {}),
    nombre,
    tipo: TIPOS.includes(e.tipo as (typeof TIPOS)[number]) ? (e.tipo as DatosMaterial["tipo"]) : "OTRO",
    grosorMm: num(e.grosorMm, 0, 100),
    dureza: typeof e.dureza === "string" && e.dureza.trim() ? e.dureza.trim().slice(0, 60) : null,
    planchaAnchoMm: num(e.planchaAnchoMm, 0, 10_000) === null ? null : Math.round(Number(e.planchaAnchoMm)),
    planchaLargoMm: num(e.planchaLargoMm, 0, 10_000) === null ? null : Math.round(Number(e.planchaLargoMm)),
    precioCents: Math.round(precio),
    paresPorPlancha: pares,
    activo: e.activo !== false,
    orden: Math.round(num(e.orden, -100_000, 100_000) ?? 0),
  };
}

// Guarda el catálogo entero tal como llega del programa. Los materiales que ya no
// vienen se desactivan (no se borran: hojas antiguas pueden usarlos).
// Sin `conPrecios` (el taller) no se tocan precio ni rendimiento: los nuevos quedan a 0 hasta que el
// administrador los ponga.
export async function guardarMateriales(entrada: unknown, { conPrecios = true } = {}) {
  if (!Array.isArray(entrada)) throw new ErrorTaller("Se esperaba una lista de materiales", 400);
  const lista = entrada.map(limpiarMaterial);
  const vistos = new Set<string>();
  await prisma.$transaction(async (tx) => {
    for (const m of lista) {
      const { id, precioCents, paresPorPlancha, ...resto } = m;
      const datos = conPrecios ? { ...resto, precioCents, paresPorPlancha } : resto;
      if (id && (await tx.material.findUnique({ where: { id } }))) {
        await tx.material.update({ where: { id }, data: datos });
        vistos.add(id);
      } else {
        const nuevo = await tx.material.create({ data: datos });
        vistos.add(nuevo.id);
      }
    }
    await tx.material.updateMany({ where: { id: { notIn: [...vistos] } }, data: { activo: false } });
  });
  return materialesTaller(true);
}

export async function guardarAjustes(entrada: unknown) {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const ent = (v: unknown, nombre: string, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new ErrorTaller(`Valor no válido: ${nombre}`, 400);
    return Math.round(n);
  };
  const data = {
    precioHoraCents: ent(e.precioHoraCents, "precio por hora", 1_000_000),
    costeCncMinutoCents: ent(e.costeCncMinutoCents, "coste de la CNC por minuto", 100_000),
    costeMoldeCents: ent(e.costeMoldeCents, "escayola de los moldes", 1_000_000),
    minutosCnc: ent(e.minutosCnc, "minutos de CNC", 24 * 60),
    minutosConfeccion: ent(e.minutosConfeccion, "minutos de confección", 24 * 60),
  };
  return prisma.ajustesTaller.upsert({ where: { id: "taller" }, create: { id: "taller", ...data }, update: data });
}

// ---------------------------------------------------------------- trazabilidad de materiales

export const ETIQUETA_KIND = "etiqueta_material";
const FOTO_MAX = 4 * 1024 * 1024;
const FOTO_MIME = ["image/jpeg", "image/png", "image/webp"];

export type DatosConsumo = {
  codigo: string; // texto leído del código de barras ("" si no se pudo leer)
  lote: string;
  caducidad?: string | null; // AAAA-MM-DD
  gtin?: string | null;
  materialId: string;
  pies?: string;
  foto?: { bytes: Uint8Array; mime: string } | null;
};

// Lote ya conocido por su código de barras (para rellenar el formulario al escanear).
export async function buscarLote(codigo: string) {
  const c = codigo.trim();
  if (!c) return null;
  return prisma.loteMaterial.findUnique({ where: { codigo: c }, include: { material: true } });
}

// Registra el material usado en una plantilla: el lote (se da de alta la primera vez), la foto de la
// etiqueta, para qué pie, quién y cuándo. Queda también en el historial del caso.
export async function registrarConsumo(caseId: string, user: Pick<User, "id" | "name">, d: DatosConsumo) {
  const kase = await casoParaEditar(caseId, user);
  const lote = (d.lote ?? "").trim().slice(0, 80);
  if (!lote) throw new ErrorTaller("Falta el nº de lote", 400);
  const material = await prisma.material.findUnique({ where: { id: d.materialId ?? "" } });
  if (!material) throw new ErrorTaller("Elige el material", 400);
  const pies = ["par", "I", "D"].includes(d.pies ?? "") ? (d.pies as string) : "par";
  if (d.foto) {
    if (!FOTO_MIME.includes(d.foto.mime)) throw new ErrorTaller("La foto debe ser JPEG, PNG o WebP", 400);
    if (d.foto.bytes.length === 0 || d.foto.bytes.length > FOTO_MAX) throw new ErrorTaller("La foto debe ocupar menos de 4 MB", 413);
    if (!contenidoCoincide(d.foto.bytes, d.foto.mime)) throw new ErrorTaller("La foto no es una imagen válida", 400);
  }
  const caducidad = d.caducidad && /^\d{4}-\d{2}-\d{2}$/.test(d.caducidad) ? new Date(`${d.caducidad}T00:00:00Z`) : null;
  // Sin código legible: el lote se identifica por material + nº de lote escrito a mano.
  const codigo = (d.codigo ?? "").trim().slice(0, 300) || `manual:${material.id}:${lote.toUpperCase()}`;
  const consumo = await prisma.$transaction(async (tx) => {
    const existente = await tx.loteMaterial.findUnique({ where: { codigo } });
    const loteMat =
      existente ??
      (await tx.loteMaterial.create({
        data: { codigo, lote, gtin: d.gtin?.trim() || null, caducidad, materialId: material.id, creadoPor: user.name },
      }));
    if (existente && !existente.materialId)
      await tx.loteMaterial.update({ where: { id: existente.id }, data: { materialId: material.id } });
    let fotoId: string | null = null;
    if (d.foto) {
      const capture = (await tx.capture.findUnique({ where: { caseId } })) ?? (await tx.capture.create({ data: { caseId } }));
      const a = await tx.mediaAsset.create({ data: { captureId: capture.id, kind: ETIQUETA_KIND, url: "" } });
      const foto = sinMetadatos(d.foto.bytes, d.foto.mime); // sin GPS ni datos del móvil
      await tx.mediaBlob.create({ data: { mediaId: a.id, mime: d.foto.mime, bytes: Buffer.from(foto) } });
      await tx.mediaAsset.update({
        where: { id: a.id },
        data: { url: `/api/media/${a.id}`, sizeBytes: foto.length, meta: { mime: d.foto.mime }, confirmedAt: new Date() },
      });
      fotoId = a.id;
    }
    return tx.consumoMaterial.create({
      data: { caseId, loteId: loteMat.id, materialId: material.id, pies, fotoId, userId: user.id, userName: user.name },
      include: { lote: true, material: true },
    });
  });
  const pie = pies === "par" ? "par" : pies === "I" ? "pie izquierdo" : "pie derecho";
  await pushEvent(kase.id, `Material registrado: ${material.nombre} · lote ${consumo.lote.lote} (${pie})`, user.name);
  return consumo;
}

// Un registro equivocado no se borra: se anula con el motivo (queda constancia).
export async function anularConsumo(consumoId: string, user: Pick<User, "id" | "name">, motivo: string) {
  const c = await prisma.consumoMaterial.findUnique({ where: { id: consumoId }, include: { lote: true, material: true } });
  if (!c) throw new ErrorTaller("Registro no encontrado", 404);
  if (c.anuladoAt) throw new ErrorTaller("Ese registro ya estaba anulado");
  const m = motivo.trim().slice(0, 300);
  if (!m) throw new ErrorTaller("Indica por qué se anula", 400);
  await casoParaEditar(c.caseId, user);
  await prisma.consumoMaterial.update({
    where: { id: c.id },
    data: { anuladoAt: new Date(), anuladoPor: user.name, motivoAnulacion: m },
  });
  await pushEvent(c.caseId, `Registro de material anulado: ${c.material?.nombre ?? ""} · lote ${c.lote.lote} — ${m}`, user.name);
}

export async function consumosDe(caseId: string) {
  return prisma.consumoMaterial.findMany({
    where: { caseId },
    include: { lote: true, material: true },
    orderBy: { createdAt: "asc" },
  });
}
