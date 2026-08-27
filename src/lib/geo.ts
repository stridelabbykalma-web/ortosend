// Geolocalización del buscador: geocodificación (Nominatim/OSM) y distancias.
export const SEARCH_RADIUS_KM = 50;

export type LatLng = { lat: number; lng: number; label?: string };

// Distancia haversine en km.
export function distanceKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Geocodifica una población o código postal español con Nominatim (OSM).
// Devuelve null si no hay resultado o el servicio falla (el buscador cae
// entonces al filtro por texto). Resultados cacheados 24 h.
export async function geocode(q: string): Promise<LatLng | null> {
  const query = q.trim();
  if (!query) return null;
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=es&q=" +
      encodeURIComponent(query);
    const res = await fetch(url, {
      headers: { "User-Agent": "Ortosend/1.0 (hola@ortosend.com)" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat: string; lon: string; display_name?: string }[];
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name };
  } catch {
    return null;
  }
}
