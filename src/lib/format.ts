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

// Vídeos obligatorios del protocolo de captura (6 de marcha + heel rise)
export const VIDEO_KINDS = [
  ["video_lat_dcha_descalzo", "Marcha lateral dcha. — descalzo"],
  ["video_lat_dcha_calzado", "Marcha lateral dcha. — calzado"],
  ["video_lat_izq_descalzo", "Marcha lateral izq. — descalzo"],
  ["video_lat_izq_calzado", "Marcha lateral izq. — calzado"],
  ["video_post_descalzo", "Marcha posterior — descalzo"],
  ["video_post_calzado", "Marcha posterior — calzado"],
  ["video_heel_rise", "Heel rise test — descalzo"],
] as const;

// Fotos clínicas de apoyo (opcionales — no bloquean la checklist)
export const PHOTO_KINDS = [
  ["foto_dorsal", "Vista dorsal — ambos pies en carga"],
  ["foto_posterior", "Retropié posterior — en carga"],
  ["foto_calzado", "Calzado habitual — desgaste de la suela"],
] as const;

export const BARO_KINDS = [
  ["baro_est_1", "Estática — captura 1 (10 s)"],
  ["baro_est_2", "Estática — captura 2 (10 s)"],
  ["baro_din", "Dinámica — 3 pasos válidos"],
  ["baro_informe", "Informe del dashboard Podisense"],
] as const;

// Etiqueta legible de cualquier elemento de captura (para expediente y visor)
export const MEDIA_LABEL: Record<string, string> = Object.fromEntries([
  ["scan_L", "Escaneo 3D — pie izquierdo"],
  ["scan_R", "Escaneo 3D — pie derecho"],
  ...VIDEO_KINDS,
  ...PHOTO_KINDS,
  ...BARO_KINDS,
]);
