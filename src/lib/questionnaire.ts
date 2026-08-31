// Cuestionario clínico (paso 1 del protocolo de captura): definición compartida
// entre el formulario de la clínica, la acción de guardado y las vistas del
// expediente (clínica, prescriptor y taller).

export const EVOLUCION_OPTS = [
  "Menos de 1 mes",
  "1-3 meses",
  "3-6 meses",
  "6-12 meses",
  "Más de 1 año",
] as const;

export const LADO_OPTS = ["Ambos", "Izquierdo", "Derecho", "Sin dolor localizado"] as const;

export const ZONA_OPTS = [
  "Talón",
  "Arco / planta",
  "Metatarsos / antepié",
  "Dedos",
  "Tobillo",
  "Rodilla",
  "Cadera",
  "Zona lumbar",
] as const;

export const MOMENTO_OPTS = [
  "Al levantarse / primeros pasos",
  "Al iniciar la actividad",
  "Durante la actividad",
  "Después de la actividad",
  "En reposo o por la noche",
  "Constante",
] as const;

export const ACTIVIDAD_OPTS = ["Sedentario", "Activo", "Deportista habitual", "Competición"] as const;

export const HORAS_PIE_OPTS = ["Menos de 2 h", "2-4 h", "4-8 h", "Más de 8 h"] as const;

export const CALZADO_OPTS = [
  "Deportivo",
  "Calle / casual",
  "Vestir / tacón",
  "Seguridad / trabajo",
  "Sandalia abierta",
] as const;

export const DESGASTE_OPTS = [
  "Normal / simétrico",
  "Borde interno (pronador)",
  "Borde externo (supinador)",
  "Puntera",
  "Irregular / asimétrico",
] as const;

export const PLANTILLAS_OPTS = ["No, nunca", "Sí, con mejora", "Sí, sin mejora"] as const;

export const ANTECEDENTES_OPTS = [
  "Diabetes",
  "Artritis / artrosis",
  "Patología vascular",
  "Neuropatía",
  "Lesión o cirugía previa en pie / tobillo",
  "Ninguno relevante",
] as const;

export const TRATAMIENTOS_OPTS = [
  "Ninguno",
  "Antiinflamatorios / analgésicos",
  "Fisioterapia",
  "Infiltraciones",
  "Plantillas",
  "Reposo deportivo",
] as const;

// v2 = cuestionario completo. Los casos antiguos (v1) solo tienen motivo/dolor/actividad
// y se siguen mostrando sin romper nada.
export type Questionnaire = {
  v?: number;
  // Motivo de consulta y dolor
  motivo: string;
  evolucion?: string;
  lado?: string;
  zonas?: string[];
  dolor?: string; // intensidad 0-10
  momentos?: string[];
  // Actividad y estilo de vida
  actividad?: string;
  deporte?: string;
  horasPie?: string;
  profesion?: string;
  // Datos físicos
  peso?: string; // kg
  altura?: string; // cm
  tallaCalzado?: string; // EU
  // Calzado y plantillas
  calzado?: string[];
  desgaste?: string;
  plantillasPrevias?: string;
  // Antecedentes y tratamientos
  antecedentes?: string[];
  antecedentesDetalle?: string;
  medicacion?: string;
  tratamientosPrevios?: string[];
  // Observaciones del profesional
  observaciones?: string;
};

const join = (xs?: string[]) => (xs && xs.length ? xs.join(", ") : "");

// Los casos v1 guardaban el dolor como texto libre ("7/10"); v2 guarda solo el número.
export const dolorLabel = (q: Questionnaire | null | undefined) =>
  q?.dolor ? (q.dolor.includes("/") ? q.dolor : `${q.dolor}/10`) : "";

// Líneas [etiqueta, valor] para pintar el cuestionario en el expediente.
// Omite lo vacío y es compatible con el formato antiguo (v1).
export function questionnaireLines(q: Questionnaire | null | undefined): [string, string][] {
  if (!q) return [];
  const lines: [string, string][] = [];
  const add = (label: string, value?: string) => {
    if (value && value.trim()) lines.push([label, value.trim()]);
  };
  add("Motivo", q.motivo);
  add("Evolución", q.evolucion);
  add("Dolor", dolorLabel(q));
  add("Lado", q.lado);
  add("Zonas", join(q.zonas));
  add("Cuándo duele", join(q.momentos));
  add(
    "Actividad",
    [q.actividad, q.deporte].filter(Boolean).join(" · ") || undefined
  );
  add("De pie al día", q.horasPie);
  add("Profesión", q.profesion);
  add(
    "Físico",
    [
      q.peso ? `${q.peso} kg` : "",
      q.altura ? `${q.altura} cm` : "",
      q.tallaCalzado ? `talla ${q.tallaCalzado}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || undefined
  );
  add("Calzado habitual", join(q.calzado));
  add("Desgaste del calzado", q.desgaste);
  add("Plantillas previas", q.plantillasPrevias);
  add("Antecedentes", join(q.antecedentes));
  add("Detalle antecedentes", q.antecedentesDetalle);
  add("Medicación", q.medicacion);
  add("Tratamientos previos", join(q.tratamientosPrevios));
  add("Observaciones", q.observaciones);
  return lines;
}
