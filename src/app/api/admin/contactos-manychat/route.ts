// Importación del CSV de contactos exportado de ManyChat (panel de administración). Va por
// ruta propia y no por server action: el CSV de todo el WhatsApp de la empresa puede pasar
// del 1 MB que admiten las server actions.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/cases";
import { importarCsvContactos } from "@/lib/contacto-manychat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const volver = (req: Request, param: "ok" | "error", msg: string) =>
  NextResponse.redirect(new URL(`/panel?tab=res&${param}=${encodeURIComponent(msg)}`, req.url), 303);

export async function POST(req: Request) {
  // Formulario HTML con la cookie de sesión: solo desde la propia web.
  const origen = req.headers.get("origin");
  if (origen && new URL(origen).host !== new URL(req.url).host)
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const archivo = form?.get("csv");
  if (!(archivo instanceof File) || archivo.size === 0) return volver(req, "error", "Elige el archivo CSV exportado de ManyChat.");
  if (archivo.size > 4_000_000) return volver(req, "error", "El archivo pasa de 4 MB: expórtalo en varias partes.");
  const r = await importarCsvContactos(await archivo.text());
  if (!r.ok) return volver(req, "error", r.error);
  await audit(user.id, "manychat.importar_contactos", "manychat_contactos", null, { importados: r.importados, ignorados: r.ignorados });
  return volver(
    req,
    "ok",
    `Contactos de WhatsApp importados: ${r.importados}${r.ignorados ? ` (${r.ignorados} filas sin ID o sin teléfono ignoradas)` : ""}. Ya se les puede enviar el alta automática.`
  );
}
