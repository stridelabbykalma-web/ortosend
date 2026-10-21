// Confección terminada → control de calidad (pide el material/lote para trazabilidad).
import { cuerpo, responder, usuarioApp } from "@/lib/api-taller";
import { marcarConfeccion } from "@/lib/taller-ops";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    const u = await usuarioApp(req);
    const e = (await cuerpo(req)) as { material?: unknown };
    const kase = await marcarConfeccion((await params).id, u, typeof e.material === "string" ? e.material : "");
    return { ok: true, numero: kase.number, estado: "CALIDAD" };
  });
}
