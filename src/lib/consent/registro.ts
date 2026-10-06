// Registro de consentimientos (consent_log). Solo se inserta: la base de datos
// rechaza cualquier UPDATE o DELETE y encadena cada fila con la anterior.
import type { ConsentAction, ConsentType, LegalText, Prisma, PrismaClient } from "@prisma/client";
import { ORDEN, OBLIGATORIOS } from "./tipos";

type Db = PrismaClient | Prisma.TransactionClient;

// Versión vigente de cada texto: la de mayor versión ya en vigor.
export async function textosVigentes(db: Db, at = new Date()): Promise<Record<ConsentType, LegalText>> {
  const rows = await db.legalText.findMany({ where: { validFrom: { lte: at } }, orderBy: { version: "desc" } });
  const out = {} as Record<ConsentType, LegalText>;
  for (const r of rows) if (!out[r.type]) out[r.type] = r;
  for (const t of ORDEN) if (!out[t]) throw new Error(`Falta el texto legal ${t} en legal_texts`);
  return out;
}

// Publica una versión nueva de un texto (nunca se edita la anterior).
export async function publicarTexto(db: Db, type: ConsentType, title: string, content: string, validFrom = new Date()) {
  const last = await db.legalText.findFirst({ where: { type }, orderBy: { version: "desc" } });
  return db.legalText.create({ data: { type, version: (last?.version ?? 0) + 1, title, content, validFrom } });
}

export type NuevoRegistro = {
  patientId: string;
  professionalId: string | null;
  type: ConsentType;
  action: ConsentAction;
  legalTextId: string;
  actor: "paciente" | "tutor" | "profesional";
  actorUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  channel: "whatsapp" | "web_gestion" | "web_perfil" | "panel";
  invitationId?: string | null;
  externalRef?: string | null;
};

export function registrar(db: Db, r: NuevoRegistro) {
  return db.consentLog.create({
    data: {
      patientId: r.patientId,
      professionalId: r.professionalId,
      type: r.type,
      action: r.action,
      legalTextId: r.legalTextId,
      actor: r.actor,
      actorUserId: r.actorUserId ?? null,
      ip: r.ip ?? null,
      userAgent: r.userAgent?.slice(0, 500) ?? null,
      channel: r.channel,
      invitationId: r.invitationId ?? null,
      externalRef: r.externalRef ?? null,
    },
  });
}

// Última decisión por tipo (lo que está en vigor ahora).
export type EstadoConsentimiento = { action: ConsentAction; at: Date; legalTextId: string; channel: string; actor: string };

export async function estadoActual(db: Db, patientId: string): Promise<Partial<Record<ConsentType, EstadoConsentimiento>>> {
  const rows = await db.consentLog.findMany({ where: { patientId }, orderBy: { seq: "asc" } });
  const out: Partial<Record<ConsentType, EstadoConsentimiento>> = {};
  for (const r of rows)
    out[r.type] = { action: r.action, at: r.timestampUtc, legalTextId: r.legalTextId, channel: r.channel, actor: r.actor };
  return out;
}

export const obligatoriosEnVigor = (e: Partial<Record<ConsentType, EstadoConsentimiento>>) =>
  OBLIGATORIOS.every((t) => e[t]?.action === "ACEPTADO");
