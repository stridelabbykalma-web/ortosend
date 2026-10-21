// Webhook de Stripe: confirma los cobros de Checkout (checkout.session.completed)
// con la firma verificada. La transición es la misma que la de la página de
// retorno y es idempotente: llegue antes quien llegue, solo se aplica una vez.
import { NextResponse } from "next/server";
import { confirmarPagoCheckout, obtenerSesionCheckout, verificarFirmaStripe, type SesionCheckout } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET sin configurar" }, { status: 503 });
  const payload = await request.text();
  if (!verificarFirmaStripe(payload, request.headers.get("stripe-signature"), secret))
    return NextResponse.json({ error: "firma no válida" }, { status: 401 });

  let evento: { type?: string; data?: { object?: SesionCheckout } };
  try {
    evento = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "payload no válido" }, { status: 400 });
  }
  if (evento.type !== "checkout.session.completed" || !evento.data?.object) return NextResponse.json({ ok: true });
  // Se relee la sesión de la API (con el cargo expandido para saber el método):
  // así no se confía en el cuerpo del evento más allá del id.
  let session = evento.data.object;
  try {
    session = await obtenerSesionCheckout(session.id);
  } catch {
    // Si la relectura falla se usa el evento firmado (sin método detallado).
  }
  const r = await confirmarPagoCheckout(session);
  return NextResponse.json({ ok: true, resultado: r });
}
