// Utilidades sobre casos: eventos, notificaciones simuladas, reparto y liberación.
import { prisma } from "./db";
import { OPEN_CASE_TIMEOUT_MIN } from "./states";
import { BARO_KINDS, CAPTURA_VISUAL, SCAN_KIND } from "./format";

export async function pushEvent(caseId: string, text: string, actor: string) {
  await prisma.caseEvent.create({ data: { caseId, text, actor } });
}

// Canal WhatsApp (simulado): encola el aviso — solo texto + enlace, nunca contenido clínico.
export async function notify(toPhone: string, template: string, payload: Record<string, unknown> = {}) {
  await prisma.notification.create({ data: { toPhone, template, payload: payload as object } });
}

export async function audit(userId: string, action: string, target: string) {
  await prisma.auditLog.create({ data: { userId, action, target } });
}

// Libera casos abiertos por un usuario (al cerrar sesión).
export async function releaseAllBy(userId: string) {
  await prisma.case.updateMany({ where: { openBy: userId }, data: { openBy: null, openAt: null } });
}

// Liberación perezosa por inactividad (45 min): se ejecuta antes de leer colas.
export async function releaseStale() {
  const cutoff = new Date(Date.now() - OPEN_CASE_TIMEOUT_MIN * 60 * 1000);
  await prisma.case.updateMany({
    where: { openBy: { not: null }, openAt: { lt: cutoff } },
    data: { openBy: null, openAt: null },
  });
}

// Checklist bloqueante del estudio: todo en verde o no hay envío.
export type Checklist = {
  cuestionario: boolean;
  exploracion: boolean;
  escaneos: boolean; // escaneo de las espumas fenólicas
  capturas: number; // vídeos + fotos confirmados, de CAPTURA_VISUAL.length
  baro: boolean;
  completa: boolean;
};

export function checklistOf(capture: {
  questionnaire: unknown;
  physicalExam: unknown;
  media: { kind: string; confirmedAt: Date | null }[];
} | null): Checklist {
  const media = capture?.media.filter((m) => m.confirmedAt) ?? [];
  const has = (k: string) => media.some((m) => m.kind === k);
  const capturas = CAPTURA_VISUAL.filter(([k]) => has(k)).length;
  // El modo guiado guarda por secciones con done:false hasta terminar el bloque;
  // los datos antiguos (sin done) cuentan como completos.
  const blockDone = (x: unknown) => !!x && (x as { done?: boolean }).done !== false;
  const cuestionario = blockDone(capture?.questionnaire);
  const exploracion = blockDone(capture?.physicalExam);
  const escaneos = has(SCAN_KIND);
  const baro = BARO_KINDS.every(([k]) => has(k));
  return {
    cuestionario,
    exploracion,
    escaneos,
    capturas,
    baro,
    completa:
      cuestionario && exploracion && escaneos && capturas >= CAPTURA_VISUAL.length && baro,
  };
}
