// Autenticación de las llamadas que hace ManyChat a Ortosend («External
// Request» del flujo): cabecera X-Ortosend-Secret = MANYCHAT_WEBHOOK_SECRET.
import { createHash, timingSafeEqual } from "crypto";

export function webhookAutorizado(req: Request) {
  const esperado = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (!esperado) return false; // sin secreto configurado no se acepta nada
  const recibido = req.headers.get("x-ortosend-secret") ?? "";
  const a = createHash("sha256").update(esperado).digest();
  const b = createHash("sha256").update(recibido).digest();
  return timingSafeEqual(a, b);
}

export async function leerJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const j = await req.json();
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const texto = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
