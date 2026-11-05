"use client";

// «Escanear material»: se abre la cámara del móvil y se apunta al código de barras de la etiqueta de la
// plancha; en cuanto se lee (lote, caducidad) se guarda ese fotograma como prueba, se elige el material y
// el pie y se registra en la plantilla. Si la cámara en vivo no está disponible, se hace una foto normal;
// y si el código no se puede leer, se escribe el lote a mano (la foto se guarda igual).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fotoDeVideo, fotoReducida, leerCodigoDeFoto, leerCodigoDeVideo, prepararLector } from "@/lib/leer-codigo";

type Material = { id: string; nombre: string };
type Leido = { codigo: string; lote: string; caducidad: string; gtin: string; materialId: string; conocido: boolean };
const VACIO: Leido = { codigo: "", lote: "", caducidad: "", gtin: "", materialId: "", conocido: false };

export function EscanearMaterial({ caseId, materiales }: { caseId: string; materiales: Material[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const flujo = useRef<MediaStream | null>(null);
  const [estado, setEstado] = useState<"nada" | "camara" | "leyendo" | "form" | "guardando">("nada");
  const [foto, setFoto] = useState<Blob | null>(null);
  const [vista, setVista] = useState("");
  const [d, setD] = useState<Leido>(VACIO);
  const [pies, setPies] = useState("par");
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");

  function pararCamara() {
    flujo.current?.getTracks().forEach((t) => t.stop());
    flujo.current = null;
  }
  useEffect(() => pararCamara, []);

  // Mientras la cámara está abierta se intenta leer un fotograma tras otro.
  useEffect(() => {
    if (estado !== "camara") return;
    if (video.current && flujo.current) {
      video.current.srcObject = flujo.current;
      void video.current.play().catch(() => {});
    }
    let vivo = true;
    let vuelta = 0;
    (async () => {
      while (vivo) {
        const v = video.current;
        const codigo = v ? await leerCodigoDeVideo(v, vuelta++).catch(() => null) : null;
        if (!vivo) return;
        if (codigo && v) {
          navigator.vibrate?.(150);
          const f = await fotoDeVideo(v).catch(() => null);
          pararCamara();
          await rellenar(codigo, f);
          return;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    })();
    return () => {
      vivo = false;
    };
  }, [estado]);

  async function abrirCamara() {
    setError("");
    setAviso("");
    prepararLector();
    if (!navigator.mediaDevices?.getUserMedia) return input.current?.click();
    try {
      flujo.current = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch {
      // Sin permiso o sin cámara: foto normal.
      return input.current?.click();
    }
    setEstado("camara");
  }

  // Desde la cámara en vivo: «Hacer foto» con lo que se ve ahora (se lee a fondo).
  async function fotoAhora() {
    const v = video.current;
    if (!v?.videoWidth) return;
    const f = await fotoDeVideo(v).catch(() => null);
    pararCamara();
    setEstado("leyendo");
    await rellenar(f ? await leerCodigoDeFoto(f).catch(() => null) : null, f);
  }

  async function alHacerFoto(file: File | undefined) {
    if (!file) return;
    setEstado("leyendo");
    setError("");
    setAviso("");
    const [codigo, reducida] = await Promise.all([leerCodigoDeFoto(file).catch(() => null), fotoReducida(file)]);
    await rellenar(codigo, reducida);
  }

  async function rellenar(codigo: string | null, f: Blob | null) {
    setFoto(f);
    setVista(f ? URL.createObjectURL(f) : "");
    let datos: Leido = { ...VACIO, codigo: codigo ?? "" };
    if (codigo) {
      try {
        const r = await fetch(`/api/taller/lotes?codigo=${encodeURIComponent(codigo)}`);
        const j = await r.json();
        if (j.lote) {
          datos = { ...datos, lote: j.lote.lote, caducidad: j.lote.caducidad ?? "", gtin: j.lote.gtin ?? "", materialId: j.lote.materialId ?? "", conocido: true };
          setAviso(`Plancha conocida: ${j.lote.material ?? "material"} · lote ${j.lote.lote}`);
        } else {
          datos = { ...datos, lote: j.etiqueta?.lote ?? (j.etiqueta?.esGs1 ? "" : codigo), caducidad: j.etiqueta?.caducidad ?? "", gtin: j.etiqueta?.gtin ?? "" };
          setAviso(j.etiqueta?.esGs1 ? "Código leído: revisa el lote y elige el material." : "Código leído: comprueba que el lote es correcto.");
        }
      } catch {
        datos = { ...datos, lote: codigo };
      }
    } else if (f) {
      setAviso("No se ha podido leer el código: escribe el lote tal como pone en la etiqueta (la foto se guarda igual).");
    } else {
      setAviso("Escribe el lote tal como pone en la etiqueta.");
    }
    setD(datos);
    setEstado("form");
  }

  function cancelar() {
    pararCamara();
    setEstado("nada");
  }

  async function guardar() {
    if (!d.materialId) return setError("Elige el material");
    if (!d.lote.trim()) return setError("Escribe el nº de lote");
    setEstado("guardando");
    setError("");
    const f = new FormData();
    f.set("codigo", d.codigo);
    f.set("lote", d.lote);
    f.set("caducidad", d.caducidad);
    f.set("gtin", d.gtin);
    f.set("materialId", d.materialId);
    f.set("pies", pies);
    if (foto) f.set("foto", foto, "etiqueta.jpg");
    const r = await fetch(`/api/taller/pedidos/${caseId}/materiales`, { method: "POST", body: f });
    if (!r.ok) {
      setError((await r.json().catch(() => ({}))).error ?? "No se ha podido guardar");
      setEstado("form");
      return;
    }
    setEstado("nada");
    setFoto(null);
    setVista("");
    setPies("par");
    router.refresh();
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          void alHacerFoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {estado === "nada" && (
        <>
          <button type="button" className="pri" style={{ width: "100%", padding: "14px 0", fontSize: 17 }} onClick={abrirCamara}>
            📷 Escanear código de barras del material
          </button>
          <div className="row" style={{ justifyContent: "center", gap: 16, marginTop: 6 }}>
            <button type="button" className="tiny" style={{ border: 0, background: "none", textDecoration: "underline" }} onClick={() => input.current?.click()}>
              Hacer una foto
            </button>
            <button type="button" className="tiny" style={{ border: 0, background: "none", textDecoration: "underline" }} onClick={() => void rellenar(null, null)}>
              Escribir el lote a mano
            </button>
          </div>
        </>
      )}
      {estado === "camara" && (
        <div className="card" style={{ padding: 10 }}>
          <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", background: "#000" }}>
            <video ref={video} muted playsInline autoPlay style={{ width: "100%", display: "block", maxHeight: "60vh", objectFit: "cover" }} />
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: "8%",
                right: "8%",
                top: "35%",
                bottom: "35%",
                border: "3px solid #2f9e44",
                borderRadius: 8,
                boxShadow: "0 0 0 9999px rgba(0,0,0,.35)",
              }}
            />
          </div>
          <div className="tiny" style={{ margin: "8px 0", textAlign: "center" }}>
            Pon el código de barras dentro del recuadro verde, recto y a un palmo. Se lee solo.
          </div>
          <div className="row">
            <button type="button" onClick={fotoAhora} style={{ flex: 1 }}>
              Hacer foto ahora
            </button>
            <button type="button" onClick={cancelar}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {estado === "leyendo" && <div className="note">Leyendo el código de barras…</div>}
      {(estado === "form" || estado === "guardando") && (
        <div className="card" style={{ padding: 14 }}>
          {vista && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={vista} alt="Etiqueta" style={{ width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 8, background: "#eee" }} />
          )}
          {aviso && <div className="tiny" style={{ margin: "8px 0" }}>{aviso}</div>}
          <label>Material</label>
          <select value={d.materialId} onChange={(e) => setD({ ...d, materialId: e.target.value })}>
            <option value="">— Elige —</option>
            {materiales.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
          <label>Nº de lote</label>
          <input value={d.lote} onChange={(e) => setD({ ...d, lote: e.target.value })} disabled={d.conocido} />
          <label>Caducidad (si tiene)</label>
          <input type="date" value={d.caducidad} onChange={(e) => setD({ ...d, caducidad: e.target.value })} disabled={d.conocido} />
          <label>Para</label>
          <div className="row">
            {[
              ["par", "El par"],
              ["I", "Pie izquierdo"],
              ["D", "Pie derecho"],
            ].map(([v, t]) => (
              <label key={v} className="row" style={{ gap: 4, margin: 0 }}>
                <input type="radio" name="pies" checked={pies === v} onChange={() => setPies(v)} style={{ width: "auto" }} /> {t}
              </label>
            ))}
          </div>
          {error && <div className="note r" style={{ marginTop: 8 }}>{error}</div>}
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="pri" onClick={guardar} disabled={estado === "guardando"} style={{ flex: 1 }}>
              {estado === "guardando" ? "Guardando…" : "Guardar en esta plantilla"}
            </button>
            <button type="button" onClick={abrirCamara} disabled={estado === "guardando"}>
              Repetir
            </button>
            <button type="button" onClick={cancelar} disabled={estado === "guardando"}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Anular un registro equivocado (queda constancia del motivo).
export function AnularMaterial({ consumoId }: { consumoId: string }) {
  const router = useRouter();
  async function anular() {
    const motivo = window.prompt("¿Por qué se anula este registro? (queda constancia)");
    if (!motivo?.trim()) return;
    const r = await fetch(`/api/taller/consumos/${consumoId}/anular`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ motivo }),
    });
    if (!r.ok) window.alert((await r.json().catch(() => ({}))).error ?? "No se ha podido anular");
    router.refresh();
  }
  return (
    <button type="button" className="tiny" onClick={anular} style={{ padding: "2px 8px" }}>
      Anular
    </button>
  );
}
