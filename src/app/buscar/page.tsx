import Link from "next/link";
import { prisma } from "@/lib/db";
import { Flash } from "@/components/ui";
import { waitlistAction } from "@/app/publico-actions";
import { geocode, distanceKm, SEARCH_RADIUS_KM, type LatLng } from "@/lib/geo";
import { MapaBuscar, type ClinicPin } from "@/components/mapa-buscar";
import { GeoBoton } from "@/components/geo-boton";

export const dynamic = "force-dynamic";

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lat?: string; lng?: string; error?: string; ok?: string }>;
}) {
  const { q = "", lat, lng, error, ok } = await searchParams;
  const query = q.trim();
  const clinics = await prisma.clinic.findMany({
    where: { status: "ACTIVA" },
    orderBy: { town: "asc" },
  });

  // Centro de búsqueda: coordenadas del navegador o geocodificación de la consulta (Nominatim/OSM).
  let center: LatLng | null = null;
  if (lat && lng && !isNaN(+lat) && !isNaN(+lng)) center = { lat: +lat, lng: +lng, label: "tu ubicación" };
  else if (query) center = await geocode(query);

  // Con centro: radio real de 50 km ordenado por cercanía. Sin él: filtro por texto.
  let results: (typeof clinics[number] & { distance?: number })[];
  if (center) {
    results = clinics
      .filter((c) => c.lat != null && c.lng != null)
      .map((c) => ({ ...c, distance: distanceKm(center!, { lat: c.lat!, lng: c.lng! }) }))
      .filter((c) => c.distance! <= SEARCH_RADIUS_KM)
      .sort((a, b) => a.distance! - b.distance!);
  } else if (query) {
    const qq = query.toLowerCase();
    results = clinics.filter(
      (c) =>
        c.town.toLowerCase().includes(qq) ||
        c.postalCode === qq ||
        (qq.length >= 2 && c.postalCode.startsWith(qq.slice(0, 2)))
    );
  } else {
    results = clinics;
  }
  const none = (query || center) && results.length === 0;
  const pins: ClinicPin[] = (results.length ? results : clinics)
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      address: c.address,
      lat: c.lat!,
      lng: c.lng!,
      hasPrescriber: c.hasPrescriber,
    }));

  return (
    <div className="wrap">
      <div className="sp2" />
      <h2>Clínicas asociadas cerca de ti</h2>
      <form className="row" style={{ margin: "14px 0" }} action="/buscar">
        <input name="q" defaultValue={q} placeholder="Código postal o población" style={{ maxWidth: 280 }} />
        <button type="submit" className="pri">
          Buscar
        </button>
        <GeoBoton />
      </form>
      <Flash error={error} ok={ok} />
      {center && (
        <div className="tiny" style={{ marginBottom: 10 }}>
          Mostrando clínicas a menos de {SEARCH_RADIUS_KM} km de {center.label?.split(",")[0] ?? "tu búsqueda"}.
        </div>
      )}
      {query && !center && (
        <div className="tiny" style={{ marginBottom: 10 }}>
          No hemos podido situar «{query}» en el mapa; mostramos coincidencias por nombre o código postal.
        </div>
      )}
      <MapaBuscar clinics={pins} center={center} radiusKm={SEARCH_RADIUS_KM} />
      <div className="sp" />
      {none && (
        <div className="card">
          <b>Aún no llegamos a tu zona</b>
          <p className="muted" style={{ margin: "8px 0" }}>
            Déjanos tu contacto y te avisaremos cuando haya una clínica asociada cerca.
          </p>
          <form className="row" action={waitlistAction}>
            <input type="hidden" name="zone" value={query || `${lat},${lng}`} />
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
              {c.distance != null && <> · a {c.distance < 1 ? "menos de 1" : Math.round(c.distance)} km</>}
            </div>
            <Link href={`/reserva/${c.id}`} className="btn pri wfull" style={{ textAlign: "center" }}>
              Reservar cita gratis
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
