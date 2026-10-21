// Catálogo de materiales del taller (lo edita el Rectificador). PUT guarda la lista entera.
import { cuerpo, responder, usuarioApp } from "@/lib/api-taller";
import { guardarMateriales, materialesTaller } from "@/lib/taller-ops";
import { audit } from "@/lib/cases";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return responder(async () => {
    await usuarioApp(req);
    return { materiales: await materialesTaller(true) };
  });
}

export async function PUT(req: Request) {
  return responder(async () => {
    const u = await usuarioApp(req);
    const e = (await cuerpo(req)) as { materiales?: unknown };
    const materiales = await guardarMateriales(e.materiales);
    await audit(u.id, "taller.materiales", "materiales", null, { total: materiales.length });
    return { materiales };
  });
}
