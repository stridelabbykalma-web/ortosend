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
    <div className="wrap">
      <div className="px-sec" style={{ paddingTop: 56 }}>
        <div className="px-kicker" style={{ textAlign: "center" }}>Red de clínicas</div>
        <h2 className="px-h2" style={{ textAlign: "center" }}>Clínicas asociadas cerca de ti</h2>
        <Flash error={error} ok={ok} />
        <div className="px-search" style={{ marginBottom: 0 }}>
          <BuscadorVivo initialQuery={q} />
        </div>
        <div className="sp2" />
      </div>
    </div>
  );
}
