"use client";

// Paso del escaneo de las espumas: la pantalla dice qué carpeta hay que elegir
// en RevoScan al guardar y se queda esperando. El puente instalado en el PC
// del escáner sube el archivo en cuanto aparece y aquí se ve llegar solo,
// ya asociado al paciente. Si esa clínica no tiene puente, el mismo cuadro
// permite adjuntar el archivo a mano — se asocia igual, por el mismo código.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const fmtMB = (bytes: number) =>
  `${(bytes / (1024 * 1024)).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;

type Estado = { hecho: boolean; archivo: string | null; bytes: number | null; puente: boolean };

// Cada cuánto se pregunta al servidor si el escaneo ya ha llegado.
const POLL_MS = 4000;

export function EscaneoPuente({
  caseId,
  folder,
  paciente,
  caso,
  puenteInicial,
}: {
  caseId: string;
  folder: string;
  paciente: string;
  caso: number;
  puenteInicial: boolean;
}) {
  const router = useRouter();
  const [est, setEst] = useState<Estado>({
    hecho: false,
    archivo: null,
    bytes: null,
    puente: puenteInicial,
  });
  const [copiado, setCopiado] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const avisado = useRef(false);

  const consultar = useCallback(async () => {
    try {
      const res = await fetch(`/api/scan/estado?caseId=${caseId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Estado;
      setEst(data);
      // Ha llegado mientras esperábamos: se recarga la página para que el check
      // del protocolo y la checklist de envío se pongan en verde.
      if (data.hecho && !avisado.current) {
        avisado.current = true;
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

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(folder);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setError("El navegador no ha dejado copiar: escribe el nombre de la carpeta a mano.");
    }
  };

  const subir = async (file: File) => {
    setError(null);
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("code", folder);
      fd.append("nombre", file.name);
      fd.append("file", file);
      const res = await fetch("/api/scan/ingest", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "No se pudo subir el escaneo");
      await consultar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir el escaneo");
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (est.hecho)
    return (
      <div className="note g">
        Escaneo recibido y asociado a <b>{paciente}</b> (caso #{caso})
        {est.archivo ? ` — ${est.archivo}` : ""}
        {est.bytes ? ` · ${fmtMB(est.bytes)}` : ""}.
      </div>
    );

  return (
    <>
      <div className="card" style={{ padding: 12 }}>
        <div className="tiny muted">En RevoScan, al guardar o exportar, elige esta carpeta:</div>
        <div className="row between" style={{ gap: 8, alignItems: "center", marginTop: 6 }}>
          <code style={{ fontSize: 16, wordBreak: "break-all" }}>{folder}</code>
          <button type="button" className="btn" onClick={copiar}>
            {copiado ? "Copiado ✓" : "Copiar"}
          </button>
        </div>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          Está dentro de la carpeta de escaneos del PC del escáner. El nombre del archivo da igual:
          la carpeta ya lleva el caso de <b>{paciente}</b>.
        </div>
      </div>

      <div className="sp" />
      {est.puente ? (
        <div className="note b" aria-live="polite">
          Esperando el escaneo… En cuanto lo guardes en esa carpeta aparecerá aquí solo, asociado a{" "}
          <b>{paciente}</b>. No hace falta subir nada.
        </div>
      ) : (
        <div className="note a">
          El puente de escaneo no está dando señal en esta clínica (¿el PC del escáner apagado o el
          programa cerrado?). Puedes adjuntar el archivo aquí mismo y se asociará igual.
        </div>
      )}

      <div className="sp" />
      <label className="tiny muted">
        Adjuntar el escaneo a mano (.stl, .obj, .ply, .glb, .3mf, .zip)
      </label>
      <input
        ref={fileRef}
        type="file"
        accept=".stl,.obj,.ply,.glb,.gltf,.3mf,.asc,.zip"
        disabled={subiendo}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) subir(f);
        }}
      />
      {subiendo && <div className="muted">Subiendo el escaneo…</div>}
      {error && <div className="note r">{error}</div>}
    </>
  );
}
