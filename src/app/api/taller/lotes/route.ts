// ¿Este código de barras ya está dado de alta? Para rellenar solo el material y el lote al escanear.
import { responder, usuarioApp } from "@/lib/api-taller";
import { buscarLote } from "@/lib/taller-ops";
import { leerEtiqueta } from "@/lib/gs1";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return responder(async () => {
    await usuarioApp(req);
    const codigo = new URL(req.url).searchParams.get("codigo") ?? "";
    const lote = await buscarLote(codigo);
    return {
      etiqueta: leerEtiqueta(codigo),
      lote: lote
        ? {
            lote: lote.lote,
            caducidad: lote.caducidad ? lote.caducidad.toISOString().slice(0, 10) : null,
            gtin: lote.gtin,
            materialId: lote.materialId,
            material: lote.material?.nombre ?? null,
          }
        : null,
    };
  });
}
