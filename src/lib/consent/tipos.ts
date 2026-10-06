// Documentos que el paciente acepta uno a uno por WhatsApp, en este orden.
// Los cuatro primeros son obligatorios; el de marketing es opcional.
import type { ConsentType } from "@prisma/client";

export const ORDEN: ConsentType[] = ["PRIVACIDAD", "DATOS_SALUD", "TRATAMIENTO", "CONDICIONES", "MARKETING"];
export const OBLIGATORIOS: ConsentType[] = ["PRIVACIDAD", "DATOS_SALUD", "TRATAMIENTO", "CONDICIONES"];

// Identificador corto que viaja en ManyChat (campo ortosend_siguiente, botones)
// y en las URL de los textos (/l/{ref}/{slug}).
export const SLUG: Record<ConsentType, string> = {
  PRIVACIDAD: "privacidad",
  DATOS_SALUD: "salud",
  TRATAMIENTO: "tratamiento",
  CONDICIONES: "condiciones",
  MARKETING: "marketing",
};

export const ETIQUETA: Record<ConsentType, string> = {
  PRIVACIDAD: "Política de privacidad",
  DATOS_SALUD: "Tratamiento de mis datos de salud",
  TRATAMIENTO: "Información sobre el tratamiento con plantillas",
  CONDICIONES: "Condiciones del servicio",
  MARKETING: "Comunicaciones comerciales (opcional)",
};

export function tipoDeSlug(slug: string): ConsentType | null {
  const hit = (Object.entries(SLUG) as [ConsentType, string][]).find(([, s]) => s === slug);
  return hit ? hit[0] : null;
}

export const esObligatorio = (t: ConsentType) => OBLIGATORIOS.includes(t);
