import Link from "next/link";
import { prisma } from "@/lib/db";
import { Flash } from "@/components/ui";
import { waitlistAction } from "@/app/publico-actions";

export const dynamic = "force-dynamic";

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string; ok?: string }>;
}) {
  const { q = "", error, ok } = await searchParams;
  const query = q.trim().toLowerCase();
  const clinics = await prisma.clinic.findMany({
    where: { status: "ACTIVA" },
    orderBy: { town: "asc" },
  });
  // Búsqueda por población o CP (aprox. por prefijo de provincia). Mapa + radio 50 km: pendiente (Leaflet/OSM).
  const results = query
    ? clinics.filter(
        (c) =>
          c.town.toLowerCase().includes(query) ||
          c.postalCode === query ||
          (query.length >= 2 && c.postalCode.startsWith(query.slice(0, 2)))
      )
    : clinics;
  const none = query && results.length === 0;
  return (
    <div className="wrap">
      <div className="sp2" />
      <h2>Clínicas asociadas cerca de ti</h2>
      <form className="row" style={{ margin: "14px 0" }} action="/buscar">
        <input name="q" defaultValue={q} placeholder="Código postal o población" style={{ maxWidth: 280 }} />
        <button type="submit" className="pri">
          Buscar
        </button>
      </form>
      <Flash error={error} ok={ok} />
      {none && (
        <div className="card">
          <b>Aún no llegamos a tu zona</b>
          <p className="muted" style={{ margin: "8px 0" }}>
            Déjanos tu contacto y te avisaremos cuando haya una clínica asociada cerca.
          </p>
          <form className="row" action={waitlistAction}>
            <input type="hidden" name="zone" value={q} />
            <input name="contact" placeholder="Tu móvil o email" style={{ maxWidth: 260 }} />
            <button type="submit" className="pri">
              Avisadme
            </button>
          </form>
        </div>
      )}
      <div className="grid g3" style={{ marginTop: 10 }}>
        {results.map((c) => (
          <div className="card" key={c.id}>
            <b style={{ fontFamily: "var(--font-sora)" }}>{c.name}</b>
            <div className="muted">{c.address}</div>
            <div className="tiny" style={{ margin: "6px 0" }}>
              {c.hasPrescriber ? "Prescriptor en la propia clínica" : "Prescripción por el equipo Ortosend"}
            </div>
            <Link href={`/reserva/${c.id}`} className="btn pri wfull" style={{ textAlign: "center" }}>
              Reservar cita gratis
            </Link>
          </div>
        ))}
      </div>
      <div className="sp" />
      <div className="note">
        Próximamente: mapa interactivo (Leaflet/OSM) con radio real de 50 km. De momento, búsqueda
        por población o código postal.
      </div>
    </div>
  );
}
