// Utilidades sobre casos: eventos, notificaciones simuladas, reparto y liberación.
import { prisma } from "./db";
import { OPEN_CASE_TIMEOUT_MIN } from "./states";
import { BARO_KINDS, CAPTURA_VISUAL, SCAN_KIND } from "./format";
import { PUENTE_VIVO_MIN, newScanCode } from "./scan";

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

// Código de la carpeta del escáner para un caso. Se crea la primera vez que
// alguien lo necesita (asistente de captura o puente) y ya no cambia: es lo
// que asocia el archivo que guarda RevoScan con este paciente.
export async function ensureScanCode(caseId: string): Promise<string> {
  const kase = await prisma.case.findUnique({ where: { id: caseId }, select: { scanCode: true } });
  if (kase?.scanCode) return kase.scanCode;
  for (let i = 0; i < 5; i++) {
    const code = newScanCode();
    try {
      const updated = await prisma.case.update({ where: { id: caseId }, data: { scanCode: code } });
      return updated.scanCode!;
    } catch {
      // Colisión del índice único (improbable): se reintenta con otro código.
      const again = await prisma.case.findUnique({ where: { id: caseId }, select: { scanCode: true } });
      if (again?.scanCode) return again.scanCode;
    }
  }
  throw new Error("No se pudo generar el código de escaneo");
}

// ¿Hay algún puente de escaneo dando señal en esta clínica?
export async function puenteActivo(clinicId: string): Promise<boolean> {
  const desde = new Date(Date.now() - PUENTE_VIVO_MIN * 60 * 1000);
  const n = await prisma.scanAgent.count({
    where: { clinicId, revokedAt: null, lastSeenAt: { gt: desde } },
  });
  return n > 0;
}
