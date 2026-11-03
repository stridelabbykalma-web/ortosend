// «Placa nueva» en una máquina: { id, ancho, largo, alto } (el id lo genera el programa).
import { cuerpo, responder, usuarioApp } from "@/lib/api-taller";
import { ponerPlaca } from "@/lib/maquinas";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    const u = await usuarioApp(req);
    const { id } = await params;
    return { maquina: await ponerPlaca(id, (await cuerpo(req)) as Record<string, unknown>, u) };
  });
}
