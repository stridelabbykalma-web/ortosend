"use client";

// «Escanear material»: foto de la etiqueta de la plancha con la cámara del móvil → se lee el código de
// barras (lote, caducidad) → se elige el material y el pie → se guarda en la plantilla con la foto.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fotoReducida, leerCodigoDeFoto } from "@/lib/leer-codigo";

type Material = { id: string; nombre: string };
type Leido = { codigo: string; lote: string; caducidad: string; gtin: string; materialId: string; conocido: boolean };

export function EscanearMaterial({ caseId, materiales }: { caseId: string; materiales: Material[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<"nada" | "leyendo" | "form" | "guardando">("nada");
  const [foto, setFoto] = useState<Blob | null>(null);
  const [vista, setVista] = useState("");
  const [d, setD] = useState<Leido>({ codigo: "", lote: "", caducidad: "", gtin: "", materialId: "", conocido: false });
  const [pies, setPies] = useState("par");
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");

  async function alHacerFoto(file: File | undefined) {
    if (!file) return;
    setEstado("leyendo");
    setError("");
    setAviso("");
    const [codigo, reducida] = await Promise.all([leerCodigoDeFoto(file).catch(() => null), fotoReducida(file)]);
    setFoto(reducida);
    setVista(URL.createObjectURL(reducida));
    let datos: Leido = { codigo: codigo ?? "", lote: "", caducidad: "", gtin: "", materialId: "", conocido: false };
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
    } else {
      setAviso("No se ha podido leer el código: escribe el lote tal como pone en la etiqueta (la foto se guarda igual).");
    }
    setD(datos);
    setEstado("form");
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
        <button type="button" className="pri" style={{ width: "100%", padding: "14px 0", fontSize: 17 }} onClick={() => input.current?.click()}>
          📷 Escanear material (foto de la etiqueta)
        </button>
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
            <button type="button" onClick={() => input.current?.click()} disabled={estado === "guardando"}>
              Repetir foto
            </button>
            <button type="button" onClick={() => setEstado("nada")} disabled={estado === "guardando"}>
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
