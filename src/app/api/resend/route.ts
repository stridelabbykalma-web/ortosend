// Webhook de Resend: marca los emails rebotados o denunciados como spam para
// que la ficha del paciente avise de que esa dirección no recibe.
// Se configura en resend.com → Webhooks apuntando a /api/resend con los eventos
// email.bounced y email.complained, y su «signing secret» (whsec_…) en la
// variable RESEND_WEBHOOK_SECRET. Firma verificada a mano (formato svix).
import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function firmaValida(secret: string, id: string, timestamp: string, payload: string, signatures: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const esperada = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  // La cabecera puede traer varias firmas: "v1,xxx v1,yyy"
  return signatures.split(" ").some((s) => {
    const [, sig] = s.split(",");
    try {
      return !!sig && timingSafeEqual(Buffer.from(esperada), Buffer.from(sig));
    } catch {
      return false;
    }
  });
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET sin configurar" }, { status: 503 });
  const payload = await request.text();
  const id = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signatures = request.headers.get("svix-signature") ?? "";
  // Tolerancia de 5 min contra repeticiones.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
    return NextResponse.json({ error: "timestamp fuera de ventana" }, { status: 401 });
  if (!firmaValida(secret, id, timestamp, payload, signatures))
    return NextResponse.json({ error: "firma no válida" }, { status: 401 });

  let evento: { type?: string; data?: { to?: string[] } };
  try {
    evento = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "payload no válido" }, { status: 400 });
  }
  if (evento.type !== "email.bounced" && evento.type !== "email.complained") return NextResponse.json({ ok: true });
  const to = (evento.data?.to ?? []).map((e) => e.toLowerCase());
  if (!to.length) return NextResponse.json({ ok: true });
  // Se marca el último aviso enviado a esa dirección (no guardamos el id del proveedor).
  const n = await prisma.notification.findFirst({
    where: { channel: "email", toEmail: { in: to }, sentAt: { not: null }, bouncedAt: null },
    orderBy: { sentAt: "desc" },
  });
  if (n) await prisma.notification.update({ where: { id: n.id }, data: { bouncedAt: new Date() } });
  return NextResponse.json({ ok: true, marcado: !!n });
}
