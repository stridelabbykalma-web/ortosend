// Guía del estudio de captura web (MediaPipe Pose): qué se exige a cada
// elemento del protocolo antes de permitir grabar/fotografiar.
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

export type CaptureGuide = {
  mode: "video" | "photo";
  checks: CheckId[]; // deben estar en verde para poder grabar
  maxSeconds?: number; // corte automático de la grabación
  minSeconds?: number; // aviso si el clip queda más corto
  tips: string[]; // instrucciones de encuadre para el profesional
};

const MARCHA_TIPS = (vista: string) => [
  `Móvil en trípode, en horizontal, a la altura de la cadera — ${vista}.`,
  "Pasillo de 4-6 m: el paciente camina a ritmo natural, ida y vuelta.",
  "Grabación de ~8 s: al menos 3 pasos completos dentro del encuadre.",
];

export const CAPTURE_GUIDES: Record<string, CaptureGuide> = {
  video_lat_dcha_descalzo: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "perfil"],
    maxSeconds: 10,
    minSeconds: 4,
    tips: MARCHA_TIPS("vista lateral derecha, descalzo"),
  },
  video_lat_dcha_calzado: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "perfil"],
    maxSeconds: 10,
    minSeconds: 4,
    tips: MARCHA_TIPS("vista lateral derecha, con su calzado habitual"),
  },
  video_lat_izq_descalzo: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "perfil"],
    maxSeconds: 10,
    minSeconds: 4,
    tips: MARCHA_TIPS("vista lateral izquierda, descalzo"),
  },
  video_lat_izq_calzado: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "perfil"],
    maxSeconds: 10,
    minSeconds: 4,
    tips: MARCHA_TIPS("vista lateral izquierda, con su calzado habitual"),
  },
  video_post_descalzo: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "frente_espalda"],
    maxSeconds: 10,
    minSeconds: 4,
    tips: MARCHA_TIPS("desde atrás, descalzo (retropié visible)"),
  },
  video_post_calzado: {
    mode: "video",
    checks: ["persona", "cuerpo_completo", "frente_espalda"],
    maxSeconds: 10,
    minSeconds: 4,
    tips: MARCHA_TIPS("desde atrás, con su calzado habitual"),
  },
  video_heel_rise: {
    mode: "video",
    checks: ["persona", "pies_visibles", "frente_espalda"],
    maxSeconds: 15,
    minSeconds: 5,
    tips: [
      "Cámara baja, desde atrás: retropié y pantorrillas centrados.",
      "El paciente sube y baja de puntillas 5-10 veces, descalzo.",
      "Apoyo de un dedo en la pared solo para el equilibrio.",
    ],
  },
  foto_dorsal: {
    mode: "photo",
    checks: [],
    tips: [
      "Paciente de pie, en carga, pies paralelos al ancho de caderas.",
      "Foto cenital desde arriba: ambos pies completos y centrados.",
    ],
  },
  foto_posterior: {
    mode: "photo",
    checks: [],
    tips: [
      "Cámara baja, desde atrás, a la altura de los tobillos.",
      "Talones y tercio inferior de la pierna, en carga.",
    ],
  },
  foto_calzado: {
    mode: "photo",
    checks: [],
    tips: [
      "Suela del calzado habitual hacia la cámara, buena luz.",
      "Que se aprecie el patrón de desgaste de ambas suelas.",
    ],
  },
};
