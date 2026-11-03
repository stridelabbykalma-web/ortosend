// Máquinas CNC del taller y la placa que tiene puesta cada una (para Ortosend Taller, el programa del
// taller): qué zonas de la placa ya se han fresado, para que cualquier ordenador coloque la siguiente
// tirada en lo que queda libre. Las placas y tiradas llevan el id que genera el programa: repetir una
// operación no duplica nada (el programa reenvía lo que hizo sin conexión cuando vuelve a tenerla).
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { ErrorTaller } from "./taller-ops";

const ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_ZONAS = 200;

type Quien = Pick<User, "id" | "name">;
export type Zona = { x: number; y: number; ancho: number; largo: number };

function idValido(v: unknown, que: string): string {
  if (typeof v !== "string" || !ID.test(v)) throw new ErrorTaller(`Falta el identificador de la ${que}`, 400);
  return v;
}

function medida(v: unknown, que: string, max = 5000): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > max) throw new ErrorTaller(`Medida no válida: ${que}`, 400);
  return Math.round(n * 100) / 100;
}

const incluirPlaca = {
  placas: {
    orderBy: { puestaAt: "desc" as const },
    take: 1,
    include: { tiradas: { where: { anuladaAt: null }, orderBy: { createdAt: "asc" as const } } },
  },
};

type MaquinaConPlaca = Awaited<ReturnType<typeof leerMaquina>>;

async function leerMaquina(id: string) {
  return prisma.maquinaCnc.findUnique({ where: { id }, include: incluirPlaca });
}

function maquinaJson(m: NonNullable<MaquinaConPlaca>) {
  const p = m.placas[0];
  return {
    id: m.id,
    nombre: m.nombre,
    placa: p
      ? {
          id: p.id,
          ancho: p.anchoMm,
          largo: p.largoMm,
          alto: p.altoMm,
          puesta: p.puestaAt.toISOString(),
          puestaPor: p.puestaPor,
          tiradas: p.tiradas.map((t) => ({
            id: t.id,
            nombre: t.nombre,
            zonas: t.zonas as Zona[],
            quien: t.creadaPor,
            fecha: t.createdAt.toISOString(),
          })),
        }
      : null,
  };
}

export async function listaMaquinas() {
  const ms = await prisma.maquinaCnc.findMany({ orderBy: { createdAt: "asc" }, include: incluirPlaca });
  return ms.map(maquinaJson);
}

async function maquina(id: string) {
  const m = await leerMaquina(id);
  if (!m) throw new ErrorTaller("Máquina no encontrada", 404);
  return maquinaJson(m);
}

export async function crearMaquina(nombre: unknown, user: Quien) {
  const n = typeof nombre === "string" ? nombre.trim().replace(/\s+/g, " ").slice(0, 60) : "";
  if (!n) throw new ErrorTaller("Ponle un nombre a la máquina", 400);
  if (await prisma.maquinaCnc.findUnique({ where: { nombre: n } }))
    throw new ErrorTaller("Ya hay una máquina con ese nombre", 409);
  const m = await prisma.maquinaCnc.create({ data: { nombre: n, creadaPor: user.name } });
  return maquina(m.id);
}

// «Placa nueva»: desde ahora la máquina tiene esta placa sin fresar.
export async function ponerPlaca(maquinaId: string, d: Record<string, unknown>, user: Quien) {
  const id = idValido(d.id, "placa");
  const m = await prisma.maquinaCnc.findUnique({ where: { id: maquinaId } });
  if (!m) throw new ErrorTaller("Máquina no encontrada", 404);
  const ya = await prisma.placaCnc.findUnique({ where: { id } });
  if (ya && ya.maquinaId !== maquinaId) throw new ErrorTaller("Esa placa es de otra máquina", 409);
  if (!ya)
    await prisma.placaCnc.create({
      data: {
        id,
        maquinaId,
        anchoMm: medida(d.ancho, "ancho"),
        largoMm: medida(d.largo, "largo"),
        altoMm: medida(d.alto, "alto", 500),
        puestaPor: user.name,
      },
    });
  return maquina(maquinaId);
}

// «▶ Inicio»: las zonas de la tirada quedan gastadas en la placa.
export async function registrarTirada(maquinaId: string, d: Record<string, unknown>, user: Quien) {
  const id = idValido(d.id, "tirada");
  const placaId = idValido(d.placaId, "placa");
  const placa = await prisma.placaCnc.findUnique({ where: { id: placaId } });
  if (!placa || placa.maquinaId !== maquinaId) throw new ErrorTaller("Esa placa no es de esta máquina", 409);
  if (!Array.isArray(d.zonas) || d.zonas.length === 0 || d.zonas.length > MAX_ZONAS)
    throw new ErrorTaller("La tirada no trae zonas", 400);
  const zonas: Zona[] = d.zonas.map((z) => {
    const o = (z ?? {}) as Record<string, unknown>;
    const x = Number(o.x);
    const y = Number(o.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -1 || y < -1 || x > placa.anchoMm || y > placa.largoMm)
      throw new ErrorTaller("Zona fuera de la placa", 400);
    return { x, y, ancho: medida(o.ancho, "zona"), largo: medida(o.largo, "zona") };
  });
  const nombre = (typeof d.nombre === "string" ? d.nombre.trim() : "").slice(0, 80) || "tirada";
  const ya = await prisma.tiradaPlaca.findUnique({ where: { id } });
  if (ya && ya.placaId !== placaId) throw new ErrorTaller("Esa tirada es de otra placa", 409);
  if (!ya) await prisma.tiradaPlaca.create({ data: { id, placaId, nombre, zonas, creadaPor: user.name } });
  return maquina(maquinaId);
}

// «Deshacer la última tirada»: si no se llegó a fresar, su zona vuelve a estar libre (queda anotada).
export async function anularTirada(maquinaId: string, tiradaId: string, user: Quien) {
  const t = await prisma.tiradaPlaca.findUnique({ where: { id: tiradaId }, include: { placa: true } });
  if (!t || t.placa.maquinaId !== maquinaId) throw new ErrorTaller("Tirada no encontrada", 404);
  if (!t.anuladaAt)
    await prisma.tiradaPlaca.update({ where: { id: t.id }, data: { anuladaAt: new Date(), anuladaPor: user.name } });
  return maquina(maquinaId);
}
