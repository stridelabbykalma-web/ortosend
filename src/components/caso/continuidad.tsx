"use client";

// Continuidad del estudio entre dispositivos: late cada 20 s con el paso actual
// y, si el mismo profesional tiene el estudio abierto en OTRO dispositivo
// (p. ej. empezó en el PC y siguió en el móvil), muestra un aviso con su paso
// y un enlace para saltar a esa misma pantalla.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const LATIDO_MS = 20 * 1000;

function deviceId(): string {
  try {
    let id = localStorage.getItem("ortosend-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("ortosend-device", id);
    }
    return id;
  } catch {
    return "sin-storage";
  }
}

export function ContinuidadEstudio({ caseId, paso }: { caseId: string; paso: number }) {
  const [otro, setOtro] = useState<{ paso: number; haceSegundos: number } | null>(null);
  const [oculto, setOculto] = useState(false);
  const pasoRef = useRef(paso);
  pasoRef.current = paso;

  useEffect(() => {
    let vivo = true;
    const late = async () => {
      try {
        const res = await fetch("/api/latido", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId, deviceId: deviceId(), paso: pasoRef.current }),
        });
        if (!vivo || !res.ok) return;
        const data = (await res.json()) as { otro: { paso: number; haceSegundos: number } | null };
        setOtro(data.otro);
      } catch {
        /* sin red: se reintenta en el siguiente latido */
      }
    };
    late();
    const t = setInterval(late, LATIDO_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [caseId]);

  if (!otro || oculto) return null;
  const mismaPantalla = otro.paso === paso;
  return (
    <div
      className="note a"
      style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}
    >
      <span>
        📱 Este estudio se está usando en <b>otro dispositivo</b>
        {otro.paso > 0 ? (
          <>
            {" "}
            (va por el <b>paso {otro.paso}</b>)
          </>
        ) : (
          <> (está en el índice del protocolo)</>
        )}
        . Los datos se guardan igual desde los dos.
      </span>
      {!mismaPantalla && (
        <Link className="btn" href={otro.paso > 0 ? `/caso/${caseId}?paso=${otro.paso}` : `/caso/${caseId}`}>
          Ir a esa pantalla
        </Link>
      )}
      <button type="button" onClick={() => setOculto(true)}>
        Seguir aquí
      </button>
    </div>
  );
}
