// Ajustes de coste del taller (precio hora, CNC por minuto, escayola de los moldes): solo el administrador.
import { cuerpo, responder, usuarioApp } from "@/lib/api-taller";
import { ErrorTaller, ajustesTaller, guardarAjustes } from "@/lib/taller-ops";
import { veCostes } from "@/lib/taller-pedidos";
import { audit } from "@/lib/cases";

export const dynamic = "force-dynamic";

async function administrador(req: Request) {
  const u = await usuarioApp(req);
  if (!veCostes(u)) throw new ErrorTaller("Los costes solo los ve el administrador", 403);
  return u;
}

export async function GET(req: Request) {
  return responder(async () => {
    await administrador(req);
    return { ajustes: await ajustesTaller() };
  });
}

export async function PUT(req: Request) {
  return responder(async () => {
    const u = await administrador(req);
    const ajustes = await guardarAjustes(await cuerpo(req));
    await audit(u.id, "taller.ajustes", "ajustes", null);
    return { ajustes };
  });
}
