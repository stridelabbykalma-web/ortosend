"use client";

// Vídeo de marcha con los puntos de referencia superpuestos (sincronizados con
// la reproducción) y el informe preliminar debajo. Los puntos se guardaron con
// el vídeo en el momento de grabar; no se recalcula nada aquí.
import { useEffect, useRef, useState } from "react";
import { MARCHA_IDX, type MarchaInforme, type MarchaTrack } from "@/lib/marcha";

const IDX: number[] = [...MARCHA_IDX];
const pos = (lm: number) => IDX.indexOf(lm);
const HUESOS: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
].map(([a, b]) => [pos(a), pos(b)]);

export function VideoAnalizado({ src, track, informe }: { src: string; track: MarchaTrack; informe: MarchaInforme }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [lejos, setLejos] = useState(false); // sin datos cerca del instante reproducido
  const [mostrar, setMostrar] = useState(true);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    let last = -1;
    const tick = () => {
      const t = v.currentTime;
      if (t !== last) {
        last = t;
        // frame más cercano en el tiempo (búsqueda binaria)
        const fr = track.frames;
        let lo = 0, hi = fr.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (fr[mid].t < t) lo = mid + 1; else hi = mid;
        }
        const i = lo > 0 && Math.abs(fr[lo - 1].t - t) < Math.abs(fr[lo].t - t) ? lo - 1 : lo;
        setFrameIdx(i);
        setLejos(Math.abs(fr[i].t - t) > 0.25);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [track.frames]);

  const f = track.frames[frameIdx];
  const { w, h } = track;
  const P = (i: number) => ({ x: f.p[i * 3] * w, y: f.p[i * 3 + 1] * h, v: f.p[i * 3 + 2] });
  const sw = Math.max(2, w * 0.005);

  return (
    <div>
      <div className="photo-wrap">
        <video ref={videoRef} src={src} controls playsInline preload="metadata" style={{ width: "100%", display: "block", borderRadius: 10, background: "#000" }} />
        {mostrar && f && !lejos && (
          <svg className="helbing" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
            {HUESOS.map(([a, b], k) => {
              const pa = P(a), pb = P(b);
              if (pa.v < 0.4 || pb.v < 0.4) return null;
              return <line key={k} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="rgba(55,199,143,.85)" strokeWidth={sw} strokeLinecap="round" />;
            })}
            {IDX.map((_, i) => {
              const q = P(i);
              if (q.v < 0.4) return null;
              return <circle key={i} cx={q.x} cy={q.y} r={sw * 1.6} fill="#fff" stroke="rgba(55,199,143,.9)" strokeWidth={sw * 0.6} />;
            })}
          </svg>
        )}
      </div>
      <label className="chk" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={mostrar} onChange={(e) => setMostrar(e.target.checked)} /> Mostrar puntos de referencia
      </label>
      <InformeMarcha informe={informe} />
    </div>
  );
}

const f1 = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-ES", { maximumFractionDigits: 1 })}°`);
const COLOR: Record<string, string> = { info: "n", leve: "a", revisar: "r" };

export function InformeMarcha({ informe: m }: { informe: MarchaInforme }) {
  return (
    <div className="note" style={{ marginTop: 8, background: "#f4f2ec", color: "var(--ink)" }}>
      <b>Informe preliminar de marcha ({m.vista === "posterior" ? "vista posterior" : "vista anterior"})</b>
      <span className="tiny"> · orientativo, calculado en 2D con los puntos de pose · {m.framesTotales} fotogramas, apoyo izq. {m.apoyoIzq} / dcho. {m.apoyoDcho}</span>
      <table style={{ marginTop: 6, fontSize: 12.5 }}>
        <thead>
          <tr><th>Métrica</th><th>Izquierda</th><th>Derecha</th></tr>
        </thead>
        <tbody>
          <tr><td>Caída pélvica en apoyo (Trendelenburg)</td><td>{f1(m.caidaPelvica.izq)}</td><td>{f1(m.caidaPelvica.dcha)}</td></tr>
          <tr><td>Rodilla en plano frontal (+ valgo / − varo)</td><td>{f1(m.rodillaFrontal.izq)}</td><td>{f1(m.rodillaFrontal.dcha)}</td></tr>
          {m.vista === "posterior" && (
            <tr><td>Retropié en apoyo (+ eversión / − inversión)</td><td>{f1(m.retropie.izq)}</td><td>{f1(m.retropie.dcha)}</td></tr>
          )}
          {m.vista === "anterior" && (
            <tr><td>Ángulo de progresión del pie (+ toe-out / − toe-in)</td><td>{f1(m.progresion.izq)}</td><td>{f1(m.progresion.dcha)}</td></tr>
          )}
          <tr><td>Base de marcha (tobillos / anchura de caderas)</td><td colSpan={2}>{m.anchuraPaso === null ? "—" : `${m.anchuraPaso.toLocaleString("es-ES", { maximumFractionDigits: 2 })}×`}</td></tr>
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        {m.hallazgos.map((hz) => (
          <div key={hz.clave} style={{ marginBottom: 8 }}>
            <span className={`pill ${COLOR[hz.gravedad]}`}>{hz.gravedad === "revisar" ? "revisar" : hz.gravedad === "leve" ? "posible" : "nota"}</span>{" "}
            <b>{hz.titulo}</b>
            <div className="tiny" style={{ marginTop: 2 }}>{hz.detalle}</div>
            <div style={{ marginTop: 2, fontSize: 12.5 }}>
              <b>Plantilla:</b> {hz.plantilla}
            </div>
          </div>
        ))}
      </div>
      {m.plantilla.length > 0 && (
        <div className="note g" style={{ marginTop: 8 }}>
          <b>Qué hacer en la plantilla (propuesta orientativa a partir de este vídeo)</b>
          <ul style={{ margin: "6px 0 0 18px" }}>
            {m.plantilla.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="tiny" style={{ marginTop: 6 }}>
        Los ángulos se miden sobre la imagen (2D) y dependen de la perspectiva y de la detección: sirven para orientar la exploración, no son un diagnóstico.
      </div>
    </div>
  );
}
