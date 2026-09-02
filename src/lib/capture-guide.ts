// Guía del estudio de captura web (MediaPipe Pose): qué se exige a cada
// elemento del protocolo antes de permitir grabar/fotografiar y cuánto dura.
// Los checks se evalúan en vivo sobre los landmarks de PoseLandmarker.

export type CheckId =
  | "persona" // hay una persona detectada con confianza suficiente
  | "cuerpo_completo" // de cabeza a pies dentro del encuadre, con margen
  | "perfil" // orientación lateral (hombros alineados con la cámara)
  | "frente_espalda" // orientación frontal o posterior (hombros abiertos)
  | "pies_visibles"; // tobillos/talones/antepié visibles

export const CHECK_LABEL: Record<CheckId, string> = {
  persona: "Persona detectada",
  cuerpo_completo: "Cuerpo completo en el encuadre",
  perfil: "Orientación de perfil correcta",
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
  tips: string[]; // instrucciones de encuadre para el profesional
};

const MARCHA_TIPS = (vista: string, seg: number) => [
  `Móvil en trípode, en horizontal, a la altura de la cadera — ${vista}.`,
  "Pasillo de 4-6 m: el paciente camina a ritmo natural, ida y vuelta.",
  `Grabación fija de ${seg} s tras la cuenta atrás: al menos 3 pasos completos dentro del encuadre.`,
];

export const CAPTURE_GUIDES: Record<string, CaptureGuide> = {
  video_lat_dcha_descalzo: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "perfil"],
    seconds: 8,
    tips: MARCHA_TIPS("vista lateral derecha, descalzo", 8),
  },
  video_lat_dcha_calzado: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "perfil"],
    seconds: 8,
    tips: MARCHA_TIPS("vista lateral derecha, con su calzado habitual", 8),
  },
  video_lat_izq_descalzo: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "perfil"],
    seconds: 8,
    tips: MARCHA_TIPS("vista lateral izquierda, descalzo", 8),
  },
  video_lat_izq_calzado: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "perfil"],
    seconds: 8,
    tips: MARCHA_TIPS("vista lateral izquierda, con su calzado habitual", 8),
  },
  video_post_descalzo: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "frente_espalda"],
    seconds: 10,
    tips: MARCHA_TIPS("desde atrás, descalzo (retropié visible al alejarse y volver)", 10),
  },
  video_post_calzado: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "frente_espalda"],
    seconds: 10,
    tips: MARCHA_TIPS("desde atrás, con su calzado habitual", 10),
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
