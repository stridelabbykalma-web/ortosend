// Detalle de un pedido: pauta por pie, ficha técnica y hoja de confección.
import { responder, usuarioApp } from "@/lib/api-taller";
import { detallePedido } from "@/lib/taller-pedidos";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    const u = await usuarioApp(req);
    return detallePedido((await params).id, u);
  });
}
