// Máquinas CNC del taller con la placa que tiene puesta cada una (Ortosend Taller).
import { cuerpo, responder, usuarioApp } from "@/lib/api-taller";
import { crearMaquina, listaMaquinas } from "@/lib/maquinas";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return responder(async () => {
    await usuarioApp(req);
    return { maquinas: await listaMaquinas() };
  });
}

export async function POST(req: Request) {
  return responder(async () => {
    const u = await usuarioApp(req);
    const e = (await cuerpo(req)) as { nombre?: unknown };
    return { maquina: await crearMaquina(e.nombre, u) };
  });
}
