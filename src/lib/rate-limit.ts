// Límite de peticiones por ventana fija, guardado en Postgres (en Vercel cada
// petición puede caer en una instancia distinta: un contador en memoria no sirve).
import { createHash } from "crypto";
import { headers } from "next/headers";
import { prisma } from "./db";

export async function limitar(clave: string, max: number, ventanaSeg: number): Promise<boolean> {
  const ms = ventanaSeg * 1000;
  const windowStart = new Date(Math.floor(Date.now() / ms) * ms);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limit_hits" ("key", "windowStart", "count") VALUES (${clave}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "rate_limit_hits"."count" + 1
    RETURNING "count"`;
  return Number(rows[0]?.count ?? 0) <= max;
}

export async function limpiarRateLimit() {
  await prisma.rateLimitHit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } });
}

// IP del cliente (Vercel la pone primera en x-forwarded-for) y user-agent.
export async function origenPeticion() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
}

// La IP no se usa en claro como clave del contador.
export const claveIp = (prefijo: string, ip: string | null) =>
  `${prefijo}:${createHash("sha256").update(ip ?? "sin-ip").digest("hex").slice(0, 32)}`;

// Páginas públicas con secreto en la URL: 20 peticiones por minuto y IP.
export const PUBLICO_MAX = 20;
export const PUBLICO_VENTANA = 60;

export async function permitirPublico(prefijo: string) {
  const { ip } = await origenPeticion();
  return limitar(claveIp(prefijo, ip), PUBLICO_MAX, PUBLICO_VENTANA);
}
