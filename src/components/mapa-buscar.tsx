"use client";

// Mapa del buscador (Leaflet + OpenStreetMap): clínicas, punto buscado y radio de 50 km.
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export type ClinicPin = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  hasPrescriber: boolean;
};

export function MapaBuscar({
  clinics,
  center,
  radiusKm,
}: {
  clinics: ClinicPin[];
  center: { lat: number; lng: number } | null;
  radiusKm: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const bounds = L.latLngBounds([]);
      for (const c of clinics) {
        const marker = L.circleMarker([c.lat, c.lng], {
          radius: 9,
          color: "#0E6E5C",
          weight: 2,
          fillColor: "#0E6E5C",
          fillOpacity: 0.85,
        }).addTo(map);
        marker.bindPopup(
          `<b>${c.name}</b><br>${c.address}<br>` +
            `<span style="font-size:11px;color:#666">${c.hasPrescriber ? "Prescriptor en la propia clínica" : "Prescripción por el equipo Ortosend"}</span><br>` +
            `<a href="/reserva/${c.id}" style="color:#0E6E5C;font-weight:600">Reservar cita gratis →</a>`
        );
        bounds.extend([c.lat, c.lng]);
      }
      if (center) {
        L.circleMarker([center.lat, center.lng], {
          radius: 6,
          color: "#1E5FA8",
          weight: 2,
          fillColor: "#1E5FA8",
          fillOpacity: 0.9,
        })
          .addTo(map)
          .bindPopup("Tu búsqueda");
        const circle = L.circle([center.lat, center.lng], {
          radius: radiusKm * 1000,
          color: "#1E5FA8",
          weight: 1.5,
          dashArray: "6 6",
          fillColor: "#1E5FA8",
          fillOpacity: 0.06,
        }).addTo(map);
        map.fitBounds(circle.getBounds(), { padding: [20, 20] });
      } else if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.35));
      } else {
        map.setView([41.98, 2.82], 9); // Girona por defecto
      }
    })();
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [clinics, center, radiusKm]);

  return (
    <div
      ref={ref}
      style={{
        height: 380,
        borderRadius: 14,
        border: "1px solid var(--line)",
        overflow: "hidden",
        zIndex: 0,
      }}
    />
  );
}
