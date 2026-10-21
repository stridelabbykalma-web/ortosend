// Molde fresado → confección a mano (igual que el botón del panel del taller).
import { cuerpo, responder, usuarioApp } from "@/lib/api-taller";
import { marcarMecanizado } from "@/lib/taller-ops";
import { detallePedido } from "@/lib/taller-pedidos";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    const u = await usuarioApp(req);
    const { id } = await params;
    const e = (await cuerpo(req)) as { lote?: unknown };
    await marcarMecanizado(id, u, typeof e.lote === "string" ? e.lote : "");
    return detallePedido(id, u);
  });
}
