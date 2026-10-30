// Post-its del taller (los mismos colores que en Ortosend Taller): rojo fuera de plazo, amarillo justo,
// verde en plazo; «REHACER» primero.
import Link from "next/link";

export type PedidoResumen = {
  id: string;
  numero: number;
  paciente: string;
  clinica: string;
  estado: string;
  fase: string | null;
  lote: string | null;
  plazo: { nivel: "ok" | "ajustado" | "fuera"; texto: string } | null;
  rehacer: boolean;
};

export const COLUMNAS_TALLER: [string, string, (p: PedidoResumen) => boolean][] = [
  ["confeccion", "En confección", (p) => p.estado === "FABRICACION" && p.fase === "CONFECCION"],
  ["fresar", "Por fresar", (p) => p.estado === "FABRICACION" && p.fase === "MECANIZADO"],
  ["diseno", "Por diseñar", (p) => p.estado === "ENTRADA_TALLER" || p.estado === "DISENO"],
  ["calidad", "Calidad", (p) => p.estado === "CALIDAD"],
];

const PAPEL = { fuera: ["#ffc9c9", "#e03131"], ajustado: ["#ffec99", "#f59f00"], ok: ["#d3f9d8", "#2f9e44"] } as const;

export function PostIt({ p }: { p: PedidoResumen }) {
  const [papel, borde] = p.rehacer ? PAPEL.fuera : p.plazo ? PAPEL[p.plazo.nivel] : ["#e9ecef", "#adb5bd"];
  return (
    <Link
      href={`/taller/${p.id}`}
      style={{
        display: "block",
        background: papel,
        borderLeft: `7px solid ${borde}`,
        borderRadius: 4,
        padding: "10px 12px",
        color: "#212529",
        textDecoration: "none",
        boxShadow: "2px 3px 8px rgba(0,0,0,.18)",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700 }}>
        #{p.numero}
        {p.rehacer && <span style={{ fontSize: 13, color: "#c92a2a" }}> ⚠ REHACER</span>}
      </div>
      <div style={{ fontWeight: 600 }}>{p.paciente}</div>
      <div style={{ fontSize: 13 }}>
        {p.plazo?.texto ?? "sin pago"}
        {p.lote ? ` · lote ${p.lote}` : ""}
      </div>
      <div style={{ fontSize: 12, color: "#495057" }}>{p.clinica}</div>
    </Link>
  );
}
