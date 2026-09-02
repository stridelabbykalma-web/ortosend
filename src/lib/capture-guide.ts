// Guía del estudio de captura web (MediaPipe Pose): qué se exige a cada
// elemento del protocolo antes de permitir grabar/fotografiar y cuánto dura.
// Los checks se evalúan en vivo sobre los landmarks de PoseLandmarker.

export type CheckId =
  | "persona" // hay una persona detectada con confianza suficiente
  | "cuerpo_completo" // de cabeza a pies dentro del encuadre, con margen
  | "perfil" // se le ve de lado (hombros alineados con la cámara)
  | "lado_dcho" // de perfil con el lado derecho del paciente hacia la cámara
  | "lado_izq" // de perfil con el lado izquierdo del paciente hacia la cámara
  | "frente_espalda" // orientación frontal o posterior (hombros abiertos)
  | "pies_visibles"; // tobillos/talones/antepié visibles

export const CHECK_LABEL: Record<CheckId, string> = {
  persona: "Persona detectada",
  cuerpo_completo: "Cuerpo completo en el encuadre",
  perfil: "Se le ve de lado (perfil)",
  lado_dcho: "Lado derecho hacia la cámara",
  lado_izq: "Lado izquierdo hacia la cámara",
  frente_espalda: "Orientación frontal/posterior correcta",
  pies_visibles: "Pies visibles",
};

// Cuenta atrás previa a toda grabación de vídeo (el profesional suelta el móvil
// en el trípode y el paciente arranca la marcha).
export const VIDEO_PREROLL_SECONDS = 3;

export type CaptureGuide = {
  mode: "video" | "photo";
  checks: CheckId[]; // deben estar en verde para poder grabar
  // Duración asignada a la prueba. Vídeo: la grabación dura exactamente esto y
  // se corta sola. Foto: temporizador de cuenta atrás hasta el disparo automático.
  seconds: number;
  direction?: "ltr" | "rtl"; // sentido en que el paciente cruza el encuadre (flecha guía)
  tips: string[]; // instrucciones de encuadre para el profesional
};

// Marcha lateral: el paciente camina recto hacia delante y la cámara está a un
// lado del pasillo, perpendicular al recorrido. Con el lado derecho hacia la
// cámara el paciente cruza el encuadre de izquierda a derecha; con el izquierdo,
// de derecha a izquierda.
const LATERAL_TIPS = (lado: "derecho" | "izquierdo", calzado: string, seg: number) => [
  `Móvil en trípode, en horizontal, a la altura de la cadera, a un lado del pasillo (3-4 m) y perpendicular al recorrido.`,
  `El paciente camina recto hacia delante, ${calzado}, con su lado ${lado} hacia la cámara: cruza el encuadre ${
    lado === "derecho" ? "de izquierda a derecha" : "de derecha a izquierda"
  }.`,
  "Antes de grabar, que se coloque de perfil en el punto de salida: el estudio comprueba que sea el lado correcto.",
  `Grabación fija de ${seg} s: si sale del plano, vuelve al punto de salida por fuera del encuadre y repite el paso.`,
];

// Marcha posterior: cámara detrás del paciente, en el eje del pasillo.
const POSTERIOR_TIPS = (calzado: string, seg: number) => [
  "Móvil en trípode, en horizontal, a la altura de la cadera, detrás del paciente y en el eje del pasillo.",
  `El paciente camina recto alejándose de la cámara, ${calzado}, 4-6 m; da la vuelta y regresa.`,
  `Grabación fija de ${seg} s: al menos 3 pasos completos alejándose (retropié visible).`,
];

export const CAPTURE_GUIDES: Record<string, CaptureGuide> = {
  video_lat_dcha_descalzo: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "perfil", "lado_dcho"],
    seconds: 8,
    direction: "ltr",
    tips: LATERAL_TIPS("derecho", "descalzo", 8),
  },
  video_lat_dcha_calzado: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "perfil", "lado_dcho"],
    seconds: 8,
    direction: "ltr",
    tips: LATERAL_TIPS("derecho", "con su calzado habitual", 8),
  },
  video_lat_izq_descalzo: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "perfil", "lado_izq"],
    seconds: 8,
    direction: "rtl",
    tips: LATERAL_TIPS("izquierdo", "descalzo", 8),
  },
  video_lat_izq_calzado: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "perfil", "lado_izq"],
    seconds: 8,
    direction: "rtl",
    tips: LATERAL_TIPS("izquierdo", "con su calzado habitual", 8),
  },
  video_post_descalzo: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "frente_espalda"],
    seconds: 10,
    tips: POSTERIOR_TIPS("descalzo", 10),
  },
  video_post_calzado: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "frente_espalda"],
    seconds: 10,
    tips: POSTERIOR_TIPS("con su calzado habitual", 10),
  },
  foto_dorsal: {
    mode: "photo",
    checks: [],
    seconds: 5,
    tips: [
      "Paciente de pie, en carga, pies paralelos al ancho de caderas.",
      "Foto cenital desde arriba: ambos pies completos y centrados.",
      "Temporizador de 5 s: coloca el móvil encima y mantenlo quieto hasta el disparo.",
    ],
  },
  foto_posterior: {
    mode: "photo",
    checks: [],
    seconds: 5,
    tips: [
      "Cámara baja, desde atrás, a la altura de los tobillos.",
      "Talones y tercio inferior de la pierna, en carga.",
      "Temporizador de 5 s: apoya el móvil y mantenlo quieto hasta el disparo.",
    ],
  },
  foto_calzado: {
    mode: "photo",
    checks: [],
    seconds: 3,
    tips: [
      "Suela del calzado habitual hacia la cámara, buena luz.",
      "Que se aprecie el patrón de desgaste de ambas suelas.",
      "Temporizador de 3 s hasta el disparo.",
    ],
  },
};

// Texto corto de la duración asignada, para la checklist del asistente.
export function durationLabel(kind: string): string {
  const g = CAPTURE_GUIDES[kind];
  if (!g) return "";
  return g.mode === "video" ? `${g.seconds} s de grabación` : `disparo a los ${g.seconds} s`;
}
