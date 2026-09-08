// Medidas del retropié sobre la foto posterior de los pies, con los puntos de
// MediaPipe Pose del momento de la foto:
//  - Línea de Helbing: eje del tendón de Aquiles (centro de la pantorrilla →
//    talón) y su ángulo con la vertical.
//  - Regla de Perthes: eje del calcáneo (tobillo → apoyo del talón) respecto a
//    la perpendicular al suelo, que es lo que se lee con la regla transparente
//    de abanico apoyada en el suelo detrás del talón.
// Inclinación del extremo distal hacia fuera (lateral) = retropié valgo; hacia
// dentro = varo. Son ORIENTATIVAS: sirven para que taller y prescriptor las vean
// de un vistazo; la valoración clínica es del profesional.

export type HelbingLado = "valgo" | "varo" | "neutro";

export type HelbingLeg = {
  deg: number; // magnitud del ángulo con la vertical, en grados (1 decimal)
  lado: HelbingLado;
  from: [number, number]; // punto proximal (pantorrilla), en píxeles de la foto
  to: [number, number]; // punto distal (talón), en píxeles de la foto
  aprox: boolean; // la rodilla no estaba en plano: el eje de la pierna es estimado
};

export type Helbing = {
  w: number; // tamaño de la foto sobre la que van las coordenadas
  h: number;
  dcha?: HelbingLeg;
  izq?: HelbingLeg;
};

type Punto = { x: number; y: number; visibility?: number };

// Índices de MediaPipe Pose (izquierda/derecha DEL PACIENTE)
const PIERNAS = {
  izq: { rodilla: 25, tobillo: 27, talon: 29 },
  dcha: { rodilla: 26, tobillo: 28, talon: 30 },
} as const;

const NEUTRO_MAX_DEG = 1; // por debajo se considera alineado

type Medida = "helbing" | "perthes";

// Referencia "vertical": la perpendicular a la línea del suelo (la que une los
// dos talones apoyados), igual que la base de la regla de Perthes apoyada en el
// suelo. Corrige la inclinación de la cámara. Si solo se ve un talón, vertical
// de la imagen. Devuelve el ángulo (grados, sentido horario) que hay que restar.
function inclinacionSuelo(lms: Punto[], w: number, h: number): number {
  const vis = (i: number) => lms[i]?.visibility ?? 0;
  if (vis(PIERNAS.izq.talon) < 0.5 || vis(PIERNAS.dcha.talon) < 0.5) return 0;
  const a = lms[PIERNAS.izq.talon];
  const b = lms[PIERNAS.dcha.talon];
  const dx = (b.x - a.x) * w;
  const dy = (b.y - a.y) * h;
  if (Math.abs(dx) < 1) return 0;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return Math.abs(deg) > 15 ? 0 : deg; // más de 15° no es el suelo: se ignora
}

function pierna(
  lms: Punto[],
  w: number,
  h: number,
  key: "izq" | "dcha",
  medida: Medida,
  suelo: number
): HelbingLeg | undefined {
  const { rodilla, tobillo, talon } = PIERNAS[key];
  const vis = (i: number) => lms[i]?.visibility ?? 0;
  if (vis(tobillo) < 0.5 || vis(talon) < 0.5) return undefined;
  const k = lms[rodilla];
  const a = lms[tobillo];
  const t = lms[talon];
  // Helbing: eje del tendón de Aquiles, del centro de la pantorrilla (40 % del
  // recorrido rodilla → tobillo) al talón. Perthes: eje del calcáneo, del
  // tobillo al apoyo del talón (lo que se lee con la regla apoyada en el suelo).
  const from: [number, number] =
    medida === "helbing"
      ? [(k.x + (a.x - k.x) * 0.4) * w, (k.y + (a.y - k.y) * 0.4) * h]
      : [a.x * w, a.y * h];
  const to: [number, number] = [t.x * w, t.y * h];
  // Ángulo con la vertical, en píxeles (evita la deformación del aspecto),
  // corregido por la inclinación del suelo; positivo = el talón cae a la
  // derecha de la imagen respecto al punto proximal.
  const tilt = (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI - suelo;
  const deg = Math.round(Math.abs(tilt) * 10) / 10;
  // Foto desde atrás: la pierna derecha del paciente queda a la derecha de la
  // imagen, así que "hacia fuera" (lateral) es hacia la derecha para la pierna
  // derecha y hacia la izquierda para la izquierda.
  const haciaFuera = key === "dcha" ? tilt > 0 : tilt < 0;
  const lado: HelbingLado = deg < NEUTRO_MAX_DEG ? "neutro" : haciaFuera ? "valgo" : "varo";
  return { deg, lado, from, to, aprox: medida === "helbing" && vis(rodilla) < 0.5 };
}

function medir(lms: Punto[] | null | undefined, w: number, h: number, medida: Medida): Helbing | null {
  if (!lms || lms.length < 33 || !w || !h) return null;
  const suelo = inclinacionSuelo(lms, w, h);
  const dcha = pierna(lms, w, h, "dcha", medida, suelo);
  const izq = pierna(lms, w, h, "izq", medida, suelo);
  if (!dcha && !izq) return null;
  return { w, h, dcha, izq };
}

// Línea de Helbing (tendón de Aquiles) por pierna.
export function computeHelbing(lms: Punto[] | null | undefined, w: number, h: number): Helbing | null {
  return medir(lms, w, h, "helbing");
}

// Ángulo del retropié con la regla de Perthes (eje del calcáneo respecto a la
// perpendicular al suelo) por pierna. Misma estructura de datos que Helbing.
export function computePerthes(lms: Punto[] | null | undefined, w: number, h: number): Helbing | null {
  return medir(lms, w, h, "perthes");
}

export function helbingResumen(hb: Helbing | null | undefined): string {
  if (!hb) return "";
  const f = (p: HelbingLeg | undefined, n: string) =>
    p ? `${n} ${p.deg.toLocaleString("es-ES")}° ${p.lado}${p.aprox ? " (aprox.)" : ""}` : null;
  return [f(hb.dcha, "dcha."), f(hb.izq, "izq.")].filter(Boolean).join(" · ");
}

// Saneado de lo que llega del navegador antes de guardarlo en la base de datos.
export function sanitizeHelbing(raw: unknown): Helbing | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const w = num(r.w);
  const h = num(r.h);
  if (!w || !h || w <= 0 || h <= 0) return undefined;
  const leg = (v: unknown): HelbingLeg | undefined => {
    if (!v || typeof v !== "object") return undefined;
    const l = v as Record<string, unknown>;
    const deg = num(l.deg);
    const lado = l.lado;
    const pt = (p: unknown): [number, number] | null =>
      Array.isArray(p) && p.length === 2 && num(p[0]) !== null && num(p[1]) !== null
        ? [p[0] as number, p[1] as number]
        : null;
    const from = pt(l.from);
    const to = pt(l.to);
    if (deg === null || !from || !to || (lado !== "valgo" && lado !== "varo" && lado !== "neutro"))
      return undefined;
    return { deg, lado, from, to, aprox: l.aprox === true };
  };
  const dcha = leg(r.dcha);
  const izq = leg(r.izq);
  if (!dcha && !izq) return undefined;
  return { w, h, dcha, izq };
}
