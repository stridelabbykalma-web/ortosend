// El paciente escribe BAJA o pulsa «Mis consentimientos» en WhatsApp: ManyChat
// pide aquí un enlace temporal (24 h) a la página de gestión, sin cuenta.
// Cuerpo: { subscriber_id }. Respuesta: { url } o { url: "" } si no hay paciente.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { leerJson, texto, webhookAutorizado } from "@/lib/manychat-webhook";
import { EMPRESA } from "@/lib/legal";
import { GESTION_HORAS, hashSecreto, horasDesdeAhora, nuevoSecreto } from "@/lib/consent/tokens";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!webhookAutorizado(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await leerJson(req);
  const subscriberId = texto(b.subscriber_id);
  if (!subscriberId) return NextResponse.json({ url: "" });
  const inv = await prisma.consentInvitation.findFirst({
    where: { manychatSubscriberId: subscriberId },
    orderBy: { createdAt: "desc" },
  });
  if (!inv) return NextResponse.json({ url: "" });
  const token = nuevoSecreto();
  await prisma.consentManageToken.create({
    data: { phone: inv.toPhone, tokenHash: hashSecreto(token), expiresAt: horasDesdeAhora(GESTION_HORAS) },
  });
  return NextResponse.json({ url: `${EMPRESA.web}/consentimientos/${token}` });
}
