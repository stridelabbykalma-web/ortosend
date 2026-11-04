// Búsqueda de clínicas: misma experiencia en vivo que la portada, con soporte
// de enlaces directos (/buscar?q=girona) y los mensajes de acciones antiguas.
import { Flash } from "@/components/ui";
import { BuscadorVivo } from "@/components/buscador-vivo";

export const dynamic = "force-dynamic";

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string; ok?: string }>;
}) {
  const { q = "", error, ok } = await searchParams;
  return (
    <div className="oxp">
      <div className="ox-wrap ox-page">
        <h1 className="ox-h2">Clínicas asociadas cerca de ti</h1>
        <p className="ox-lead" style={{ maxWidth: "34ch" }}>
          Busca por población o código postal y reserva tu estudio gratuito en la hora que te venga
          bien.
        </p>
        <Flash error={error} ok={ok} />
        <div className="ox-busca" style={{ maxWidth: 860, marginTop: 26 }}>
          <div className="card">
            <BuscadorVivo initialQuery={q} />
          </div>
        </div>
      </div>
    </div>
  );
}
