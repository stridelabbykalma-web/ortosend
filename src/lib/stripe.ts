// Pago real con Stripe Checkout, sin SDK (igual que Resend: fetch contra la
// API). Con STRIPE_SECRET_KEY configurada, payAction crea una sesión de
// Checkout y el cobro lo confirma el webhook /api/stripe (o la página de
// retorno, lo que llegue antes: la confirmación es idempotente). Sin la clave
// se mantiene el pago simulado para no romper los entornos de prueba.
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "./db";
import { pushEvent, avisarPaciente } from "./cases";
import { PRICE_CENTS } from "./format";
import { EMPRESA } from "./legal";

export function stripeConfigurado() {
  return !!process.env.STRIPE_SECRET_KEY;
}

// La API de Stripe habla application/x-www-form-urlencoded con claves anidadas
// (line_items[0][price_data][currency]…): se aplanan aquí.
function formEncode(obj: Record<string, unknown>, prefix = "", out: string[] = []): string[] {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) formEncode(v as Record<string, unknown>, key, out);
    else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? formEncode(x, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`)));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

async function stripeApi(method: "GET" | "POST", path: string, params?: Record<string, unknown>) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY sin configurar");
  const body = params ? formEncode(params).join("&") : undefined;
  const url = method === "GET" && body ? `https://api.stripe.com/v1${path}?${body}` : `https://api.stripe.com/v1${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(method === "POST" && body ? { body } : {}),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const msg = (data?.error as { message?: string } | undefined)?.message ?? `Stripe ${res.status}`;
    throw new Error(msg);
  }
  return data!;
}

export type SesionCheckout = {
  id: string;
  url?: string;
  payment_status?: string;
  metadata?: { caseId?: string; delivery?: string };
  payment_intent?: string | { id: string; latest_charge?: { payment_method_details?: { type?: string } } };
};

// Sesión de Checkout del caso: 199,99 €, métodos los que la cuenta tenga
// activos (tarjeta siempre; Bizum cuando esté activado en Stripe).
export async function crearSesionCheckout(opts: { caseId: string; numero: number; delivery: "DOMICILIO" | "CLINICA" }) {
  const session = (await stripeApi("POST", "/checkout/sessions", {
    mode: "payment",
    client_reference_id: opts.caseId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: PRICE_CENTS,
          product_data: { name: `Plantillas ortopédicas a medida — caso #${opts.numero}` },
        },
      },
    ],
    metadata: { caseId: opts.caseId, delivery: opts.delivery },
    payment_intent_data: { metadata: { caseId: opts.caseId } },
    success_url: `${EMPRESA.web}/pago/retorno?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${EMPRESA.web}/panel?error=${encodeURIComponent("Pago cancelado. Puedes volver a intentarlo cuando quieras.")}`,
    locale: "es",
  })) as SesionCheckout;
  if (!session.url) throw new Error("Stripe no devolvió la URL de pago");
  return session;
}

export async function obtenerSesionCheckout(id: string) {
  return (await stripeApi("GET", `/checkout/sessions/${encodeURIComponent(id)}`, {
    expand: ["payment_intent.latest_charge"],
  })) as SesionCheckout;
}

// Firma del webhook (cabecera Stripe-Signature: t=...,v1=...), con tolerancia
// de 5 minutos contra repeticiones.
export function verificarFirmaStripe(payload: string, sigHeader: string | null, secret: string): boolean {
  if (!sigHeader) return false;
  const partes = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=") as [string, string]));
  const t = partes.t;
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const esperada = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return sigHeader.split(",").some((p) => {
    const [k, v] = p.split("=");
    try {
      return k === "v1" && !!v && timingSafeEqual(Buffer.from(esperada), Buffer.from(v));
    } catch {
      return false;
    }
  });
}

// Confirmación idempotente del cobro: marca el pago, pasa el caso al taller y
// avisa. La llaman el webhook y la página de retorno; solo la primera cuenta.
export async function confirmarPagoCheckout(session: SesionCheckout): Promise<"ok" | "ya" | "no"> {
  const caseId = session.metadata?.caseId;
  if (!caseId || session.payment_status !== "paid") return "no";
  const kase = await prisma.case.findUnique({ where: { id: caseId }, include: { prescription: true } });
  if (!kase || !kase.prescription) return "no";
  const pi = session.payment_intent;
  const providerId = typeof pi === "string" ? pi : (pi?.id ?? session.id);
  const tipo = typeof pi === "object" ? pi?.latest_charge?.payment_method_details?.type : undefined;
  const method = tipo === "bizum" ? "bizum" : "card";
  const delivery = session.metadata?.delivery === "CLINICA" ? "CLINICA" : "DOMICILIO";
  const cobrado = await prisma.payment.updateMany({
    where: { caseId, paidAt: null },
    data: { paidAt: new Date(), method, providerId },
  });
  if (cobrado.count === 0) return "ya";
  await prisma.case.update({ where: { id: caseId }, data: { state: "ENTRADA_TALLER", delivery } });
  await pushEvent(
    caseId,
    `Pago 199,99 € recibido por Stripe (${method === "bizum" ? "Bizum" : "tarjeta"}). Entrega: ${
      delivery === "CLINICA" ? "recogida en clínica" : "domicilio"
    }`,
    "Stripe"
  );
  await avisarPaciente(kase.patientId, "pago_recibido", {
    caseId,
    nota: "Pago recibido. Empezamos a fabricar tus plantillas: las recibirás en 5 días laborables.",
  });
  return "ok";
}
