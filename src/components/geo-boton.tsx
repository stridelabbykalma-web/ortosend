"use client";

// Botón «Usar mi ubicación»: geolocalización del navegador → /buscar?lat=&lng=
import { useRouter } from "next/navigation";
import { useState } from "react";

export function GeoBoton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (!navigator.geolocation) return alert("Tu navegador no permite la geolocalización");
        setBusy(true);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            router.push(`/buscar?lat=${pos.coords.latitude.toFixed(5)}&lng=${pos.coords.longitude.toFixed(5)}`);
            setBusy(false);
          },
          () => {
            alert("No se pudo obtener tu ubicación. Busca por población o código postal.");
            setBusy(false);
          },
          { timeout: 10000 }
        );
      }}
    >
      {busy ? "Localizando…" : "Usar mi ubicación"}
    </button>
  );
}
