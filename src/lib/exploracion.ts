// Exploración biomecánica (paso 2 del protocolo de captura): la valoración que
// necesita el prescriptor para recetar la plantilla. Definición compartida entre
// el formulario de la clínica, la acción de guardado y las vistas del expediente.

// --- A · Movilidad y flexibilidad (en camilla) ---
export const TOBILLO_OPTS = [
  "Normal",
  "Limitada rodilla extendida (gastrocnemios)",
  "Limitada también con rodilla flexionada (sóleo)",
] as const;

export const HALLUX_OPTS = ["Normal", "Hallux limitus", "Hallux rigidus", "Hallux valgus"] as const;

export const SUBASTRAGALINA_OPTS = ["Normal", "Limitada", "Hipermóvil"] as const;

export const PRIMER_RADIO_OPTS = [
  "Normal",
  "Hipomóvil",
  "Hipermóvil",
  "Dorsiflexionado",
  "Plantarflexionado",
] as const;

export const CADENA_POSTERIOR_OPTS = [
  "Normal",
  "Acortamiento leve",
  "Acortamiento marcado",
] as const;

// --- B · Tests podológicos en carga ---
export const JACK_OPTS = ["Positivo (arco se restaura)", "Negativo", "No valorable"] as const;

export const HEEL_RISE_OPTS = [
  "Normal bilateral",
  "Alterado izquierdo",
  "Alterado derecho",
  "Alterado bilateral",
] as const;

export const TIPO_PIE_OPTS = [
  "Neutro",
  "Plano flexible",
  "Plano rígido",
  "Cavo",
  "Cavo-varo",
] as const;

// --- C · Dismetría (nivel pélvico + láminas calibradas) ---
export const LADO_CORTO_OPTS = ["Izquierda", "Derecha"] as const;

export const LAMINA_OPTS = ["3 mm", "5 mm", "7 mm", "10 mm", "Más de 10 mm"] as const;

// --- D · Análisis observacional de la marcha ---
export const MARCHA_PATRON_OPTS = ["Neutro", "Pronador", "Supinador", "Mixto / asimétrico"] as const;

export const CONTACTO_OPTS = ["Talón (normal)", "Planta completa", "Antepié"] as const;

export const ANGULO_PASO_OPTS = [
  "Normal",
  "Aumentado (marcha en abducción)",
  "Disminuido (marcha convergente)",
] as const;

export const RETROPIE_OPTS = ["Neutro", "Valgo", "Varo", "Asimétrico"] as const;

export const DESPEGUE_OPTS = [
  "Normal",
  "Despegue precoz de talón",
  "Propulsión insuficiente del primer dedo",
] as const;

// v2 = exploración biomecánica completa. Los casos antiguos (v1) solo tienen
// tobillo/hallux/dismetria/alza y se siguen mostrando sin romper nada.
export type Exam = {
  v?: number;
  done?: boolean; // true cuando la clínica completó la última sección (modo guiado)
  // A · Movilidad y flexibilidad
  tobillo?: string; // Silfverskiöld
  lungeIzq?: string; // cm a la pared
  lungeDcha?: string;
  subastragalina?: string;
  primerRadio?: string;
  hallux?: string;
  cadenaPosterior?: string;
  // B · Tests en carga
  fpiIzq?: string; // FPI-6, -12..+12
  fpiDcho?: string;
  jackIzq?: string;
  jackDcho?: string;
  navDropIzq?: string; // mm
  navDropDcho?: string;
  heelRise?: string;
  tipoPie?: string;
  // C · Dismetría
  dismetria?: string; // "No" | "Sí" (v1: "Sí — izq. más corta")
  ladoCorto?: string;
  lamina?: string; // lámina que nivela la pelvis
  alza?: string; // alza recomendada en plantilla (mm); v1: texto libre
  // D · Marcha
  marchaPatron?: string;
  contactoInicial?: string;
  anguloPaso?: string;
  retropieApoyo?: string;
  despegue?: string;
  marchaObs?: string;
};

// Categoría clínica del FPI-6 para mostrar junto al número.
export function fpiLabel(score: string | undefined): string {
  if (!score || score.trim() === "") return "";
  const n = Number(score);
  if (isNaN(n)) return score;
  const cat =
    n <= -5 ? "muy supinado" : n <= -1 ? "supinado" : n <= 5 ? "neutro" : n <= 9 ? "pronado" : "muy pronado";
  return `${n} (${cat})`;
}

const pair = (izq?: string, dcha?: string, unit = "") => {
  const l = izq && izq.trim() ? `Izq ${izq.trim()}${unit}` : "";
  const r = dcha && dcha.trim() ? `Dcha ${dcha.trim()}${unit}` : "";
  return [l, r].filter(Boolean).join(" · ");
};

// Líneas [etiqueta, valor] para pintar la exploración en el expediente.
// Omite lo vacío y es compatible con el formato antiguo (v1).
export function examLines(e: Exam | null | undefined): [string, string][] {
  if (!e) return [];
  const lines: [string, string][] = [];
  const add = (label: string, value?: string) => {
    if (value && value.trim()) lines.push([label, value.trim()]);
  };
  // A · Movilidad
  add("Flexión dorsal tobillo (Silfverskiöld)", e.tobillo);
  add("Lunge test", pair(e.lungeIzq, e.lungeDcha, " cm"));
  add("Subastragalina", e.subastragalina);
  add("Primer radio", e.primerRadio);
  add("Hallux", e.hallux);
  add("Cadena posterior", e.cadenaPosterior);
  // B · Tests en carga
  add("FPI-6", pair(fpiLabel(e.fpiIzq), fpiLabel(e.fpiDcho)));
  add("Test de Jack (windlass)", pair(e.jackIzq, e.jackDcho));
  add("Navicular drop", pair(e.navDropIzq, e.navDropDcho, " mm"));
  add("Heel rise", e.heelRise);
  add("Tipo de pie", e.tipoPie);
  // C · Dismetría
  if (e.dismetria === "Sí" && e.ladoCorto) {
    add("Dismetría", `Sí — ${e.ladoCorto.toLowerCase()} más corta`);
  } else {
    add("Dismetría", e.dismetria); // v1 ya guardaba el lado en el texto
  }
  add("Lámina que nivela la pelvis", e.lamina);
  if (e.alza && e.alza !== "No") add("Alza recomendada en plantilla", /^\d/.test(e.alza) ? `${e.alza} mm` : e.alza);
  // D · Marcha
  add("Patrón de pisada", e.marchaPatron);
  add("Contacto inicial", e.contactoInicial);
  add("Ángulo de paso", e.anguloPaso);
  add("Retropié en apoyo", e.retropieApoyo);
  add("Despegue", e.despegue);
  add("Observaciones de la marcha", e.marchaObs);
  return lines;
}
