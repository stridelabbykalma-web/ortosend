// ManyChat no permite buscar un contacto de WhatsApp por su número (findBySystemField solo
// admite el teléfono de SMS o el email), así que Ortosend guarda el ID de los contactos que
// conoce: los de altas anteriores (en la invitación) y un directorio propio que se llena con el
// CSV exportado de ManyChat, el aviso del «Default Reply» y el webhook de alta.
import { createHmac } from "crypto";
import { prisma } from "./db";
import { aE164 } from "./manychat";

export type OrigenContacto = "csv" | "webhook" | "alta";

// Si se rota MANYCHAT_WEBHOOK_SECRET los hashes dejan de coincidir: hay que volver a importar el CSV.
export function hashTelefono(telefono: string) {
  const clave = process.env.MANYCHAT_WEBHOOK_SECRET || "ortosend-directorio-manychat";
  return createHmac("sha256", clave).update(aE164(telefono)).digest("hex");
}

const telefonoValido = (t: string) => /^\+?\d{9,15}$/.test(t.replace(/[\s().-]/g, ""));
const idValido = (s: string) => /^\d{1,30}$/.test(s);

export async function guardarContacto(telefono: string, subscriberId: string, origen: OrigenContacto) {
  const tel = telefono.trim();
  const sub = subscriberId.trim();
  if (!telefonoValido(tel) || !idValido(sub)) return false;
  const telefonoHash = hashTelefono(tel);
  await prisma.manychatContacto.upsert({
    where: { telefonoHash },
    create: { telefonoHash, subscriberId: sub, origen },
    update: { subscriberId: sub, origen },
  });
  return true;
}

export async function subscriberConocido(telefono: string): Promise<string | null> {
  const inv = await prisma.consentInvitation.findFirst({
    where: { toPhone: telefono, manychatSubscriberId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { manychatSubscriberId: true },
  });
  if (inv?.manychatSubscriberId) return inv.manychatSubscriberId;
  const dir = await prisma.manychatContacto.findUnique({ where: { telefonoHash: hashTelefono(telefono) } });
  return dir?.subscriberId ?? null;
}

// ---------------------------------------------------------------- importación del CSV de ManyChat

function separador(cabecera: string) {
  const cuenta = (c: string) => cabecera.split(c).length - 1;
  return [",", ";", "\t"].sort((a, b) => cuenta(b) - cuenta(a))[0];
}

// CSV con comillas («"a, b"» y «""» escapadas).
function filas(texto: string, sep: string): string[][] {
  const out: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      out.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (campo || fila.length) {
    fila.push(campo);
    out.push(fila);
  }
  return out.filter((f) => f.some((x) => x.trim()));
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function columnas(cabecera: string[]) {
  const h = cabecera.map(norm);
  const buscar = (...pruebas: ((x: string) => boolean)[]) => {
    for (const p of pruebas) {
      const i = h.findIndex(p);
      if (i >= 0) return i;
    }
    return -1;
  };
  const id = buscar(
    (x) => ["contact id", "subscriber id", "user id", "id"].includes(x),
    (x) => /\b(contact|subscriber|contacto)\b/.test(x) && /\bid\b/.test(x)
  );
  const tel = buscar(
    (x) => /whats ?app/.test(x) && /(phone|telefono|movil|number|numero)/.test(x),
    (x) => /whats ?app/.test(x),
    (x) => /^(phone|telefono|movil)$/.test(x)
  );
  return { id, tel };
}

export function leerCsvContactos(texto: string) {
  const limpio = texto.replace(/^﻿/, "");
  const primera = limpio.split(/\r?\n/, 1)[0] ?? "";
  const todas = filas(limpio, separador(primera));
  if (todas.length < 2) return { error: "El archivo está vacío o no tiene cabecera.", contactos: [] };
  const { id, tel } = columnas(todas[0]);
  if (id < 0 || tel < 0)
    return { error: "No encuentro las columnas del ID del contacto y del teléfono de WhatsApp en la cabecera.", contactos: [] };
  return {
    error: null,
    contactos: todas.slice(1).map((f) => ({ subscriberId: (f[id] ?? "").trim(), telefono: (f[tel] ?? "").trim() })),
  };
}

export async function importarCsvContactos(texto: string) {
  const { error, contactos } = leerCsvContactos(texto);
  if (error) return { ok: false as const, error };
  let importados = 0;
  let ignorados = 0;
  for (const c of contactos) {
    if (c.telefono && c.subscriberId && (await guardarContacto(c.telefono, c.subscriberId, "csv"))) importados++;
    else ignorados++;
  }
  return { ok: true as const, importados, ignorados };
}
