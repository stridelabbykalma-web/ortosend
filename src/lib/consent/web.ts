// Consentimientos aceptados por el propio paciente (o su tutor) al registrarse en la web:
// las mismas 5 casillas y el mismo consent_log que en el alta por WhatsApp.
import type { ConsentType, Prisma, PrismaClient } from "@prisma/client";
import { ORDEN, OBLIGATORIOS } from "./tipos";
import { registrar, textosVigentes } from "./registro";

type Db = PrismaClient | Prisma.TransactionClient;

export const CAMPO_CONSENT: Record<ConsentType, string> = {
  PRIVACIDAD: "c_privacidad",
  DATOS_SALUD: "c_salud",
  TRATAMIENTO: "c_tratamiento",
  CONDICIONES: "c_condiciones",
  MARKETING: "c_marketing",
};

export function leerConsentimientos(f: FormData): Record<ConsentType, boolean> {
  const out = {} as Record<ConsentType, boolean>;
  for (const t of ORDEN) out[t] = f.get(CAMPO_CONSENT[t]) === "on";
  return out;
}

export const faltanObligatorios = (c: Record<ConsentType, boolean>) => OBLIGATORIOS.some((t) => !c[t]);

// Registra cada documento (aceptado, o rechazado si es el opcional sin marcar).
export async function registrarConsentimientosWeb(
  db: Db,
  o: {
    patientId: string;
    marcas: Record<ConsentType, boolean>;
    actor: "paciente" | "tutor";
    actorUserId: string;
    ip?: string | null;
    userAgent?: string | null;
  }
) {
  const textos = await textosVigentes(db);
  for (const t of ORDEN) {
    await registrar(db, {
      patientId: o.patientId,
      professionalId: null,
      type: t,
      action: o.marcas[t] ? "ACEPTADO" : "RECHAZADO",
      legalTextId: textos[t].id,
      actor: o.actor,
      actorUserId: o.actorUserId,
      ip: o.ip,
      userAgent: o.userAgent,
      channel: "web_registro",
    });
  }
}
