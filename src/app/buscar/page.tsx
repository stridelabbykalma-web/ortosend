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
      <div className="sp2" />
      <h2 style={{ textAlign: "center" }}>Clínicas asociadas cerca de ti</h2>
      <div className="sp" />
      <Flash error={error} ok={ok} />
      <BuscadorVivo initialQuery={q} showAllInitially />
      <div className="sp2" />
    </div>
  );
}
