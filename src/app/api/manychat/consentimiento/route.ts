// Webhook que llama el flujo de ManyChat en cada paso del consentimiento:
// «Empezar», cada «Acepto / No acepto» y «Revisar». La respuesta dice qué
// mostrar a continuación (ManyChat la guarda en el campo ortosend_siguiente).
// Cuerpo: { ref, subscriber_id, accion, documento?, respuesta? }
import { NextResponse } from "next/server";
import { procesarWebhook, type AccionWebhook } from "@/lib/alta";
import { leerJson, texto, webhookAutorizado } from "@/lib/manychat-webhook";

export const dynamic = "force-dynamic";

const ACCIONES: AccionWebhook[] = ["empezar", "respuesta", "revisar"];

export async function POST(req: Request) {
  if (!webhookAutorizado(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await leerJson(req);
  const accion = texto(b.accion) as AccionWebhook;
  if (!ACCIONES.includes(accion)) return NextResponse.json({ estado: "invalido", siguiente: "invalido" });
  const respuesta = texto(b.respuesta).toLowerCase();
  const out = await procesarWebhook({
    ref: texto(b.ref),
    subscriberId: texto(b.subscriber_id) || null,
    accion,
    documento: texto(b.documento).toLowerCase() || null,
    respuesta: respuesta === "acepto" || respuesta === "rechazo" ? respuesta : null,
  });
  return NextResponse.json(out);
}
