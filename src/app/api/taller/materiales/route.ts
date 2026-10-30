// Catálogo de materiales del taller (lo edita el programa del taller). PUT guarda la lista entera.
// Precios y rendimientos solo los ve y los cambia el administrador: el taller edita el resto.
import { cuerpo, responder, usuarioApp } from "@/lib/api-taller";
import { guardarMateriales, materialesTaller } from "@/lib/taller-ops";
import { materialSinCostes, veCostes } from "@/lib/taller-pedidos";
import { audit } from "@/lib/cases";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return responder(async () => {
    const u = await usuarioApp(req);
    const materiales = await materialesTaller(true);
    return { materiales: veCostes(u) ? materiales : materiales.map(materialSinCostes) };
  });
}

export async function PUT(req: Request) {
  return responder(async () => {
    const u = await usuarioApp(req);
    const e = (await cuerpo(req)) as { materiales?: unknown };
    const materiales = await guardarMateriales(e.materiales, { conPrecios: veCostes(u) });
    await audit(u.id, "taller.materiales", "materiales", null, { total: materiales.length });
    return { materiales: veCostes(u) ? materiales : materiales.map(materialSinCostes) };
  });
}
