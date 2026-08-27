"use client";

// Buscador en vivo de la portada: código postal o ubicación → mapa + lista de
// clínicas más cercanas, sin cambiar de página.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MapaBuscar, type ClinicPin } from "./mapa-buscar";

type Result = ClinicPin & { town: string; distance: number | null };
type SearchResponse = {
  mode: "radio" | "texto" | "todas";
  center: { lat: number; lng: number; label?: string } | null;
  radiusKm: number;
  results: (Result & { lat: number | null; lng: number | null })[];
};

export function BuscadorVivo({ initialQuery = "" }: { initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [wlContact, setWlContact] = useState("");
  const [wlDone, setWlDone] = useState(false);
  const [geoDenied, setGeoDenied] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  async function search(params: string, opts: { scroll?: boolean } = {}) {
    // Microtarea previa: evita setState síncrono cuando se llama desde un efecto.
    await Promise.resolve();
    setBusy(true);
    setWlDone(false);
    try {
      const res = await fetch(`/api/clinicas?${params}`);
      const json = (await res.json()) as SearchResponse;
      setData(json);
      setSearched(true);
      if (opts.scroll !== false)
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
    } catch {
      alert("No se pudo buscar ahora mismo. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  // Si llega con búsqueda inicial (p. ej. /buscar?q=...), la lanza al cargar.
  useEffect(() => {
    const t = setTimeout(() => {
      if (initialQuery) {
        void search(`q=${encodeURIComponent(initialQuery)}`, { scroll: false });
      } else if (navigator.geolocation) {
        // Petición de ubicación automática al entrar. Si acepta → cercanas;
        // si deniega → nada hasta que busque por población o CP.
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            void search(`lat=${pos.coords.latitude.toFixed(5)}&lng=${pos.coords.longitude.toFixed(5)}`, {
              scroll: false,
            }),
          () => setGeoDenied(true),
          { timeout: 10000 }
        );
      } else {
        setGeoDenied(true);
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reintento manual (p. ej. denegó el permiso al entrar y luego quiere darlo).
  function useLocation() {
    if (!navigator.geolocation) return alert("Tu navegador no permite la geolocalización");
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => void search(`lat=${pos.coords.latitude.toFixed(5)}&lng=${pos.coords.longitude.toFixed(5)}`),
      () => {
        setBusy(false);
        alert(
          "No hay acceso a tu ubicación. Si lo denegaste, actívalo en el candado de la barra de direcciones y vuelve a intentarlo — o busca por población o código postal."
        );
      },
      { timeout: 10000 }
    );
  }

  const pins: ClinicPin[] = (data?.results ?? []).filter((c) => c.lat != null && c.lng != null) as ClinicPin[];
  const none = searched && data && data.mode !== "todas" && data.results.length === 0;

  return (
    <div>
      <form
        className="row"
        style={{ maxWidth: 520, margin: "0 auto", justifyContent: "center" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) void search(`q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tu código postal o población"
            style={{ width: "100%", paddingRight: 40 }}
          />
          <button
            type="button"
            onClick={useLocation}
            disabled={busy}
            title="Buscar cerca de mi ubicación"
            aria-label="Usar mi ubicación"
            style={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              width: 30,
              height: 30,
              padding: 0,
              border: "none",
              background: "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            {/* Icono de diana (localizarme) */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="1.5" fill="var(--teal)" stroke="none" />
              <line x1="12" y1="2" x2="12" y2="5" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" />
              <line x1="19" y1="12" x2="22" y2="12" />
            </svg>
          </button>
        </div>
        <button type="submit" className="pri" disabled={busy}>
          {busy ? "Buscando…" : "Buscar clínica"}
        </button>
      </form>
      <div className="tiny" style={{ marginTop: 10, textAlign: "center" }}>
        {geoDenied && !searched
          ? "Sin acceso a tu ubicación — escribe tu población o código postal para ver las clínicas cercanas."
          : "Te mostramos las clínicas asociadas en un radio de 50 km · Recibe tus plantillas en 5 días laborables desde el pago"}
      </div>

      {searched && data && (
        <div ref={resultsRef} style={{ marginTop: 26, textAlign: "left" }}>
          {data.center && (
            <div className="tiny" style={{ marginBottom: 8 }}>
              Clínicas a menos de {data.radiusKm} km de {data.center.label?.split(",")[0] ?? "tu búsqueda"}:
            </div>
          )}
          {data.mode === "texto" && (
            <div className="tiny" style={{ marginBottom: 8 }}>
              No hemos podido situar «{q}» en el mapa; mostramos coincidencias por nombre o código postal.
            </div>
          )}
          <MapaBuscar clinics={pins} center={data.center} radiusKm={data.radiusKm} />
          <div className="sp" />
          {none && (
            <div className="card">
              <b>Aún no llegamos a tu zona</b>
              {wlDone ? (
                <div className="note g" style={{ marginTop: 8 }}>
                  Apuntado. Te avisaremos cuando haya una clínica asociada cerca.
                </div>
              ) : (
                <>
                  <p className="muted" style={{ margin: "8px 0" }}>
                    Déjanos tu contacto y te avisaremos cuando haya una clínica asociada cerca.
                  </p>
                  <div className="row">
                    <input
                      value={wlContact}
                      onChange={(e) => setWlContact(e.target.value)}
                      placeholder="Tu móvil o email"
                      style={{ maxWidth: 260 }}
                    />
                    <button
                      type="button"
                      className="pri"
                      onClick={async () => {
                        if (!wlContact.trim()) return alert("Escribe un contacto");
                        const res = await fetch("/api/waitlist", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ zone: q || "ubicación GPS", contact: wlContact.trim() }),
                        });
                        if (res.ok) setWlDone(true);
                        else alert("No se pudo guardar. Inténtalo de nuevo.");
                      }}
                    >
                      Avisadme
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="grid g3" style={{ marginTop: 10 }}>
            {data.results.map((c) => (
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
      )}
    </div>
  );
}
