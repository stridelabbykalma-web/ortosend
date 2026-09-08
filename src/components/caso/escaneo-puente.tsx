"use client";

// Paso del escaneo de las espumas. Mientras esta pantalla está abierta, el
// caso «espera escaneo»: lo que el puente del PC del escáner suba en ese
// momento se asocia solo a este paciente y aparece aquí sin recargar. Si hay
// duda (varios casos abiertos o nadie esperando cuando llegó), el escaneo se
// queda en la bandeja de la clínica y se confirma con un toque. Y si el
// puente no está en marcha, el archivo se puede subir desde aquí mismo.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const fmtMB = (bytes: number) =>
  `${(bytes / (1024 * 1024)).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;
const hace = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return min < 1 ? "ahora mismo" : min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`;
};

type Escaneo = { id: string; archivo: string; bytes: number; at: string };
type Bandeja = { id: string; filename: string; sizeBytes: number; receivedAt: string; uploadedBy: string };
type Estado = { hecho: boolean; escaneos: Escaneo[]; bandeja: Bandeja[]; puente: boolean };

// Cada cuánto se pregunta al servidor si el escaneo ya ha llegado (y se renueva
// la «espera» de este caso).
const POLL_MS = 4000;
const ACCEPT = ".stl,.obj,.ply,.glb,.gltf,.3mf,.asc,.zip";

export function EscaneoPuente({
  caseId,
  paciente,
  caso,
  inicial,
}: {
  caseId: string;
  paciente: string;
  caso: number;
  inicial: Estado;
}) {
  const router = useRouter();
  const [est, setEst] = useState<Estado>(inicial);
  const [progreso, setProgreso] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const vistos = useRef(inicial.escaneos.length);

  const consultar = useCallback(async () => {
    try {
      const res = await fetch(`/api/scan/estado?caseId=${caseId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Estado;
      setEst(data);
      // Ha llegado uno nuevo: se recarga la página para que el check del
      // protocolo y la checklist de envío se pongan en verde.
      if (data.escaneos.length > vistos.current) {
        vistos.current = data.escaneos.length;
        router.refresh();
      }
    } catch {
      // Sin red momentáneamente: se reintenta en el siguiente ciclo.
    }
  }, [caseId, router]);

  useEffect(() => {
    const t = setInterval(consultar, POLL_MS);
    return () => clearInterval(t);
  }, [consultar]);

  const asociar = async (uploadId: string) => {
    setError(null);
    setOcupado(true);
    try {
      const res = await fetch("/api/scan/asignar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, caseId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "No se pudo asociar el escaneo");
      await consultar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo asociar el escaneo");
    } finally {
      setOcupado(false);
    }
  };

  // Subida desde el navegador: directa a R2 con URL firmada (sin límite) o,
  // sin R2, entera por el servidor. En ambos casos el caso ya está esperando,
  // así que se asocia solo al confirmar.
  const subir = async (file: File) => {
    setError(null);
    setOcupado(true);
    setProgreso(0);
    try {
      // Comprimido en el propio navegador si sabe (los mesh se reducen mucho).
      const gz = await comprimir(file);
      const cuerpo = gz ?? file;
      const r1 = await fetch("/api/scan/subida", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: file.name,
          bytes: file.size,
          ...(gz ? { encoding: "gzip", storedBytes: gz.size } : {}),
        }),
      });
      const plan = await r1.json();
      if (!r1.ok) throw new Error(plan?.error ?? "No se pudo preparar la subida");
      if (plan.modo === "directo") {
        await putConProgreso(plan.url, cuerpo, plan.headers ?? {}, setProgreso);
        const r2 = await fetch("/api/scan/confirmar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId: plan.uploadId }),
        });
        const d = await r2.json();
        if (!r2.ok) throw new Error(d?.error ?? "No se pudo confirmar la subida");
      } else {
        if (cuerpo.size > plan.maxBytes)
          throw new Error(`Sin almacén R2 configurado el archivo no puede superar ${fmtMB(plan.maxBytes)}`);
        const fd = new FormData();
        fd.append("nombre", file.name);
        fd.append("bytes", String(file.size));
        if (gz) fd.append("encoding", "gzip");
        fd.append("file", cuerpo, file.name);
        const res = await fetch("/api/scan/ingest", { method: "POST", body: fd });
        const d = await res.json();
        if (!res.ok) throw new Error(d?.error ?? "No se pudo subir el escaneo");
      }
      await consultar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir el escaneo");
    } finally {
      setOcupado(false);
      setProgreso(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      {est.escaneos.length > 0 && (
        <div className="note g">
          Escaneo recibido y asociado a <b>{paciente}</b> (caso #{caso}):
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            {est.escaneos.map((e) => (
              <li key={e.id}>
                {e.archivo} · {fmtMB(e.bytes)} · {hace(e.at)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {est.bandeja.length > 0 && (
        <div className="note a">
          <b>Escaneos recibidos en la clínica sin paciente asignado.</b> ¿Alguno es de {paciente}?
          <ul style={{ margin: "6px 0 0 0", padding: 0, listStyle: "none" }}>
            {est.bandeja.map((b) => (
              <li key={b.id} className="row between" style={{ gap: 8, alignItems: "center", marginTop: 6 }}>
                <span>
                  {b.filename} · {fmtMB(b.sizeBytes)} · {hace(b.receivedAt)} · {b.uploadedBy}
                </span>
                <button type="button" className="btn" disabled={ocupado} onClick={() => asociar(b.id)}>
                  Es de {paciente.split(" ")[0]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {est.escaneos.length === 0 && est.bandeja.length === 0 && (
        <div className={`note ${est.puente ? "b" : "a"}`} aria-live="polite">
          {est.puente ? (
            <>
              <b>Esperando el escaneo…</b> Escanea con RevoScan y exporta el mesh a la carpeta de
              escaneos del PC del escáner, como siempre. Aparecerá aquí solo, asociado a{" "}
              <b>{paciente}</b>. No cierres esta pantalla mientras escaneas.
            </>
          ) : (
            <>
              El puente de escaneo no está dando señal en esta clínica (¿el PC del escáner apagado o
              el programa cerrado?). Puedes subir el archivo aquí mismo y se asociará igual.
            </>
          )}
        </div>
      )}

      <div className="sp" />
      <label className="tiny muted">
        {est.escaneos.length ? "Añadir otro escaneo a mano" : "Subir el escaneo a mano"} (.stl, .obj,
        .ply, .glb, .3mf, .zip)
      </label>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        disabled={ocupado}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) subir(f);
        }}
      />
      {progreso !== null && (
        <div className="muted" aria-live="polite">
          Subiendo el escaneo… {progreso}%
        </div>
      )}
      {error && <div className="note r">{error}</div>}
    </>
  );
}

// gzip en el navegador (CompressionStream); null si el navegador no lo tiene.
async function comprimir(file: File): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    return await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  } catch {
    return null;
  }
}

// PUT a la URL firmada con progreso real (fetch no lo da para subidas).
function putConProgreso(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgreso: (pct: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgreso(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`El almacén rechazó el archivo (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("Fallo de red al subir al almacén"));
    xhr.send(file);
  });
}
