// Freno a los bots en los formularios públicos (reserva, solicitud de clínica, recuperar contraseña,
// código de acceso): un campo trampa que una persona no ve ni rellena y, si están configuradas sus
// claves (TURNSTILE_SECRET_KEY y NEXT_PUBLIC_TURNSTILE_SITE_KEY), la comprobación de Cloudflare Turnstile.
import { origenPeticion } from "./rate-limit";

export const CAMPO_TRAMPA = "web_alternativa";

// Devuelve el motivo para rechazar, o null si parece una persona.
export async function pareceBot(formData: FormData): Promise<string | null> {
  if (String(formData.get(CAMPO_TRAMPA) ?? "").trim()) return "No hemos podido procesar el formulario.";
  const secreto = process.env.TURNSTILE_SECRET_KEY;
  if (!secreto) return null;
  const respuesta = String(formData.get("cf-turnstile-response") ?? "");
  if (!respuesta) return "Confirma que no eres un robot.";
  const { ip } = await origenPeticion();
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: secreto, response: respuesta, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json()) as { success?: boolean };
    return j.success ? null : "La comprobación anti-robots ha fallado. Inténtalo de nuevo.";
  } catch {
    return "No hemos podido comprobar que no eres un robot. Inténtalo de nuevo.";
  }
}
