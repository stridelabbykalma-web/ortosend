// Guía del estudio de captura web (MediaPipe Pose): qué se exige a cada
// elemento del protocolo antes de permitir grabar/fotografiar y cuánto dura.
// Los checks se evalúan en vivo sobre los landmarks de PoseLandmarker.

export type CheckId =
  | "persona" // hay una persona detectada con confianza suficiente
  | "cintura_a_pies" // caderas, rodillas y pies dentro del encuadre (la cabeza puede quedar fuera)
  | "perfil" // se le ve de lado (hombros alineados con la cámara)
  | "lado_dcho" // de perfil con el lado derecho del paciente hacia la cámara
  | "lado_izq" // de perfil con el lado izquierdo del paciente hacia la cámara
  | "de_frente" // hombros abiertos y mirando a la cámara (viene hacia ella)
  | "de_espaldas" // hombros abiertos y de espaldas a la cámara (se aleja)
  | "pies_visibles"; // tobillos/talones/antepié visibles

export const CHECK_LABEL: Record<CheckId, string> = {
  persona: "Persona detectada",
  cintura_a_pies: "De la cintura a los pies en el encuadre",
  perfil: "Se le ve de lado (perfil)",
  lado_dcho: "Lado derecho hacia la cámara",
  lado_izq: "Lado izquierdo hacia la cámara",
  de_frente: "De frente a la cámara",
  de_espaldas: "De espaldas a la cámara",
  pies_visibles: "Pies visibles",
};

// Cuenta atrás previa a toda grabación de vídeo (el profesional suelta el móvil
// en el trípode y el paciente arranca la marcha).
export const VIDEO_PREROLL_SECONDS = 3;

export type CaptureGuide = {
  mode: "video" | "photo";
  // Deben estar en verde para ARRANCAR la grabación. Durante el clip no se exige
  // nada: el paciente se mueve y el modelo no acierta todos los frames.
  checks: CheckId[];
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
  "El paciente espera QUIETO en el punto de salida y echa a andar al oír el pitido (suena medio segundo después de empezar a grabar, para que quede la salida desde parado). Un tono grave avisa del final.",
  "Debe verse de la cintura a los pies (la cabeza puede quedar fuera); los pies no pueden salir cortados por abajo.",
  "Piernas descubiertas de la rodilla para abajo (pantalón corto o remangado por encima de la rodilla): hay que ver la pierna y la reacción del cuerpo al andar. Lo comprueba el profesional; la app no lo valida.",
  `Móvil en trípode, en horizontal, a la altura de la cadera, a un lado del pasillo (3-4 m) y perpendicular al recorrido.`,
  `El paciente camina recto hacia delante, ${calzado}, con su lado ${lado} hacia la cámara: cruza el encuadre ${
    lado === "derecho" ? "de izquierda a derecha" : "de derecha a izquierda"
  }.`,
  "Antes de grabar, que se coloque de perfil en el punto de salida: el estudio comprueba que sea el lado correcto.",
  `Grabación fija de ${seg} s: si sale del plano, vuelve al punto de salida por fuera del encuadre y repite el paso.`,
];

// Marcha posterior: cámara detrás del paciente, en el eje del pasillo; se aleja.
const POSTERIOR_TIPS = (calzado: string, seg: number) => [
  "El paciente espera QUIETO en el punto de salida y echa a andar al oír el pitido (suena medio segundo después de empezar a grabar, para que quede la salida desde parado). Un tono grave avisa del final.",
  "Basta con que se vea de la cintura a los pies: al principio, cerca de la cámara, la cabeza puede quedar fuera; al alejarse ya sale entero.",
  "Piernas descubiertas de la rodilla para abajo (pantalón corto o remangado por encima de la rodilla): hay que ver la pierna y la reacción del cuerpo al andar. Lo comprueba el profesional; la app no lo valida.",
  "Móvil en trípode, en horizontal, a la altura de la cadera, en el eje del pasillo.",
  `El paciente parte junto a la cámara, de espaldas a ella, y camina recto alejándose 4-6 m, ${calzado}.`,
  "Antes de grabar, que se coloque de espaldas en el punto de salida: el estudio comprueba la orientación.",
  `Grabación fija de ${seg} s: al menos 3 pasos completos alejándose (retropié visible). Si sobra tiempo, vuelve al punto de salida por fuera del plano y repite.`,
];

// Marcha anterior: misma posición de cámara; el paciente viene hacia ella.
const ANTERIOR_TIPS = (calzado: string, seg: number) => [
  "El paciente espera QUIETO en el punto de salida y echa a andar al oír el pitido (suena medio segundo después de empezar a grabar, para que quede la salida desde parado). Un tono grave avisa del final.",
  "Basta con que se vea de la cintura a los pies: al acercarse a la cámara la cabeza puede quedar fuera; lo importante es la pierna y la reacción del cuerpo.",
  "Piernas descubiertas de la rodilla para abajo (pantalón corto o remangado por encima de la rodilla): hay que ver la pierna y la reacción del cuerpo al andar. Lo comprueba el profesional; la app no lo valida.",
  "Móvil en trípode, en horizontal, a la altura de la cadera, en el eje del pasillo.",
  `El paciente parte a 4-6 m, de frente a la cámara, y camina recto hacia ella, ${calzado}; se detiene justo antes de salir del plano.`,
  "Antes de grabar, que se coloque de frente en el punto de salida: el estudio comprueba la orientación.",
  `Grabación fija de ${seg} s: al menos 3 pasos completos viniendo hacia la cámara. Si sobra tiempo, vuelve al punto de salida por fuera del plano y repite.`,
];

export const CAPTURE_GUIDES: Record<string, CaptureGuide> = {
  video_lat_dcha_descalzo: {
    mode: "video",
    checks: ["persona", "cintura_a_pies", "perfil", "lado_dcho"],
    seconds: 8,
    direction: "ltr",
    tips: LATERAL_TIPS("derecho", "descalzo", 8),
  },
  video_lat_izq_descalzo: {
    mode: "video",
    checks: ["persona", "cintura_a_pies", "perfil", "lado_izq"],
    seconds: 8,
    direction: "rtl",
    tips: LATERAL_TIPS("izquierdo", "descalzo", 8),
  },
  video_post_descalzo: {
    mode: "video",
    checks: ["persona", "cintura_a_pies", "de_espaldas"],
    seconds: 10,
    tips: POSTERIOR_TIPS("descalzo", 10),
  },
  // Mismas reglas que la posterior (persona, de la cintura a los pies, 10 s),
  // solo cambia la orientación: de frente en vez de espaldas.
  video_ant_descalzo: {
    mode: "video",
    checks: ["persona", "cintura_a_pies", "de_frente"],
    seconds: 10,
    tips: ANTERIOR_TIPS("descalzo", 10),
  },
  foto_posterior: {
    mode: "photo",
    checks: [],
    seconds: 5,
    tips: [
      "Paciente de pie, en carga, descalzo, pies paralelos al ancho de caderas.",
      "Móvil bajo, a la altura de los tobillos, a 40-60 cm por detrás: talones y tercio inferior de la pierna llenando el encuadre.",
      "Temporizador de 5 s: apoya el móvil y mantenlo quieto hasta el disparo.",
    ],
  },
  foto_anterior: {
    mode: "photo",
    checks: [],
    seconds: 5,
    tips: [
      "Paciente de pie, en carga, descalzo, pies paralelos al ancho de caderas.",
      "Móvil bajo, a la altura de los tobillos, a 40-60 cm por delante: dedos, antepié y tobillos llenando el encuadre.",
      "Temporizador de 5 s: apoya el móvil y mantenlo quieto hasta el disparo.",
    ],
  },
};

// Texto corto de la duración asignada, para la checklist del asistente.
export function durationLabel(kind: string): string {
  const g = CAPTURE_GUIDES[kind];
  if (!g) return "";
  return g.mode === "video" ? `${g.seconds} s de grabación` : `disparo a los ${g.seconds} s`;
}
