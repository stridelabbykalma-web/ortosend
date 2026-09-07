// Capa SVG con la línea de Helbing sobre la foto posterior. Sin hooks: sirve
// tanto en el estudio de captura (cliente) como en el expediente (servidor).
// Se coloca en un contenedor `position: relative` que envuelva exactamente la
// imagen, con el mismo viewBox que el tamaño de la foto.
import type { Helbing, HelbingLeg } from "@/lib/helbing";

const COLOR: Record<HelbingLeg["lado"], string> = {
  valgo: "#f0a848",
  varo: "#6ab0ff",
  neutro: "#37c78f",
};

function Pierna({ p, w, label }: { p: HelbingLeg; w: number; label: string }) {
  const sw = Math.max(2, w * 0.006);
  const fs = Math.max(11, w * 0.032);
  const [fx, fy] = p.from;
  const [tx, ty] = p.to;
  // Prolongar la línea un poco más allá del talón para que se lea el eje
  const len = Math.hypot(tx - fx, ty - fy) || 1;
  const ex = tx + ((tx - fx) / len) * w * 0.03;
  const ey = ty + ((ty - fy) / len) * w * 0.03;
  const col = COLOR[p.lado];
  const textX = Math.min(Math.max(tx + w * 0.02, fs), w - fs * 4);
  return (
    <g>
      {/* referencia vertical por el talón */}
      <line x1={tx} y1={fy} x2={tx} y2={ey} stroke="rgba(255,255,255,.75)" strokeWidth={sw * 0.6} strokeDasharray={`${sw * 3} ${sw * 2}`} />
      {/* línea de Helbing */}
      <line x1={fx} y1={fy} x2={ex} y2={ey} stroke={col} strokeWidth={sw} strokeLinecap="round" />
      <circle cx={fx} cy={fy} r={sw * 1.4} fill={col} />
      <circle cx={tx} cy={ty} r={sw * 1.4} fill={col} />
      <text x={textX} y={fy + (ty - fy) * 0.5} fill="#fff" fontSize={fs} fontWeight={700} stroke="rgba(0,0,0,.7)" strokeWidth={fs * 0.18} paintOrder="stroke" fontFamily="system-ui, sans-serif">
        {label} {p.deg.toLocaleString("es-ES")}° {p.lado}
        {p.aprox ? " ≈" : ""}
      </text>
    </g>
  );
}

export function HelbingOverlay({ hb }: { hb: Helbing }) {
  return (
    <svg className="helbing" viewBox={`0 0 ${hb.w} ${hb.h}`} preserveAspectRatio="none" aria-hidden>
      {hb.izq && <Pierna p={hb.izq} w={hb.w} label="Izq." />}
      {hb.dcha && <Pierna p={hb.dcha} w={hb.w} label="Dcha." />}
    </svg>
  );
}
