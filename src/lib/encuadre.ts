// Validación automática del encuadre por visión: qué tiene que verse en cada
// captura y cómo se comprueba sobre los 33 puntos del cuerpo que detecta el
// modelo de pose en el navegador (MediaPipe Pose Landmarker).
//
// Las reglas son datos, no código: cada captura tiene su lista y cada regla
// se pinta como una línea de la checklist que se pone en verde sola. Para
// cambiar lo que debe salir en un vídeo basta con tocar REGLAS.
//
// Todo es puro (sin DOM) para poder probarlo con puntos sintéticos.

import type { OverlayKind } from "@/components/caso/camara-guiada";

export type Punto = { x: number; y: number; z?: number; visibility?: number };

// Índices de MediaPipe Pose. Los nombres son del paciente («izquierdo» es su
// izquierda), no de la imagen.
export const LM = {
  nariz: 0,
  hombroIzq: 11,
  hombroDcho: 12,
  caderaIzq: 23,
  caderaDcha: 24,
  rodillaIzq: 25,
  rodillaDcha: 26,
  tobilloIzq: 27,
  tobilloDcho: 28,
  talonIzq: 29,
  talonDcho: 30,
  puntaIzq: 31,
  puntaDcha: 32,
} as const;

const HOMBROS = [LM.hombroIzq, LM.hombroDcho];
const CADERAS = [LM.caderaIzq, LM.caderaDcha];
const RODILLAS = [LM.rodillaIzq, LM.rodillaDcha];
const TOBILLOS = [LM.tobilloIzq, LM.tobilloDcho];
const PIES = [LM.tobilloIzq, LM.tobilloDcho, LM.talonIzq, LM.talonDcho, LM.puntaIzq, LM.puntaDcha];

export type Regla =
  // Estos puntos se ven (confianza suficiente y dentro del cuadro)
  | { t: "visibles"; puntos: number[]; label: string }
  // Estos puntos NO están en el cuadro (p. ej. caderas fuera en la foto de talones)
  | { t: "fuera"; puntos: number[]; label: string }
  // Hacia dónde mira el paciente, por la posición relativa de los hombros
  | { t: "orientacion"; hacia: "camara" | "espaldas" | "perfil"; label: string }
  // Los pies vistos desde atrás: las puntas quedan más arriba en la imagen que los talones
  | { t: "pies_espaldas"; label: string }
  // Altura del cuerpo (hombros → tobillos) respecto al alto del cuadro
  | { t: "tamano"; min: number; label: string }
  // Franja vertical del cuadro en la que deben estar unos puntos (0 arriba, 1 abajo)
  | { t: "franja"; puntos: number[]; yMin: number; yMax: number; label: string }
  // Centrado horizontal del cuerpo, con un margen a cada lado
  | { t: "centrado"; margen: number; label: string }
  // Quieto: los tobillos apenas se mueven durante la ventana de observación
  | { t: "quieto"; label: string };

// Con la cámara al ras del suelo detrás del paciente el modelo pierde la
// cara y los hombros, así que la foto de talones se valida con las piernas.
export const REGLAS: Record<OverlayKind, Regla[]> = {
  pie_post: [
    { t: "visibles", puntos: [...HOMBROS, ...CADERAS], label: "Se ve el cuerpo entero" },
    { t: "visibles", puntos: PIES, label: "Se ven los dos pies, con talones y puntas" },
    { t: "orientacion", hacia: "espaldas", label: "El paciente está de espaldas" },
    { t: "tamano", min: 0.5, label: "Está lo bastante cerca (llena al menos media pantalla)" },
    { t: "centrado", margen: 0.12, label: "Está centrado en el encuadre" },
    { t: "quieto", label: "Está quieto" },
  ],
  pie_ant: [
    { t: "visibles", puntos: [LM.nariz, ...HOMBROS, ...CADERAS], label: "Se ve el cuerpo entero, cara incluida" },
    { t: "visibles", puntos: PIES, label: "Se ven los dos pies, con talones y puntas" },
    { t: "orientacion", hacia: "camara", label: "El paciente está de frente" },
    { t: "tamano", min: 0.5, label: "Está lo bastante cerca (llena al menos media pantalla)" },
    { t: "centrado", margen: 0.12, label: "Está centrado en el encuadre" },
    { t: "quieto", label: "Está quieto" },
  ],
  marcha_post: [
    { t: "visibles", puntos: [...HOMBROS, ...CADERAS], label: "Se ve el cuerpo entero" },
    { t: "visibles", puntos: PIES, label: "Se ven los dos pies" },
    { t: "orientacion", hacia: "espaldas", label: "El paciente está de espaldas, listo para alejarse" },
    { t: "tamano", min: 0.45, label: "Empieza cerca de la cámara (al menos media pantalla)" },
    { t: "centrado", margen: 0.15, label: "Está centrado en el pasillo" },
  ],
  marcha_ant: [
    { t: "visibles", puntos: [...HOMBROS, ...CADERAS], label: "Se ve el cuerpo entero" },
    { t: "visibles", puntos: PIES, label: "Se ven los dos pies" },
    { t: "orientacion", hacia: "camara", label: "El paciente está de frente, al fondo del pasillo" },
    { t: "tamano", min: 0.25, label: "Se le ve entero aunque esté lejos" },
    { t: "centrado", margen: 0.15, label: "Está centrado en el pasillo" },
  ],
  marcha_lat: [
    { t: "visibles", puntos: [...HOMBROS, ...CADERAS], label: "Se ve el cuerpo entero" },
    { t: "visibles", puntos: TOBILLOS, label: "Se ven los pies" },
    { t: "orientacion", hacia: "perfil", label: "El paciente está de perfil" },
    { t: "tamano", min: 0.45, label: "Está lo bastante cerca (al menos media pantalla)" },
    { t: "centrado", margen: 0.2, label: "Está centrado en el encuadre" },
  ],
  retropie: [
    { t: "visibles", puntos: [...RODILLAS, ...TOBILLOS, LM.talonIzq, LM.talonDcho], label: "Se ven las dos rodillas y los dos talones" },
    { t: "fuera", puntos: HOMBROS, label: "Solo de rodilla para abajo: no salen los hombros" },
    { t: "pies_espaldas", label: "Los pies se ven desde atrás" },
    { t: "franja", puntos: RODILLAS, yMin: 0, yMax: 0.5, label: "Las rodillas quedan en la mitad de arriba" },
    { t: "franja", puntos: [LM.talonIzq, LM.talonDcho], yMin: 0.55, yMax: 0.97, label: "Los talones quedan abajo, sin cortar" },
    { t: "centrado", margen: 0.15, label: "Los dos pies centrados" },
    { t: "quieto", label: "Está quieto, en apoyo relajado" },
  ],
};

export type Resultado = { label: string; ok: boolean };

const VIS_MIN = 0.55;

const visible = (p: Punto | undefined) =>
  !!p && (p.visibility ?? 1) >= VIS_MIN && p.x >= 0.01 && p.x <= 0.99 && p.y >= 0.01 && p.y <= 0.99;

const fuera = (p: Punto | undefined) =>
  !p || (p.visibility ?? 0) < 0.35 || p.y < 0 || p.y > 1 || p.x < 0 || p.x > 1;

const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

// Historial reciente de posiciones de los tobillos (ya normalizadas 0..1),
// para saber si el paciente está quieto. Lo mantiene quien llama.
export type Historial = { x: number; y: number }[];

export function evaluarEncuadre(
  kind: OverlayKind,
  lm: Punto[] | null,
  historial: Historial
): { checks: Resultado[]; ok: boolean; detectado: boolean } {
  const reglas = REGLAS[kind];
  if (!lm || lm.length < 33)
    return { checks: reglas.map((r) => ({ label: r.label, ok: false })), ok: false, detectado: false };

  const p = (i: number) => lm[i];
  const hombroY = media(HOMBROS.map((i) => p(i).y));
  const tobilloY = media(TOBILLOS.map((i) => p(i).y));
  const altura = Math.abs(tobilloY - hombroY);
  const hombroDx = p(LM.hombroIzq).x - p(LM.hombroDcho).x; // >0 de espaldas, <0 de frente
  const anchoHombros = Math.abs(hombroDx);

  const checks = reglas.map((r): Resultado => {
    switch (r.t) {
      case "visibles":
        return { label: r.label, ok: r.puntos.every((i) => visible(p(i))) };
      case "fuera":
        return { label: r.label, ok: r.puntos.every((i) => fuera(p(i))) };
      case "orientacion": {
        if (!HOMBROS.every((i) => visible(p(i)))) return { label: r.label, ok: false };
        // De perfil los hombros se solapan: su separación horizontal es pequeña
        // respecto a la altura del cuerpo.
        const perfil = altura > 0 && anchoHombros < altura * 0.16;
        const ok =
          r.hacia === "perfil" ? perfil : r.hacia === "espaldas" ? !perfil && hombroDx > 0 : !perfil && hombroDx < 0;
        return { label: r.label, ok };
      }
      case "pies_espaldas": {
        const pares: [number, number][] = [
          [LM.puntaIzq, LM.talonIzq],
          [LM.puntaDcha, LM.talonDcho],
        ];
        const ok = pares.every(([punta, talon]) => visible(p(talon)) && p(punta).y < p(talon).y + 0.01);
        return { label: r.label, ok };
      }
      case "tamano":
        return { label: r.label, ok: altura >= r.min };
      case "franja":
        return { label: r.label, ok: r.puntos.every((i) => visible(p(i)) && p(i).y >= r.yMin && p(i).y <= r.yMax) };
      case "centrado": {
        const xs = [...HOMBROS, ...CADERAS, ...TOBILLOS].map((i) => p(i)).filter(visible).map((q) => q.x);
        if (!xs.length) return { label: r.label, ok: false };
        const c = media(xs);
        return { label: r.label, ok: c >= 0.5 - r.margen - 0.15 && c <= 0.5 + r.margen + 0.15 && Math.min(...xs) > 0.03 && Math.max(...xs) < 0.97 };
      }
      case "quieto": {
        if (historial.length < 8) return { label: r.label, ok: false };
        const rango = (sel: (h: { x: number; y: number }) => number) =>
          Math.max(...historial.map(sel)) - Math.min(...historial.map(sel));
        return { label: r.label, ok: rango((h) => h.x) < 0.03 && rango((h) => h.y) < 0.03 };
      }
    }
  });

  return { checks, ok: checks.every((c) => c.ok), detectado: true };
}

// Posición media de los tobillos, para alimentar el historial de quietud.
export function centroTobillos(lm: Punto[]): { x: number; y: number } {
  return {
    x: media(TOBILLOS.map((i) => lm[i].x)),
    y: media(TOBILLOS.map((i) => lm[i].y)),
  };
}

// Pares de puntos que se dibujan como esqueleto sobre la imagen.
export const HUESOS: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [29, 31],
  [27, 31],
  [28, 30],
  [30, 32],
  [28, 32],
];

// Cuántos fotogramas seguidos en verde hacen falta para habilitar la captura
// (≈ 1 s a 20 fps): evita disparar en un instante de suerte.
export const FOTOGRAMAS_ESTABLES = 20;
