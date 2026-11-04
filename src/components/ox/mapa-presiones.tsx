// El motivo de la marca, dibujado en código: la salida real del estudio.
// - modo "mapa": mapa de presiones de los dos pies sobre campo oscuro, con
//   retícula de sensores, zonas de carga (rampa cian→verde) y microdatos.
// - modo "malla": el molde digital del escáner 3D (un pie en retícula).
// Es un gráfico plano en la paleta; decorativo para lectores de pantalla
// (la figura que lo envuelve lleva el texto).

// Silueta plantar (vista desde abajo), pie derecho; el izquierdo se refleja.
const PIE =
  "M83 18 C118 2 160 10 178 44 C193 73 196 112 192 152 C189 186 196 216 199 252 " +
  "C203 296 197 344 178 376 C160 406 118 416 92 398 C66 380 56 338 58 294 " +
  "C60 252 70 224 66 186 C62 146 54 98 60 64 C64 40 68 25 83 18 Z";

function Zona({ cx, cy, r, c1, c2 }: { cx: number; cy: number; r: number; c1: string; c2: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={c1} opacity="0.55" />
      <circle cx={cx} cy={cy} r={r * 0.66} fill={c2} opacity="0.6" />
      <circle cx={cx} cy={cy} r={r * 0.34} fill={c2} />
      <circle cx={cx} cy={cy} r={r + 12} fill="none" stroke={c1} strokeWidth="2" opacity="0.5" />
      <circle cx={cx} cy={cy} r={r + 26} fill="none" stroke={c1} strokeWidth="1.5" opacity="0.25" />
    </g>
  );
}

function Pie({ x, espejo = false, hijos }: { x: number; espejo?: boolean; hijos: React.ReactNode }) {
  return (
    <g transform={`translate(${x},0) ${espejo ? "scale(-1,1) translate(-260,0)" : ""}`}>
      <clipPath id={`pie-${x}`}>
        <path d={PIE} />
      </clipPath>
      <path d={PIE} fill="#0f3647" stroke="#2b6477" strokeWidth="2" />
      <g clipPath={`url(#pie-${x})`}>
        <rect x="0" y="0" width="260" height="430" fill="url(#retic)" />
        {hijos}
      </g>
      <path d={PIE} fill="none" stroke="#5ea9bd" strokeWidth="1.6" opacity="0.8" />
    </g>
  );
}

export function MapaPresiones({ modo = "mapa" }: { modo?: "mapa" | "malla" }) {
  if (modo === "malla") {
    // Molde digital: un pie sobre retícula de puntos con isolíneas.
    return (
      <svg viewBox="0 0 420 560" role="img" aria-hidden="true" style={{ display: "block", width: "100%", height: "100%" }}>
        <rect width="420" height="560" fill="#113c4c" />
        <defs>
          <pattern id="retic" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="3" r="1.7" fill="#7fc2d4" opacity="0.5" />
          </pattern>
        </defs>
        <g transform="translate(80,60) scale(1.3)">
          <Pie
            x={0}
            hijos={
              <>
                {[150, 120, 92, 66, 44].map((r, i) => (
                  <ellipse key={r} cx="128" cy="210" rx={r * 0.62} ry={r} fill="none" stroke="#8fd8c9" strokeWidth={i === 4 ? 2 : 1.3} opacity={0.25 + i * 0.13} />
                ))}
              </>
            }
          />
        </g>
        <text x="80" y="528" fill="#b9dde8" fontSize="15" fontFamily="var(--font-inter)">
          Molde digital · escaneo 3D
        </text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 800 1100" role="img" aria-hidden="true" style={{ display: "block", width: "100%", height: "100%" }} preserveAspectRatio="xMidYMid meet">
      <rect width="800" height="1100" fill="#0e3140" />
      <defs>
        <pattern id="retic" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.7" fill="#7fc2d4" opacity="0.45" />
        </pattern>
      </defs>
      {/* retícula de fondo, tenue */}
      <rect width="800" height="1100" fill="url(#retic)" opacity="0.25" />
      <g transform="translate(90,130) scale(1.15)">
        {/* Pie izquierdo (espejo): carga alta en talón y 1er metatarsiano */}
        <Pie
          x={0}
          espejo
          hijos={
            <>
              <Zona cx={120} cy={330} r={52} c1="#0e7490" c2="#34d399" />
              <Zona cx={85} cy={95} r={40} c1="#0e7490" c2="#34d399" />
              <Zona cx={160} cy={110} r={24} c1="#155e75" c2="#0e7490" />
            </>
          }
        />
        {/* Pie derecho: reparto más suave */}
        <Pie
          x={320}
          hijos={
            <>
              <Zona cx={125} cy={335} r={44} c1="#155e75" c2="#0e7490" />
              <Zona cx={90} cy={100} r={30} c1="#155e75" c2="#0e7490" />
            </>
          }
        />
      </g>
      {/* microdatos del estudio */}
      <g fontFamily="var(--font-inter)" fontSize="17" fill="#b9dde8">
        <text x="92" y="86">Izquierdo</text>
        <text x="460" y="86" >Derecho</text>
        <text x="92" y="1012">Presión pico · talón izq.</text>
        <text x="92" y="1038" fill="#8fd8c9" fontWeight="600">318 kPa</text>
        <text x="460" y="1012">Reparto talón–antepié</text>
        <text x="460" y="1038" fill="#8fd8c9" fontWeight="600">62 / 38</text>
      </g>
      <line x1="92" y1="975" x2="708" y2="975" stroke="#2b6477" strokeWidth="2" opacity="0.6" />
    </svg>
  );
}
