// Pedidos activos del taller, en el orden del tablero (qué debe salir antes).
import { responder, usuarioApp } from "@/lib/api-taller";
import { listaPedidos } from "@/lib/taller-pedidos";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return responder(async () => {
    await usuarioApp(req);
    return { pedidos: await listaPedidos() };
  });
}
