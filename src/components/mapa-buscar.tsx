"use client";

// Mapa del buscador (Leaflet + teselas CARTO/OSM). El mapa se crea UNA sola vez
// al montar el componente (visible desde el primer momento) y después solo se
// actualizan sus capas — evita los errores de Leaflet por destruir/recrear el
// mapa en mitad de animaciones.
import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";

export type ClinicPin = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  hasPrescriber: boolean;
};

const DEFAULT_VIEW: [number, number] = [40.2, -3.7]; // España
const DEFAULT_ZOOM = 5;

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
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LayerGroup | null>(null);
  const dataKey = JSON.stringify([clinics.map((c) => [c.id, c.lat, c.lng]), center?.lat, center?.lng, radiusKm]);

  // Creación única del mapa, visible desde el momento 0.
  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !ref.current || mapRef.current) return;
      const map = L.map(ref.current, {
        center: DEFAULT_VIEW,
        zoom: DEFAULT_ZOOM,
        scrollWheelZoom: false,
        zoomAnimation: false, // sin animaciones: sin estados intermedios frágiles
        fadeAnimation: false,
        markerZoomAnimation: false,
      });
      // Esri World Street Map: sin API key y sin bloqueo a apps en *.vercel.app
      // (OSM y CARTO bloquean/exigen clave). Ojo al orden {z}/{y}/{x} de Esri.
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Powered by Esri — Esri, HERE, Garmin | © OpenStreetMap contributors",
      }).addTo(map);
      layersRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setTimeout(() => {
        try {
          map.invalidateSize({ animate: false });
        } catch {}
      }, 200);
    })();
    return () => {
      disposed = true;
      try {
        mapRef.current?.remove();
      } catch {}
      mapRef.current = null;
      layersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actualización de capas cuando cambian clínicas/centro (sin recrear el mapa).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      // Espera a que el mapa exista (la creación es asíncrona).
      for (let i = 0; i < 40 && !mapRef.current && !cancelled; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const map = mapRef.current;
      const layers = layersRef.current;
      if (cancelled || !map || !layers) return;
      try {
        layers.clearLayers();
        const bounds = L.latLngBounds([]);
        for (const c of clinics) {
          const marker = L.circleMarker([c.lat, c.lng], {
            radius: 9,
            color: "#0E6E5C",
            weight: 2,
            fillColor: "#0E6E5C",
            fillOpacity: 0.85,
          });
          marker.bindPopup(
            `<b>${c.name}</b><br>${c.address}<br>` +
              `<span style="font-size:11px;color:#666">${c.hasPrescriber ? "Prescriptor en la propia clínica" : "Prescripción por el equipo Ortosend"}</span><br>` +
              `<a href="/reserva/${c.id}" style="color:#0E6E5C;font-weight:600">Reservar cita gratis →</a>`
          );
          layers.addLayer(marker);
          bounds.extend([c.lat, c.lng]);
        }
        if (center) {
          layers.addLayer(
            L.circleMarker([center.lat, center.lng], {
              radius: 6,
              color: "#1E5FA8",
              weight: 2,
              fillColor: "#1E5FA8",
              fillOpacity: 0.9,
            }).bindPopup("Tu búsqueda")
          );
          const circle = L.circle([center.lat, center.lng], {
            radius: radiusKm * 1000,
            color: "#1E5FA8",
            weight: 1.5,
            dashArray: "6 6",
            fillColor: "#1E5FA8",
            fillOpacity: 0.06,
          });
          layers.addLayer(circle);
          map.fitBounds(circle.getBounds(), { padding: [20, 20], animate: false });
        } else if (bounds.isValid()) {
          map.fitBounds(bounds.pad(0.35), { animate: false });
        }
      } catch (e) {
        console.error("Mapa:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  return (
    <div
      ref={ref}
      style={{
        height: 380,
        borderRadius: 14,
        border: "1px solid var(--line)",
        overflow: "hidden",
        zIndex: 0,
        background: "#e8e6df",
      }}
    />
  );
}
