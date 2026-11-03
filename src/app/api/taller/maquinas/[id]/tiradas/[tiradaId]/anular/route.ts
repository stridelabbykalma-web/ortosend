// «Deshacer la última tirada» (no se llegó a fresar): su zona vuelve a estar libre.
import { responder, usuarioApp } from "@/lib/api-taller";
import { anularTirada } from "@/lib/maquinas";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; tiradaId: string }> }) {
  return responder(async () => {
    const u = await usuarioApp(req);
    const { id, tiradaId } = await params;
    return { maquina: await anularTirada(id, tiradaId, u) };
  });
}
