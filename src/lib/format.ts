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

// Vídeos obligatorios del protocolo de captura: marcha desde atrás, de frente,
// de lado y un plano general del caminar (cuerpo entero, cámara alejada).
export const VIDEO_KINDS = [
  ["video_posterior", "Marcha desde atrás (posterior)"],
  ["video_anterior", "Marcha de frente (anterior)"],
  ["video_lateral", "Marcha de lado (lateral)"],
  ["video_general", "Marcha — plano general"],
] as const;

// Baropodometría con Podisense: estática + dinámica múltiple + informe.
export const BARO_KINDS = [
  ["baro_est", "Estática (10 s)"],
  ["baro_din_multi", "Dinámica múltiple"],
  ["baro_informe", "Informe del dashboard Podisense"],
] as const;
