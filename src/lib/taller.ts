// Utilidades del taller: fases de producción, plazo de entrega en días laborables
// y la ficha técnica de fabricación (lo que el taller necesita del expediente
// sin leer todo el cuestionario clínico).
import type { Case, CaseState, FabPhase, Payment, Prescription } from "@prisma/client";
import type { Questionnaire } from "./questionnaire";
import type { Exam } from "./exploracion";

// Estados del caso que viven en el taller (tablero por fases).
export const TALLER_STATES: CaseState[] = ["ENTRADA_TALLER", "DISENO", "FABRICACION", "CALIDAD", "ENVIADO"];

export const PHASES: [CaseState, string][] = [
  ["ENTRADA_TALLER", "Entrada"],
  ["DISENO", "Diseño"],
  ["FABRICACION", "Fabricación"],
  ["CALIDAD", "Calidad"],
  ["ENVIADO", "Envío"],
];

// Pasos de producción tal y como los ve el taller en la ficha del caso
// (la fabricación se desdobla en mecanizado CNC y confección a mano).
export type ProdStep = { key: string; label: string };
export const PROD_STEPS: ProdStep[] = [
  { key: "entrada", label: "Entrada" },
  { key: "diseno", label: "Diseño CAD" },
  { key: "mecanizado", label: "Mecanizado CNC" },
  { key: "confeccion", label: "Confección" },
  { key: "calidad", label: "Calidad" },
  { key: "envio", label: "Envío" },
  { key: "entrega", label: "Entrega" },
];

export function prodStepIndex(state: CaseState, fabPhase: FabPhase | null): number {
  switch (state) {
    case "ENTRADA_TALLER":
      return 0;
    case "DISENO":
      return 1;
    case "FABRICACION":
      return fabPhase === "CONFECCION" ? 3 : 2;
    case "CALIDAD":
      return 4;
    case "ENVIADO":
      return 5;
    case "ENTREGADO":
    case "CERRADO":
      return 6;
    default:
      return -1;
  }
}

export function fabPhaseLabel(fabPhase: FabPhase | null | undefined) {
  return fabPhase === "CONFECCION" ? "Confección a mano" : "Mecanizado CNC";
}

// --- Plazo de entrega: 5 días laborables desde el pago ---
export const SLA_DIAS = 5;

// Días laborables (lunes a viernes) transcurridos desde una fecha, sin contar el día de hoy.
export function diasLaborablesDesde(desde: Date, hasta: Date = new Date()): number {
  const a = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  const b = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());
  let n = 0;
  for (let d = new Date(a); d < b; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

export type Sla = {
  dia: number; // día laborable en el que está el caso (1 = día del pago)
  nivel: "ok" | "ajustado" | "fuera"; // verde / ámbar / rojo
  texto: string;
};

// Semáforo del plazo: verde hasta el día 3, ámbar días 4-5, rojo si se pasa.
export function slaDe(kase: { payment: Payment | null; createdAt: Date }): Sla | null {
  const desde = kase.payment?.paidAt;
  if (!desde) return null;
  const dia = diasLaborablesDesde(new Date(desde)) + 1;
  const nivel: Sla["nivel"] = dia > SLA_DIAS ? "fuera" : dia >= SLA_DIAS - 1 ? "ajustado" : "ok";
  const texto =
    nivel === "fuera" ? `Fuera de plazo (+${dia - SLA_DIAS})` : `Día ${dia} de ${SLA_DIAS}`;
  return { dia, nivel, texto };
}

// Siguiente código de lote de mecanizado a partir de los existentes (L-01, L-02…).
export function siguienteLote(lotes: (string | null)[]): string {
  let max = 0;
  for (const l of lotes) {
    const m = /^L-(\d+)$/i.exec((l ?? "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `L-${String(max + 1).padStart(2, "0")}`;
}

// --- Ficha técnica de fabricación ---
export type FichaLinea = [string, string];

// Datos del estudio que condicionan el diseño y la fabricación del par.
export function fichaTecnica(
  q: Questionnaire | null | undefined,
  e: Exam | null | undefined,
  kase: Pick<Case, "delivery">
): FichaLinea[] {
  const out: FichaLinea[] = [];
  const add = (label: string, value?: string | null) => {
    if (value && value.trim()) out.push([label, value.trim()]);
  };
  add("Talla de calzado (EU)", q?.tallaCalzado);
  if (q?.peso || q?.altura) add("Peso / altura", [q.peso && `${q.peso} kg`, q.altura && `${q.altura} cm`].filter(Boolean).join(" · "));
  add("Actividad", [q?.actividad, q?.deporte].filter(Boolean).join(" · "));
  add("Horas de pie al día", q?.horasPie);
  add("Calzado habitual", q?.calzado?.length ? q.calzado.join(", ") : undefined);
  add("Desgaste del calzado", q?.desgaste);
  add("Plantillas previas", q?.plantillasPrevias);
  if (q?.lado || q?.zonas?.length) add("Dolor", [q.lado, q.zonas?.join(", ")].filter(Boolean).join(" — "));
  add("Tipo de pie", e?.tipoPie);
  if (e?.fpiIzq || e?.fpiDcho) add("FPI-6 (izq. / dcho.)", `${e.fpiIzq ?? "—"} / ${e.fpiDcho ?? "—"}`);
  if (e?.dismetria === "Sí" && e.ladoCorto) add("Dismetría", `${e.ladoCorto} más corta`);
  else if (e?.dismetria && e.dismetria !== "No") add("Dismetría", e.dismetria);
  if (e?.alza && e.alza !== "No") add("Alza en plantilla", /^\d/.test(e.alza) ? `${e.alza} mm` : e.alza);
  add("Entrega", kase.delivery === "CLINICA" ? "Recogida en clínica" : kase.delivery === "DOMICILIO" ? "Domicilio del paciente" : undefined);
  return out;
}

// Puntos del control de calidad. Todos obligatorios para aprobar el par.
export const QC_CHECKS: [string, string][] = [
  ["medidas", "Medidas conformes al diseño CAD (longitud, anchura, altura del arco)"],
  ["acabados", "Acabados y pulido sin rebabas ni aristas"],
  ["marcado", "Marcado I/D correcto y par emparejado"],
  ["etiquetado", "Etiquetado del par con número de caso"],
];

export const QC_KIND = "foto_calidad";

// --- Trabajo por pie (etiquetas de molde I / D) ---
export type Pie = "I" | "D";
export type TrabajoPie = {
  pie: Pie;
  nombre: string;
  pauta: string; // lo específico de este pie, o la receta general si no hay
  especifica: boolean; // true si la prescripción detalla este pie aparte
  datos: string[]; // alza, FPI y lado del dolor de este pie, sacados del estudio
};

// Qué hay que hacer en cada pie: la prescripción manda (pauta por pie si la
// hay; si no, la general) y del estudio salen alza, FPI y dolor de ese lado.
export function trabajoPorPie(
  rx: Pick<Prescription, "fabricationOrder" | "orderLeft" | "orderRight"> | null,
  e: Exam | null | undefined,
  q?: Questionnaire | null
): [TrabajoPie, TrabajoPie] {
  const mk = (pie: Pie): TrabajoPie => {
    const nombre = pie === "I" ? "Izquierdo" : "Derecho";
    const propia = (pie === "I" ? rx?.orderLeft : rx?.orderRight)?.trim();
    const datos: string[] = [];
    const corto = (e?.ladoCorto ?? "").toLowerCase();
    const esCorto = pie === "I" ? corto.startsWith("izq") : corto.startsWith("der") || corto.startsWith("dch");
    if (e?.alza && e.alza !== "No") {
      const alza = /^\d/.test(e.alza) ? `${e.alza} mm` : e.alza;
      if (e.dismetria === "Sí" && corto) datos.push(esCorto ? `Alza ${alza} (lado corto)` : "Sin alza");
      else datos.push(`Alza ${alza}`);
    }
    const fpi = pie === "I" ? e?.fpiIzq : e?.fpiDcho;
    if (fpi) datos.push(`FPI-6 ${fpi}`);
    const lado = (q?.lado ?? "").toLowerCase();
    if (lado.startsWith("ambos") || (pie === "I" && lado.startsWith("izq")) || (pie === "D" && lado.startsWith("der")))
      datos.push(`Dolor: ${q?.zonas?.length ? q.zonas.join(", ").toLowerCase() : "sí"}`);
    return {
      pie,
      nombre,
      pauta: propia || rx?.fabricationOrder?.trim() || "—",
      especifica: !!propia,
      datos,
    };
  };
  return [mk("I"), mk("D")];
}
