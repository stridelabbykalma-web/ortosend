// Quién receta cada caso. Se elige al enviar el estudio, caso a caso:
//   CLINICA  → lo firma el profesional de la clínica que lo envió (debe ser
//              prescriptor con colegiación verificada).
//   ORTOSEND → lo receta el prescriptor central de Ortosend.
//   REVISION → el profesional de la clínica puede recetar, pero quiere que
//              Ortosend lo revise primero; Ortosend le devuelve su valoración
//              y firma la clínica.
// Un profesional sin capacidad de prescribir solo puede enviar a ORTOSEND.
//
// Los casos anteriores a esta versión no tienen ruta: se siguen repartiendo
// por la regla antigua (clínica con prescriptor propio o no).
import type { Prisma } from "@prisma/client";

export type RxRoute = "CLINICA" | "ORTOSEND" | "REVISION";

export const RX_ROUTES: RxRoute[] = ["CLINICA", "ORTOSEND", "REVISION"];

export const RX_ROUTE_LABEL: Record<RxRoute, string> = {
  CLINICA: "Receta propia",
  ORTOSEND: "Receta por parte del equipo de Ortosend",
  REVISION: "Receta propia con segunda opinión de Ortosend",
};

export const RX_ROUTE_HELP: Record<RxRoute, string> = {
  CLINICA: "La valoración y la firma son tuyas.",
  ORTOSEND: "El equipo de Ortosend valora el estudio y firma la prescripción.",
  REVISION: "El equipo de Ortosend valora el estudio y te devuelve su opinión; la firma es tuya.",
};

// Prefijo con el que Ortosend deja su segunda opinión en el borrador de valoración.
export const REVISION_PREFIJO = "Segunda opinión de Ortosend";

// Casos que valora el equipo central: los enviados a Ortosend o para revisión,
// y los antiguos sin ruta de clínicas sin prescriptor propio.
export const CENTRAL_WHERE: Prisma.CaseWhereInput = {
  OR: [{ rxRoute: "ORTOSEND" }, { rxRoute: "REVISION" }, { rxRoute: null, clinic: { hasPrescriber: false } }],
};

export function esCentral(k: { rxRoute: string | null; clinic: { hasPrescriber: boolean } }): boolean {
  return k.rxRoute ? k.rxRoute !== "CLINICA" : !k.clinic.hasPrescriber;
}
