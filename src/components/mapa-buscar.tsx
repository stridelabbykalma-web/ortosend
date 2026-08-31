"use client";

// Mapa del buscador con Google Maps: clínicas asociadas, punto buscado y radio
// de 50 km. Los negocios/POIs de Google van ocultos para que solo destaquen
// las clínicas de la red. El mapa se crea una vez y solo se actualizan capas.
//
// La clave es de uso en navegador (viaja en el HTML) y está restringida por
// dominio en Google Cloud; NEXT_PUBLIC_GOOGLE_MAPS_KEY permite sobrescribirla.
import { useEffect, useRef } from "react";

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "AIzaSyAYf2ZSh2rXeipzP0kOECR6aJ6oweoOBQU";

export type ClinicPin = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  hasPrescriber: boolean;
};

const DEFAULT_VIEW = { lat: 40.2, lng: -3.7 }; // España
const DEFAULT_ZOOM = 5;

declare global {
  interface Window {
    __gmapsReady?: () => void;
    __gmapsLoader?: Promise<typeof google.maps>;
  }
}

function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof google !== "undefined" && google.maps) return Promise.resolve(google.maps);
  if (!window.__gmapsLoader) {
    window.__gmapsLoader = new Promise((resolve, reject) => {
      window.__gmapsReady = () => resolve(google.maps);
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&callback=__gmapsReady&language=es&region=ES`;
      s.async = true;
      s.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
      document.head.appendChild(s);
    });
  }
  return window.__gmapsLoader;
}

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
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<(google.maps.Marker | google.maps.Circle)[]>([]);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const dataKey = JSON.stringify([clinics.map((c) => [c.id, c.lat, c.lng]), center?.lat, center?.lng, radiusKm]);

  // Creación única del mapa, visible desde el momento 0.
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const maps = await loadGoogleMaps();
        if (disposed || !ref.current || mapRef.current) return;
        mapRef.current = new maps.Map(ref.current, {
          center: DEFAULT_VIEW,
          zoom: DEFAULT_ZOOM,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          // Oculta los negocios de Google: solo se ven las clínicas asociadas.
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
        infoRef.current = new maps.InfoWindow();
      } catch (e) {
        console.error("Google Maps:", e);
      }
    })();
    return () => {
      disposed = true;
      mapRef.current = null;
      overlaysRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actualización de marcadores/círculo cuando cambian los datos.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const maps = await loadGoogleMaps();
        for (let i = 0; i < 50 && !mapRef.current && !cancelled; i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
        const map = mapRef.current;
        if (cancelled || !map) return;
        overlaysRef.current.forEach((o) => o.setMap(null));
        overlaysRef.current = [];
        const bounds = new maps.LatLngBounds();
        for (const c of clinics) {
          const marker = new maps.Marker({
            map,
            position: { lat: c.lat, lng: c.lng },
            title: c.name,
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: "#0E6E5C",
              fillOpacity: 0.9,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
          });
          marker.addListener("click", () => {
            infoRef.current?.setContent(
              `<div style="font-family:Inter,system-ui,sans-serif;font-size:13px;max-width:220px">` +
                `<b>${c.name}</b><br>${c.address}<br>` +
                `<span style="font-size:11px;color:#666">${c.hasPrescriber ? "Prescriptor en la propia clínica" : "Prescripción por el equipo Ortosend"}</span><br>` +
                `<a href="/reserva/${c.id}" style="color:#0E6E5C;font-weight:600">Reservar cita gratis →</a></div>`
            );
            infoRef.current?.open({ map, anchor: marker });
          });
          overlaysRef.current.push(marker);
          bounds.extend({ lat: c.lat, lng: c.lng });
        }
        if (center) {
          overlaysRef.current.push(
            new maps.Marker({
              map,
              position: center,
              title: "Tu búsqueda",
              icon: {
                path: maps.SymbolPath.CIRCLE,
                scale: 7,
                fillColor: "#1E5FA8",
                fillOpacity: 0.95,
                strokeColor: "#ffffff",
                strokeWeight: 2,
              },
            })
          );
          const circle = new maps.Circle({
            map,
            center,
            radius: radiusKm * 1000,
            strokeColor: "#1E5FA8",
            strokeWeight: 1.5,
            strokeOpacity: 0.8,
            fillColor: "#1E5FA8",
            fillOpacity: 0.06,
          });
          overlaysRef.current.push(circle);
          const cb = circle.getBounds();
          if (cb) map.fitBounds(cb, 20);
        } else if (!bounds.isEmpty()) {
          map.fitBounds(bounds, 60);
        }
      } catch (e) {
        console.error("Google Maps capas:", e);
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
