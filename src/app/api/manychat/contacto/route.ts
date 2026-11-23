// Aviso del «Default Reply» de ManyChat cada vez que un contacto escribe al WhatsApp de la
// empresa: guarda su ID para poder enviarle el alta automática (la API de ManyChat no permite
// buscar contactos de WhatsApp por su número). Cuerpo: { subscriber_id, telefono }.
import { NextResponse } from "next/server";
import { guardarContacto } from "@/lib/contacto-manychat";
import { leerJson, texto, webhookAutorizado } from "@/lib/manychat-webhook";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!webhookAutorizado(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await leerJson(req);
  const guardado = await guardarContacto(texto(b.telefono), texto(b.subscriber_id), "webhook");
  // Siempre 200: un dato vacío o raro no debe hacer reintentar a ManyChat.
  return NextResponse.json({ ok: true, guardado });
}
