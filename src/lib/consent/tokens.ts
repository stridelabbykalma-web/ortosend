// Secretos de un solo propósito (invitación, gestión, código de acceso). En la
// base de datos solo se guarda su hash SHA-256: una copia de la BD no permite
// usar ningún enlace.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";

export const INVITACION_HORAS = 72;
export const GESTION_HORAS = 24;
export const CODIGO_MINUTOS = 10;
export const CODIGO_INTENTOS = 5;

// 32 bytes aleatorios → 43 caracteres base64url.
export const nuevoSecreto = () => randomBytes(32).toString("base64url");

export const hashSecreto = (secreto: string) => createHash("sha256").update(secreto, "utf8").digest("hex");

// Código numérico de 6 cifras. Su hash lleva AUTH_SECRET como pimienta: con solo
// un millón de combinaciones, un hash sin ella se invertiría al instante.
export const nuevoCodigo = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export function hashCodigo(codigo: string) {
  const pimienta = process.env.AUTH_SECRET || "dev-secret";
  return createHash("sha256").update(`${pimienta}:${codigo}`, "utf8").digest("hex");
}

export function mismoHash(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export const horasDesdeAhora = (h: number) => new Date(Date.now() + h * 3600 * 1000);
