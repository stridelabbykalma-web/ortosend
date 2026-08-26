// Máquina de estados del caso: transiciones permitidas y quién puede ejecutarlas.
// Reglas duras: sin prescripción no hay pago; sin pago no se fabrica.
import { CaseState, Role } from "@prisma/client";

type T = { to: CaseState; roles: Role[]; guard?: string };

export const TRANSITIONS: Record<CaseState, T[]> = {
  CITA_RESERVADA: [
    { to: "ESTUDIO_EN_CURSO", roles: ["PROFESIONAL", "ADMIN_CLINICA"] },
  ],
  ESTUDIO_EN_CURSO: [
    { to: "ESTUDIO_COMPLETO", roles: ["PROFESIONAL", "ADMIN_CLINICA"], guard: "checklistCompleta" },
  ],
  ESTUDIO_COMPLETO: [
    { to: "EN_PRESCRIPCION", roles: ["PROFESIONAL", "ADMIN_CLINICA"] }, // automático al enviar
  ],
  EN_PRESCRIPCION: [
    { to: "PENDIENTE_PAGO", roles: ["PROFESIONAL", "RECETADOR"], guard: "esPrescriptorVerificado" },
    { to: "EN_CONTACTO", roles: ["PROFESIONAL", "RECETADOR"] },
    { to: "DEVUELTO_CLINICA", roles: ["PROFESIONAL", "RECETADOR"] },
    { to: "NO_PRESCRITO", roles: ["PROFESIONAL", "RECETADOR"] },
  ],
  EN_CONTACTO: [
    { to: "PENDIENTE_PAGO", roles: ["PROFESIONAL", "RECETADOR"], guard: "esPrescriptorVerificado" },
    { to: "DEVUELTO_CLINICA", roles: ["PROFESIONAL", "RECETADOR"] },
    { to: "NO_PRESCRITO", roles: ["PROFESIONAL", "RECETADOR"] },
  ],
  PENDIENTE_PAGO: [
    { to: "ENTRADA_TALLER", roles: ["CLIENTE"], guard: "pagoConfirmado" }, // webhook Stripe
    { to: "NO_CONVERTIDO", roles: ["ADMIN"] }, // caducidad 30 días (job)
  ],
  NO_CONVERTIDO: [
    { to: "PENDIENTE_PAGO", roles: ["ADMIN"], guard: "reactivacionHasta6Meses" },
  ],
  ENTRADA_TALLER: [
    { to: "DISENO", roles: ["TALLER"], guard: "aceptacionTecnica" },
    { to: "DEVUELTO_CLINICA", roles: ["TALLER"] }, // incidencia de captura, sin coste
  ],
  DISENO: [{ to: "FABRICACION", roles: ["TALLER"], guard: "cadAdjunto" }],
  FABRICACION: [{ to: "CALIDAD", roles: ["TALLER"] }], // mecanizado CNC → confección (fabPhase)
  CALIDAD: [
    { to: "ENVIADO", roles: ["TALLER"], guard: "fotoParAdjunta" },
    { to: "FABRICACION", roles: ["TALLER"] }, // no pasa QC → rehacer (incidencia)
  ],
  ENVIADO: [{ to: "ENTREGADO", roles: ["TALLER", "ADMIN"] }], // webhook transportista
  ENTREGADO: [{ to: "CERRADO", roles: ["ADMIN"] }], // tras seguimiento d20; programa revisión anual
  CERRADO: [],
  DEVUELTO_CLINICA: [
    { to: "EN_PRESCRIPCION", roles: ["PROFESIONAL", "ADMIN_CLINICA"] }, // prueba repetida
  ],
  NO_PRESCRITO: [],
};

export function canTransition(from: CaseState, to: CaseState, role: Role) {
  return (TRANSITIONS[from] || []).some(t => t.to === to && t.roles.includes(role));
}

// Liberación de casos (reparto automático): al cerrar sesión o 45 min de inactividad
export const OPEN_CASE_TIMEOUT_MIN = 45;
export const PAY_LINK_DAYS = 30;
export const PAY_REMINDERS_DAYS = [3, 7, 15];
export const SOFT_EXPIRY_MONTHS = 6;
export const DELIVERY_PROMISE = "5 días laborables desde el pago";
