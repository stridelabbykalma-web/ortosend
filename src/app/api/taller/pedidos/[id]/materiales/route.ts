// Registra un material usado en la plantilla: foto de la etiqueta + lo leído del código de barras
// (lote, caducidad, GTIN) + material y pie. Desde el móvil (sesión de la web) o desde Ortosend Taller.
import { responder, usuarioApp } from "@/lib/api-taller";
import { ErrorTaller, registrarConsumo } from "@/lib/taller-ops";
import { consumoJson } from "@/lib/taller-pedidos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    const u = await usuarioApp(req);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ErrorTaller("Se esperaba un formulario con la foto", 400);
    }
    const texto = (k: string) => String(form.get(k) ?? "");
    const archivo = form.get("foto");
    const foto =
      archivo instanceof File && archivo.size > 0
        ? { bytes: new Uint8Array(await archivo.arrayBuffer()), mime: archivo.type.split(";")[0] }
        : null;
    const consumo = await registrarConsumo((await params).id, u, {
      codigo: texto("codigo"),
      lote: texto("lote"),
      caducidad: texto("caducidad") || null,
      gtin: texto("gtin") || null,
      materialId: texto("materialId"),
      pies: texto("pies"),
      foto,
    });
    return { material: consumoJson(consumo) };
  });
}
