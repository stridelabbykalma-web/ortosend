import type { PatientStatus } from "@prisma/client";

// Cómo se muestra cada estado del alta en el panel (pill de color).
export const ESTADO_PACIENTE: Record<PatientStatus, { texto: string; color: "a" | "g" | "r" }> = {
  PENDIENTE: { texto: "Pendiente", color: "a" },
  ACEPTADO: { texto: "Aceptado", color: "g" },
  CADUCADO: { texto: "Caducado", color: "r" },
  RECHAZADO: { texto: "No aceptó", color: "r" },
  ERROR_ENVIO: { texto: "Error de envío", color: "r" },
  REVOCADO: { texto: "Consentimiento retirado", color: "r" },
};
