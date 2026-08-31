// Búsqueda en vivo de clínicas para la portada: geocodifica q (o usa lat/lng)
// y devuelve las clínicas activas dentro del radio, ordenadas por cercanía.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { geocode, distanceKm, SEARCH_RADIUS_KM, type LatLng } from "@/lib/geo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Precalentamiento: despierta la función y la base de datos mientras el
  // visitante responde al aviso de ubicación (Neon gratis se suspende en reposo).
  if (searchParams.get("warm")) {
    await prisma.clinic.count();
    return NextResponse.json({ ok: true });
  }
  const q = (searchParams.get("q") ?? "").trim();
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  const clinics = await prisma.clinic.findMany({
    where: { status: "ACTIVA" },
    orderBy: { town: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      town: true,
      postalCode: true,
      lat: true,
      lng: true,
      hasPrescriber: true,
    },
  });

  let center: LatLng | null = null;
  if (lat && lng && !isNaN(+lat) && !isNaN(+lng)) center = { lat: +lat, lng: +lng, label: "tu ubicación" };
  else if (q) center = await geocode(q);

  let results;
  let mode: "radio" | "texto" | "todas";
  if (center) {
    mode = "radio";
    results = clinics
      .filter((c) => c.lat != null && c.lng != null)
      .map((c) => ({ ...c, distance: distanceKm(center!, { lat: c.lat!, lng: c.lng! }) }))
      .filter((c) => c.distance <= SEARCH_RADIUS_KM)
      .sort((a, b) => a.distance - b.distance);
  } else if (q) {
    mode = "texto";
    const qq = q.toLowerCase();
    results = clinics
      .filter(
        (c) =>
          c.town.toLowerCase().includes(qq) ||
          c.postalCode === qq ||
          (qq.length >= 2 && c.postalCode.startsWith(qq.slice(0, 2)))
      )
      .map((c) => ({ ...c, distance: null as number | null }));
  } else {
    mode = "todas";
    results = clinics.map((c) => ({ ...c, distance: null as number | null }));
  }

  return NextResponse.json({
    mode,
    center,
    radiusKm: SEARCH_RADIUS_KM,
    results,
  });
}
