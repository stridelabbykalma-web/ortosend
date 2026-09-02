import type { CaseState } from "@prisma/client";

export const STATE_LABEL: Record<CaseState, string> = {
  CITA_RESERVADA: "Cita reservada",
  ESTUDIO_EN_CURSO: "Estudio en curso",
  ESTUDIO_COMPLETO: "Estudio completo",
  EN_PRESCRIPCION: "En prescripción",
  EN_CONTACTO: "En valoración (contacto)",
  PENDIENTE_PAGO: "Pendiente de pago",
  ENTRADA_TALLER: "Entrada taller",
  DISENO: "Diseño",
  FABRICACION: "Fabricación",
  CALIDAD: "Control de calidad",
  ENVIADO: "Enviado",
  ENTREGADO: "Entregado",
  CERRADO: "Cerrado",
  DEVUELTO_CLINICA: "Devuelto a clínica",
  NO_PRESCRITO: "No prescrito",
  NO_CONVERTIDO: "No convertido",
};

// Color de la etiqueta de estado (clases .pill del CSS global)
export const STATE_COLOR: Record<CaseState, string> = {
  CITA_RESERVADA: "b",
  ESTUDIO_EN_CURSO: "a",
  ESTUDIO_COMPLETO: "b",
  EN_PRESCRIPCION: "a",
  EN_CONTACTO: "a",
  PENDIENTE_PAGO: "a",
  ENTRADA_TALLER: "n",
  DISENO: "b",
  FABRICACION: "b",
  CALIDAD: "a",
  ENVIADO: "g",
  ENTREGADO: "g",
  CERRADO: "g",
  DEVUELTO_CLINICA: "r",
  NO_PRESCRITO: "r",
  NO_CONVERTIDO: "r",
};

export const PRICE_CENTS = 19999;
export const PRICE_LABEL = "199,99 €";

export function fmtd(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}
export function fmtdt(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function fmtEUR(cents: number) {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

// Vídeos obligatorios del protocolo: 8 de marcha. El paciente camina recto;
// la cámara va a su lado (laterales, un vídeo por lado), detrás (posterior,
// se aleja) o delante (anterior, viene hacia ella); cada vista descalzo y
// con su calzado. Duraciones y checks de encuadre en src/lib/capture-guide.ts.
export const VIDEO_KINDS = [
  ["video_lat_dcha_descalzo", "Marcha lateral dcha. — descalzo"],
  ["video_lat_dcha_calzado", "Marcha lateral dcha. — calzado"],
  ["video_lat_izq_descalzo", "Marcha lateral izq. — descalzo"],
  ["video_lat_izq_calzado", "Marcha lateral izq. — calzado"],
  ["video_post_descalzo", "Marcha posterior (alejándose) — descalzo"],
  ["video_post_calzado", "Marcha posterior (alejándose) — calzado"],
  ["video_ant_descalzo", "Marcha anterior (viniendo hacia la cámara) — descalzo"],
  ["video_ant_calzado", "Marcha anterior (viniendo hacia la cámara) — calzado"],
] as const;

// Fotos obligatorias: los pies de cerca, en carga, desde atrás (retropié) y
// desde delante (antepié). Con temporizador y disparo automático.
export const FOTO_KINDS = [
  ["foto_posterior", "Pies de cerca desde atrás (retropié) — en carga"],
  ["foto_anterior", "Pies de cerca desde delante (antepié) — en carga"],
] as const;

// Todo lo que se captura con la cámara de la app, en el orden del protocolo.
export const CAPTURA_VISUAL = [...VIDEO_KINDS, ...FOTO_KINDS] as const;

// Baropodometría con Podisense: estática + dinámica múltiple. El informe lo
// genera y entrega la propia plataforma, la clínica no lo adjunta.
export const BARO_KINDS = [
  ["baro_est", "Estática (10 s)"],
  ["baro_din_multi", "Dinámica múltiple"],
] as const;

// Escaneo de las espumas fenólicas: una sola pieza (ambos pies), hecha en la
// plataforma del escáner; aquí solo se marca si está hecha.
export const SCAN_KIND = "scan_espumas";

// Etiqueta legible de cualquier elemento de captura (expediente, visor, historial)
export const MEDIA_LABEL: Record<string, string> = Object.fromEntries([
  ...CAPTURA_VISUAL,
  ...BARO_KINDS,
  [SCAN_KIND, "Escaneo de las espumas fenólicas"],
]);
