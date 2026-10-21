// Vuelta de Stripe Checkout: se relee la sesión de la API (nunca se confía en
// la URL) y, si está pagada, se aplica la misma confirmación idempotente que
// el webhook. Así el cliente ve su pedido «en fabricación» al volver aunque el
// webhook tarde unos segundos.
import { NextResponse } from "next/server";
import { EMPRESA } from "@/lib/legal";
import { permitirPublico } from "@/lib/rate-limit";
import { confirmarPagoCheckout, obtenerSesionCheckout, stripeConfigurado } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const panel = (q: "ok" | "error", msg: string) =>
    NextResponse.redirect(`${EMPRESA.web}/panel?${q}=${encodeURIComponent(msg)}`, 303);
  if (!(await permitirPublico("pago-retorno"))) return panel("error", "Demasiadas peticiones. Entra en tu panel para ver el estado del pago.");
  if (!stripeConfigurado()) return panel("error", "El pago online no está configurado");
  const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
  if (!sessionId) return panel("error", "Falta la referencia del pago");
  try {
    const session = await obtenerSesionCheckout(sessionId);
    const r = await confirmarPagoCheckout(session);
    if (r === "ok" || r === "ya") return panel("ok", "Pago recibido. ¡Empezamos a fabricar!");
    if (r === "no_apto")
      return panel("error", "Hemos recibido tu pago, pero tu caso necesita una revisión antes de fabricar. Te contactaremos enseguida.");
    if (session.payment_status === "unpaid")
      return panel("error", "El pago no se ha completado. Puedes volver a intentarlo desde tu panel.");
    return panel("error", "No hemos podido confirmar el pago. Si el cargo se ha hecho, escríbenos.");
  } catch {
    return panel("error", "No hemos podido comprobar el pago. Si el cargo se ha hecho, escríbenos.");
  }
}
