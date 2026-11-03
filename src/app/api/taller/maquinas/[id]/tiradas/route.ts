// «▶ Inicio»: la tirada gasta sus zonas de la placa: { id, placaId, nombre, zonas: [{x, y, ancho, largo}] }.
import { cuerpo, responder, usuarioApp } from "@/lib/api-taller";
import { registrarTirada } from "@/lib/maquinas";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    const u = await usuarioApp(req);
    const { id } = await params;
    return { maquina: await registrarTirada(id, (await cuerpo(req)) as Record<string, unknown>, u) };
  });
}
