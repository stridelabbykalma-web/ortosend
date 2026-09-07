// Línea de Helbing sobre la foto posterior de los pies: eje del tendón de
// Aquiles (del centro de la pantorrilla al talón) y su ángulo con la vertical.
// Inclinación del extremo distal hacia fuera (lateral) = retropié valgo; hacia
// dentro = varo. Se calcula con los puntos de MediaPipe Pose en el momento de
// la foto. Es ORIENTATIVO: sirve para que taller y prescriptor lo vean de un
// vistazo; la valoración clínica es del profesional.

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

const NEUTRO_MAX_DEG = 1; // por debajo se considera vertical

function pierna(lms: Punto[], w: number, h: number, key: "izq" | "dcha"): HelbingLeg | undefined {
  const { rodilla, tobillo, talon } = PIERNAS[key];
  const vis = (i: number) => lms[i]?.visibility ?? 0;
  if (vis(tobillo) < 0.5 || vis(talon) < 0.5) return undefined;
  const k = lms[rodilla];
  const a = lms[tobillo];
  const t = lms[talon];
  // Centro de la pantorrilla: a un 40 % del recorrido rodilla → tobillo
  const from: [number, number] = [(k.x + (a.x - k.x) * 0.4) * w, (k.y + (a.y - k.y) * 0.4) * h];
  const to: [number, number] = [t.x * w, t.y * h];
  // Ángulo con la vertical, en píxeles (evita la deformación del aspecto);
  // positivo = el talón cae a la derecha de la imagen respecto a la pantorrilla.
  const tilt = (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI;
  const deg = Math.round(Math.abs(tilt) * 10) / 10;
  // Foto desde atrás: la pierna derecha del paciente queda a la derecha de la
  // imagen, así que "hacia fuera" (lateral) es hacia la derecha para la pierna
  // derecha y hacia la izquierda para la izquierda.
  const haciaFuera = key === "dcha" ? tilt > 0 : tilt < 0;
  const lado: HelbingLado = deg < NEUTRO_MAX_DEG ? "neutro" : haciaFuera ? "valgo" : "varo";
  return { deg, lado, from, to, aprox: vis(rodilla) < 0.5 };
}

export function computeHelbing(lms: Punto[] | null | undefined, w: number, h: number): Helbing | null {
  if (!lms || lms.length < 33 || !w || !h) return null;
  const dcha = pierna(lms, w, h, "dcha");
  const izq = pierna(lms, w, h, "izq");
  if (!dcha && !izq) return null;
  return { w, h, dcha, izq };
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
