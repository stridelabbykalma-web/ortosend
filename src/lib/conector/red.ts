// Descarga de enlaces que escribe la clínica (calendarios iCal). Como el
// servidor de Ortosend hace la petición, se limita a https hacia direcciones
// públicas (nada de localhost, redes privadas ni metadatos de la nube), se
// siguen como mucho 3 redirecciones comprobando cada una y se corta por
// tiempo y por tamaño.
import { lookup } from "dns/promises";
import { isIP } from "net";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECCIONES = 3;

export class EnlaceNoValido extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnlaceNoValido";
  }
}

function ipPrivada(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return m ? ipPrivada(m[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

// webcal:// → https://; solo https y nombre de dominio público.
export function normalizarEnlace(raw: string): URL {
  const t = raw.trim().replace(/^webcals?:\/\//i, "https://");
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new EnlaceNoValido("El enlace no es una dirección web válida");
  }
  if (u.protocol !== "https:") throw new EnlaceNoValido("El enlace debe empezar por https:// (o webcal://)");
  if (u.username || u.password) throw new EnlaceNoValido("El enlace no puede llevar usuario ni contraseña");
  const host = u.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, "")) || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes("."))
    throw new EnlaceNoValido("El enlace debe ser de un servicio público (Google, Outlook, iCloud, el programa de la clínica…)");
  return u;
}

async function comprobarDestino(u: URL) {
  const dirs = await lookup(u.hostname, { all: true }).catch(() => {
    throw new EnlaceNoValido(`No se encuentra el servidor ${u.hostname}`);
  });
  if (!dirs.length || dirs.some((d) => ipPrivada(d.address)))
    throw new EnlaceNoValido("El enlace apunta a una red privada y no se puede usar");
}

let descargador: ((url: string) => Promise<string>) | null = null;
// Tests: sustituye la descarga real.
export function usarDescargador(f: ((url: string) => Promise<string>) | null) {
  descargador = f;
}

export async function descargarTexto(raw: string): Promise<string> {
  let u = normalizarEnlace(raw);
  if (descargador) return descargador(u.toString());
  for (let i = 0; i <= MAX_REDIRECCIONES; i++) {
    await comprobarDestino(u);
    const res = await fetch(u, {
      redirect: "manual",
      headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5", "User-Agent": "Ortosend-agenda/1.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    }).catch((e) => {
      throw new EnlaceNoValido(`No se pudo descargar el calendario (${e instanceof Error ? e.message : "red"})`);
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      u = normalizarEnlace(new URL(res.headers.get("location")!, u).toString());
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404)
      throw new EnlaceNoValido(`El calendario no es accesible (${res.status}): el enlace privado puede haber cambiado`);
    if (!res.ok) throw new EnlaceNoValido(`El servidor del calendario respondió ${res.status}`);
    const largo = Number(res.headers.get("content-length") ?? 0);
    if (largo > MAX_BYTES) throw new EnlaceNoValido("El calendario es demasiado grande");
    const texto = await res.text();
    if (texto.length > MAX_BYTES) throw new EnlaceNoValido("El calendario es demasiado grande");
    return texto;
  }
  throw new EnlaceNoValido("Demasiadas redirecciones");
}
