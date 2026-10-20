// Guarda la hoja de confección del par y devuelve el coste calculado.
import { cuerpo, responder, usuarioApp } from "@/lib/api-taller";
import { guardarHoja } from "@/lib/taller-ops";
import { hojaJson } from "@/lib/taller-pedidos";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    const u = await usuarioApp(req);
    return { hoja: hojaJson(await guardarHoja((await params).id, u, await cuerpo(req))) };
  });
}
