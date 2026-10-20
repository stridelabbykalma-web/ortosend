// Ajustes de coste del taller (precio hora, CNC por minuto, escayola de los moldes).
import { cuerpo, responder, usuarioApp } from "@/lib/api-taller";
import { ajustesTaller, guardarAjustes } from "@/lib/taller-ops";
import { audit } from "@/lib/cases";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return responder(async () => {
    await usuarioApp(req);
    return { ajustes: await ajustesTaller() };
  });
}

export async function PUT(req: Request) {
  return responder(async () => {
    const u = await usuarioApp(req);
    const ajustes = await guardarAjustes(await cuerpo(req));
    await audit(u.id, "taller.ajustes", "ajustes", null);
    return { ajustes };
  });
}
