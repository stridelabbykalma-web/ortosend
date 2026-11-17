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
  manual?: boolean; // puntos marcados a mano por el profesional sobre la foto
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

// Eje entre dos puntos (píxeles) y su lectura clínica. `suelo` es la
// inclinación de la línea del suelo que se descuenta.
function eje(from: [number, number], to: [number, number], key: "izq" | "dcha", suelo: number): Omit<HelbingLeg, "aprox"> {
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
  return { deg, lado, from, to };
}

// Credibilidad de los puntos de pose de una pierna en una foto de pies de
// cerca. El modelo de pose es de cuerpo entero y, cuando solo ve pies y
// piernas, a veces "colapsa" todos los puntos en una línea vertical con
// visibilidades bajas: con eso no se puede trazar nada. Se exige que el talón
// quede por debajo del tobillo a una distancia razonable, la rodilla (si se
// ve) por encima, y el eje tobillo → talón cerca de la vertical.
function piernaCreible(lms: Punto[], w: number, h: number, key: "izq" | "dcha"): boolean {
  const { rodilla, tobillo, talon } = PIERNAS[key];
  const vis = (i: number) => lms[i]?.visibility ?? 0;
  if (vis(tobillo) < 0.5 || vis(talon) < 0.5) return false;
  const a = lms[tobillo];
  const t = lms[talon];
  const dy = (t.y - a.y) * h; // talón por debajo del tobillo
  const dx = Math.abs(t.x - a.x) * w;
  if (dy < h * 0.01 || dy > h * 0.3) return false;
  if (dx > dy * 0.7) return false; // eje del calcáneo a más de ~35° de la vertical: no es un talón apoyado
  if (vis(rodilla) >= 0.5 && lms[rodilla].y >= a.y) return false; // rodilla "por debajo" del tobillo
  return true;
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
  if (!piernaCreible(lms, w, h, key)) return undefined;
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
  return { ...eje(from, to, key, suelo), aprox: medida === "helbing" && vis(rodilla) < 0.5 };
}

function medir(lms: Punto[] | null | undefined, w: number, h: number, medida: Medida): Helbing | null {
  if (!lms || lms.length < 33 || !w || !h) return null;
  const suelo = inclinacionSuelo(lms, w, h);
  let dcha = pierna(lms, w, h, "dcha", medida, suelo);
  let izq = pierna(lms, w, h, "izq", medida, suelo);
  // Dos talones casi en el mismo punto = puntos colapsados: no vale ninguno
  if (dcha && izq && Math.hypot(dcha.to[0] - izq.to[0], dcha.to[1] - izq.to[1]) < w * 0.04) {
    dcha = undefined;
    izq = undefined;
  }
  if (!dcha && !izq) return null;
  return { w, h, dcha, izq };
}

// Marcas hechas a mano por el profesional sobre la foto (coordenadas
// normalizadas 0-1): centro de la pantorrilla, tobillo (parte alta del talón,
// inserción del Aquiles) y apoyo del talón, por pierna. Es la vía de respaldo
// cuando los puntos de pose no son creíbles, y siempre da las dos medidas.
export type MarcaPierna = { pantorrilla: [number, number]; tobillo: [number, number]; talon: [number, number] };
export type MarcasManuales = { dcha?: MarcaPierna; izq?: MarcaPierna };

export function computeManual(m: MarcasManuales, w: number, h: number): { helbing: Helbing | null; perthes: Helbing | null } {
  if (!w || !h || (!m.dcha && !m.izq)) return { helbing: null, perthes: null };
  const px = (p: [number, number]): [number, number] => [p[0] * w, p[1] * h];
  // Suelo: la línea que une los dos apoyos del talón, como con la pose
  let suelo = 0;
  if (m.dcha && m.izq) {
    const a = px(m.izq.talon);
    const b = px(m.dcha.talon);
    const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    if (Math.abs(b[0] - a[0]) >= 1 && Math.abs(deg) <= 15) suelo = deg;
  }
  const leg = (key: "izq" | "dcha", medida: Medida): HelbingLeg | undefined => {
    const p = m[key];
    if (!p) return undefined;
    const from = px(medida === "helbing" ? p.pantorrilla : p.tobillo);
    const to = px(p.talon);
    if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 2) return undefined;
    return { ...eje(from, to, key, suelo), aprox: false, manual: true };
  };
  const mk = (medida: Medida): Helbing | null => {
    const dcha = leg("dcha", medida);
    const izq = leg("izq", medida);
    return dcha || izq ? { w, h, dcha, izq } : null;
  };
  return { helbing: mk("helbing"), perthes: mk("perthes") };
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
    p ? `${n} ${p.deg.toLocaleString("es-ES")}° ${p.lado}${p.aprox ? " (aprox.)" : ""}${p.manual ? " (a mano)" : ""}` : null;
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
    return { deg, lado, from, to, aprox: l.aprox === true, ...(l.manual === true ? { manual: true } : {}) };
  };
  const dcha = leg(r.dcha);
  const izq = leg(r.izq);
  if (!dcha && !izq) return undefined;
  return { w, h, dcha, izq };
}
