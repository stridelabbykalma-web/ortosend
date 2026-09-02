// Protocolo de tests: un NÚCLEO de 5 tests que se hacen siempre, más los
// COMPLEMENTARIOS que activa cada rama según dónde y cómo duele, el morfotipo
// del pie y lo que ya han dado los tests del núcleo.
//
// Tres reglas de diseño, para que esto sea usable en consulta:
//  1. Nada se pide dos veces. Un test que piden varias ramas —o que ya está en
//     el núcleo o en la exploración— aparece una sola vez.
//  2. Hay tope. Se sugieren como mucho MAX_SUGERIDOS y se avisa al pasar de
//     AVISO_VOLUMEN, porque un paciente con tres zonas de dolor activaría
//     veinte tests que nadie va a hacer.
//  3. Todo tiene respuesta cerrada. Nada de «valorar tal cosa»: o hay opciones
//     y unidades, o no es un test de este protocolo.
//
// La recomendación es una ayuda para elegir, nunca sustituye al criterio clínico.

import type { Questionnaire } from "./questionnaire";
import type { Exam } from "./exploracion";

export const MAX_SUGERIDOS = 5; // cuántos complementarios propone la app
export const AVISO_VOLUMEN = 8; // a partir de aquí se avisa de que es mucha visita

export type TestId =
  // Núcleo — obligatorio para todos
  | "jack"
  | "navicular"
  | "resist_sup"
  | "lunge"
  | "single_heel_rise"
  // Complementarios — según rama
  | "double_heel_rise"
  | "max_pronacion"
  | "nav_drift"
  | "too_many_toes"
  | "resist_inversion"
  | "coleman"
  | "balance_mono"
  | "single_leg_squat"
  | "step_down"
  | "trendelenburg"
  | "rot_cadera"
  | "dorsiflex_1mtf"
  | "formula_metatarsal"
  | "compresion_mtt"
  | "mulder"
  | "compresion_calcaneo"
  | "palpacion_calcaneo"
  | "palpacion_aquiles"
  | "thompson"
  | "tinel"
  | "estabilidad_tobillo"
  | "territorio_sensitivo";

export type TestDef = {
  id: TestId;
  nombre: string;
  para: string; // qué informa
  minutos: number; // coste aproximado en consulta
  alerta?: boolean; // hallazgo que puede exigir derivación, no plantilla
};

// --- A · Núcleo: los 5 que se hacen siempre ---
export const NUCLEO: TestDef[] = [
  {
    id: "jack",
    nombre: "Jack / Hubscher",
    para: "Mecanismo de windlass: si al dorsiflexionar el hallux se forma el arco.",
    minutos: 1,
  },
  {
    id: "navicular",
    nombre: "Navicular Drop",
    para: "Descenso del navicular y del arco longitudinal medial al cargar el pie (mm).",
    minutos: 3,
  },
  {
    id: "resist_sup",
    nombre: "Resistencia a la supinación",
    para: "Fuerza necesaria para supinar el pie. Orienta la intervención mecánica de la ortesis.",
    minutos: 2,
  },
  {
    id: "lunge",
    nombre: "Lunge Test / Knee to Wall",
    para: "Dorsiflexión funcional de tobillo en carga (cm), comparando ambos lados.",
    minutos: 2,
  },
  {
    id: "single_heel_rise",
    nombre: "Single Heel Rise",
    para: "Tibial posterior, inversión del calcáneo y capacidad funcional monopodal.",
    minutos: 2,
  },
];

// --- B · Complementarios ---
export const COMPLEMENTARIOS: TestDef[] = [
  {
    id: "double_heel_rise",
    nombre: "Double Heel Rise",
    para: "Elevación bilateral de talones cuando la monopodal no es posible o para comparar.",
    minutos: 1,
  },
  {
    id: "max_pronacion",
    nombre: "Máxima pronación",
    para: "Cuánta pronación queda disponible y si el pie llega al final del recorrido en apoyo.",
    minutos: 2,
  },
  {
    id: "nav_drift",
    nombre: "Navicular Drift",
    para: "Desplazamiento medial del navicular en el plano transverso (mm).",
    minutos: 2,
  },
  {
    id: "too_many_toes",
    nombre: "Too Many Toes",
    para: "Cuántos dedos se ven por fuera desde atrás: abducción del antepié y colapso medial.",
    minutos: 1,
  },
  {
    id: "resist_inversion",
    nombre: "Resistencia a la inversión",
    para: "Fuerza del tibial posterior contra resistencia manual.",
    minutos: 1,
  },
  {
    id: "coleman",
    nombre: "Coleman Block Test",
    para: "Si el varo de retropié corrige al descargar el primer radio: cavo flexible o rígido.",
    minutos: 3,
  },
  {
    id: "balance_mono",
    nombre: "Balance monopodal",
    para: "Segundos de apoyo monopodal estable. Control propioceptivo y estabilidad.",
    minutos: 2,
  },
  {
    id: "single_leg_squat",
    nombre: "Single Leg Squat",
    para: "Control dinámico de la cadena: valgo de rodilla y caída pélvica en carga monopodal.",
    minutos: 2,
  },
  {
    id: "step_down",
    nombre: "Step Down Test",
    para: "Control excéntrico bajando un escalón. Complementa al single leg squat.",
    minutos: 2,
  },
  {
    id: "trendelenburg",
    nombre: "Trendelenburg",
    para: "Competencia de los abductores de cadera y caída de la pelvis contralateral.",
    minutos: 1,
  },
  {
    id: "rot_cadera",
    nombre: "Rotación interna/externa de cadera",
    para: "Rango rotacional de cadera, que condiciona el ángulo de progresión del pie.",
    minutos: 2,
  },
  {
    id: "dorsiflex_1mtf",
    nombre: "Dorsiflexión de 1.ª MTF",
    para: "Grados de dorsiflexión del dedo gordo. Con el Jack del núcleo basta para decidir si hay limitus funcional, así que no se explora dos veces.",
    minutos: 1,
  },
  {
    id: "formula_metatarsal",
    nombre: "Fórmula metatarsal y digital",
    para: "Index plus / plus-minus / minus y fórmula digital. Condiciona el diseño de la descarga.",
    minutos: 1,
  },
  {
    id: "compresion_mtt",
    nombre: "Compresión metatarsal",
    para: "Dolor al comprimir transversalmente las cabezas metatarsales.",
    minutos: 1,
  },
  {
    id: "mulder",
    nombre: "Signo de Mulder",
    para: "Clic doloroso intermetatarsal: sospecha de neuroma.",
    minutos: 1,
  },
  {
    id: "compresion_calcaneo",
    nombre: "Compresión lateral del calcáneo",
    para: "Dolor al comprimir el calcáneo entre ambas manos: descarta fractura de estrés.",
    minutos: 1,
    alerta: true,
  },
  {
    id: "palpacion_calcaneo",
    nombre: "Palpación del tubérculo medial del calcáneo",
    para: "Localiza el punto doloroso de la fascia en su inserción.",
    minutos: 1,
  },
  {
    id: "palpacion_aquiles",
    nombre: "Palpación del tendón de Aquiles",
    para: "Distingue dolor insercional de dolor en el cuerpo del tendón: cambia la pauta de la ortesis.",
    minutos: 1,
  },
  {
    id: "thompson",
    nombre: "Thompson",
    para: "Descarta rotura completa del tendón de Aquiles.",
    minutos: 1,
    alerta: true,
  },
  {
    id: "tinel",
    nombre: "Tinel del túnel tarsiano",
    para: "Reproduce parestesias al percutir el nervio tibial posterior.",
    minutos: 1,
    alerta: true,
  },
  {
    id: "estabilidad_tobillo",
    nombre: "Estabilidad de tobillo (cajón anterior y varo forzado)",
    para: "Laxitud del complejo ligamentoso lateral tras esguinces de repetición.",
    minutos: 2,
  },
  {
    id: "territorio_sensitivo",
    nombre: "Exploración sensitiva por territorio",
    para: "Delimita qué nervio explica la quemazón, el hormigueo o el adormecimiento.",
    minutos: 2,
  },
];

export const TESTS: TestDef[] = [...NUCLEO, ...COMPLEMENTARIOS];
export const TEST_POR_ID = Object.fromEntries(TESTS.map((t) => [t.id, t])) as Record<TestId, TestDef>;
export const NUCLEO_IDS = NUCLEO.map((t) => t.id);

// Los casos guardados antes de esta versión usaban «heel_rise» para el double.
const ALIAS: Record<string, TestId> = { heel_rise: "double_heel_rise" };
export const normalizaId = (id: string): TestId => (ALIAS[id] ?? id) as TestId;

// --- C · Ramas: qué se añade según el cuadro ---
export type RamaId =
  | "talon"
  | "arco_plano"
  | "cavo"
  | "antepie"
  | "hallux"
  | "neuroma"
  | "tibial_post"
  | "tobillo_lat"
  | "aquiles"
  | "rodilla"
  | "cadera"
  | "lumbar"
  | "neuro";

export type RamaDef = { id: RamaId; nombre: string; tests: TestId[] };

// El orden dentro de cada rama es el de prioridad: si hay que recortar, se
// recorta por el final.
export const RAMAS: RamaDef[] = [
  { id: "talon", nombre: "Talón / fascia plantar", tests: ["palpacion_calcaneo", "compresion_calcaneo", "dorsiflex_1mtf"] },
  { id: "arco_plano", nombre: "Arco medial / pie plano", tests: ["too_many_toes", "nav_drift", "double_heel_rise", "max_pronacion", "resist_inversion"] },
  { id: "cavo", nombre: "Pie cavo / varo", tests: ["coleman", "balance_mono", "double_heel_rise"] },
  { id: "antepie", nombre: "Antepié / metatarsalgia", tests: ["formula_metatarsal", "compresion_mtt", "dorsiflex_1mtf", "mulder"] },
  { id: "hallux", nombre: "Dedo gordo / 1.ª MTF", tests: ["dorsiflex_1mtf", "formula_metatarsal"] },
  { id: "neuroma", nombre: "Neuroma / dolor intermetatarsal", tests: ["mulder", "compresion_mtt", "territorio_sensitivo"] },
  { id: "tibial_post", nombre: "Tobillo medial / tibial posterior", tests: ["too_many_toes", "resist_inversion", "double_heel_rise", "tinel"] },
  { id: "tobillo_lat", nombre: "Tobillo lateral / inestabilidad", tests: ["estabilidad_tobillo", "balance_mono", "single_leg_squat", "step_down"] },
  { id: "aquiles", nombre: "Tendón de Aquiles", tests: ["palpacion_aquiles", "thompson"] },
  { id: "rodilla", nombre: "Rodilla", tests: ["single_leg_squat", "step_down", "rot_cadera", "trendelenburg"] },
  { id: "cadera", nombre: "Cadera / pelvis", tests: ["trendelenburg", "single_leg_squat", "step_down", "rot_cadera", "balance_mono"] },
  { id: "lumbar", nombre: "Zona lumbar", tests: ["trendelenburg", "single_leg_squat", "rot_cadera"] },
  { id: "neuro", nombre: "Quemazón / hormigueo / adormecimiento", tests: ["tinel", "territorio_sensitivo", "mulder"] },
];

export const RAMA_POR_ID = Object.fromEntries(RAMAS.map((r) => [r.id, r])) as Record<RamaId, RamaDef>;

// Zonas del cuestionario → ramas. Se incluyen las etiquetas antiguas para que
// los casos ya guardados sigan activando su rama.
const ZONA_A_RAMAS: Record<string, RamaId[]> = {
  "Talón": ["talon"],
  "Arco / planta": ["talon", "arco_plano"],
  "Metatarsos / antepié": ["antepie"],
  "Dedo gordo / 1.ª MTF": ["hallux"],
  "Zona intermetatarsal / dedos menores": ["neuroma"],
  "Tobillo (cara interna)": ["tibial_post"],
  "Tobillo (cara externa)": ["tobillo_lat"],
  "Tendón de Aquiles": ["aquiles"],
  "Rodilla": ["rodilla"],
  "Cadera / pelvis": ["cadera"],
  "Zona lumbar": ["lumbar"],
  // Etiquetas anteriores
  "Dedos": ["hallux", "neuroma"],
  "Tobillo": ["tibial_post", "tobillo_lat"],
  "Cadera": ["cadera"],
};

export type RamaActiva = { rama: RamaDef; motivo: string };

// Qué ramas están activas y por qué. Se alimenta del cuestionario, del
// morfotipo de la exploración y de los resultados del núcleo.
export function ramasActivas(q: Questionnaire | null | undefined, e: Exam | null | undefined): RamaActiva[] {
  const activas = new Map<RamaId, string>();
  const activar = (id: RamaId, motivo: string) => {
    if (!activas.has(id)) activas.set(id, motivo);
  };

  for (const z of q?.zonas ?? [])
    for (const id of ZONA_A_RAMAS[z] ?? []) activar(id, `dolor en ${z.toLowerCase()}`);

  if ((q?.tipoSintoma ?? "").startsWith("Quemazón") || (q?.tipoSintoma ?? "") === "Ambos")
    activar("neuro", "síntomas de quemazón, hormigueo o adormecimiento");

  const tipo = e?.tipoPie ?? "";
  const fpi = [e?.fpiIzq, e?.fpiDcho].map(Number).filter((n) => !isNaN(n));
  if (tipo.startsWith("Plano")) activar("arco_plano", `tipo de pie ${tipo.toLowerCase()}`);
  else if (fpi.some((n) => n >= 6)) activar("arco_plano", "FPI-6 pronado");
  if (tipo.startsWith("Cavo")) activar("cavo", `tipo de pie ${tipo.toLowerCase()}`);
  else if (fpi.some((n) => n <= -1)) activar("cavo", "FPI-6 supinado");

  const drop = [e?.navDropIzq, e?.navDropDcho].map(Number).filter((n) => !isNaN(n));
  if (drop.some((n) => n >= 10)) activar("arco_plano", "navicular drop de 10 mm o más");
  const heel = [e?.singleHeelIzq, e?.singleHeelDcho].filter(Boolean) as string[];
  if (heel.some((v) => v !== SINGLE_HEEL_NORMAL && v !== ""))
    activar("tibial_post", "single heel rise alterado");

  return RAMAS.filter((r) => activas.has(r.id)).map((rama) => ({ rama, motivo: activas.get(rama.id)! }));
}

export type Sugerencia = {
  test: TestDef;
  ramas: string[]; // nombres de las ramas que lo piden
  motivos: string[]; // por qué, en palabras del caso
  sugerido: boolean; // entra dentro de los MAX_SUGERIDOS
};

// Complementarios ordenados por prioridad, sin repetir ninguno y sin repetir
// nada que ya esté en el núcleo.
export function complementariosSugeridos(
  q: Questionnaire | null | undefined,
  e: Exam | null | undefined
): Sugerencia[] {
  const activas = ramasActivas(q, e);
  const acc = new Map<TestId, { ramas: string[]; motivos: string[]; mejorPos: number }>();

  for (const { rama, motivo } of activas)
    rama.tests.forEach((id, pos) => {
      if (NUCLEO_IDS.includes(id)) return; // ya está en el núcleo
      const cur = acc.get(id) ?? { ramas: [], motivos: [], mejorPos: 99 };
      cur.ramas.push(rama.nombre);
      if (!cur.motivos.includes(motivo)) cur.motivos.push(motivo);
      cur.mejorPos = Math.min(cur.mejorPos, pos);
      acc.set(id, cur);
    });

  // El single heel rise imposible obliga a la alternativa bilateral.
  const heel = [e?.singleHeelIzq, e?.singleHeelDcho].filter(Boolean) as string[];
  if (heel.some((v) => v === SINGLE_HEEL_NO_PUEDE)) {
    const cur = acc.get("double_heel_rise") ?? { ramas: [], motivos: [], mejorPos: 99 };
    cur.motivos.unshift("no puede hacer el single heel rise");
    cur.mejorPos = -1;
    acc.set("double_heel_rise", cur);
  }
  if ((q?.plantillasPrevias ?? "") === "Sí, sin mejora" && acc.has("max_pronacion"))
    acc.get("max_pronacion")!.motivos.push("llevó plantillas sin mejora");

  const orden = [...acc.entries()].sort(
    ([ia, a], [ib, b]) =>
      b.ramas.length - a.ramas.length ||
      a.mejorPos - b.mejorPos ||
      COMPLEMENTARIOS.findIndex((t) => t.id === ia) - COMPLEMENTARIOS.findIndex((t) => t.id === ib)
  );

  return orden.map(([id, v], i) => ({
    test: TEST_POR_ID[id],
    ramas: v.ramas,
    motivos: v.motivos,
    sugerido: i < MAX_SUGERIDOS,
  }));
}

// Ramas activas que no tienen ni un solo test marcado: cada zona que duele
// necesita al menos algo que la valore.
export function ramasSinCubrir(
  q: Questionnaire | null | undefined,
  e: Exam | null | undefined
): string[] {
  const sel = (e?.testsSel ?? []).map(normalizaId);
  return ramasActivas(q, e)
    .filter(({ rama }) => !rama.tests.some((id) => NUCLEO_IDS.includes(id) || sel.includes(id)))
    .map(({ rama }) => rama.nombre);
}

export const minutosDe = (ids: TestId[]) =>
  ids.reduce((n, id) => n + (TEST_POR_ID[id]?.minutos ?? 2), 0);

// --- D · Opciones de resultado ---
export const SINGLE_HEEL_NORMAL = "Normal (el talón invierte)";
export const SINGLE_HEEL_NO_PUEDE = "No lo puede hacer";
export const SINGLE_HEEL_OPTS = [
  SINGLE_HEEL_NORMAL,
  "Sin inversión del talón",
  "Lo hace con dolor",
  SINGLE_HEEL_NO_PUEDE,
] as const;

export const JACK_OPTS = ["Positivo (se forma el arco)", "Parcial", "Negativo (no se forma)"] as const;
export const RESIST_SUP_OPTS = ["Baja", "Moderada", "Alta"] as const;
export const MAX_PRONACION_OPTS = ["Dentro de rango", "Llega al final del recorrido", "Rango disminuido"] as const;
export const HEEL_RISE_OPTS = ["Normal bilateral", "Alterado izquierdo", "Alterado derecho", "Alterado bilateral"] as const;
export const POS_NEG_OPTS = ["Negativo", "Dudoso", "Positivo"] as const;
export const TOO_MANY_TOES_OPTS = ["Normal (1-2 dedos)", "Aumentado (3 o más dedos)"] as const;
export const RESIST_INV_OPTS = ["Normal", "Debilidad leve", "Debilidad marcada", "Dolorosa"] as const;
export const COLEMAN_OPTS = ["Retropié corrige (cavo flexible)", "Retropié no corrige (cavo rígido)"] as const;
export const SQUAT_OPTS = ["Normal", "Valgo dinámico de rodilla", "Caída pélvica contralateral", "Ambos"] as const;
export const STEP_DOWN_OPTS = ["Normal", "Valgo dinámico de rodilla", "Control excéntrico deficiente", "No lo puede hacer"] as const;
export const TRENDELENBURG_OPTS = ["Negativo", "Positivo izquierdo", "Positivo derecho", "Positivo bilateral"] as const;
export const ROT_CADERA_OPTS = ["Normal", "Rotación interna aumentada", "Rotación externa aumentada", "Globalmente limitada"] as const;
export const FORMULA_MTT_OPTS = ["Index plus", "Index plus-minus", "Index minus"] as const;
export const FORMULA_DIGITAL_OPTS = ["Egipcio", "Griego", "Cuadrado"] as const;
export const PALP_CALCANEO_OPTS = ["No dolorosa", "Dolor en tubérculo medial", "Dolor difuso en talón"] as const;
export const PALP_AQUILES_OPTS = ["No dolorosa", "Dolor insercional", "Dolor en el cuerpo del tendón", "Engrosamiento palpable"] as const;
export const ESTABILIDAD_OPTS = ["Estable", "Cajón anterior positivo", "Varo forzado positivo", "Ambos positivos"] as const;
export const TERRITORIO_OPTS = [
  "Sin alteración sensitiva",
  "Tibial posterior / plantar medial",
  "Plantar lateral",
  "Sural",
  "Peroneo superficial",
  "Distribución no concluyente",
] as const;

// --- E · Qué campo guarda el resultado de cada test ---
const CAMPOS: Record<TestId, (keyof Exam)[]> = {
  jack: ["jackIzq", "jackDcho"],
  navicular: ["navDropIzq", "navDropDcho"],
  resist_sup: ["resistSupIzq", "resistSupDcho"],
  lunge: ["lungeIzq", "lungeDcha"],
  single_heel_rise: ["singleHeelIzq", "singleHeelDcho"],
  double_heel_rise: ["heelRise"],
  max_pronacion: ["maxPronIzq", "maxPronDcho"],
  nav_drift: ["navDriftIzq", "navDriftDcho"],
  too_many_toes: ["tooManyToes"],
  resist_inversion: ["resistInversion"],
  coleman: ["coleman"],
  balance_mono: ["balanceIzq", "balanceDcho"],
  single_leg_squat: ["singleLegSquat"],
  step_down: ["stepDown"],
  trendelenburg: ["trendelenburg"],
  rot_cadera: ["rotCadera"],
  dorsiflex_1mtf: ["dorsi1mtfIzq", "dorsi1mtfDcho"],
  formula_metatarsal: ["formulaMetatarsal", "formulaDigital"],
  compresion_mtt: ["compresionMtt"],
  mulder: ["mulder"],
  compresion_calcaneo: ["compresionCalcaneo"],
  palpacion_calcaneo: ["palpacionCalcaneo"],
  palpacion_aquiles: ["palpacionAquiles"],
  thompson: ["thompson"],
  tinel: ["tinel"],
  estabilidad_tobillo: ["estabilidadTobillo"],
  territorio_sensitivo: ["territorioSensitivo"],
};

export const camposDe = (id: TestId) => CAMPOS[id] ?? [];

export function testTieneResultado(e: Exam | null | undefined, id: TestId): boolean {
  if (!e) return false;
  return camposDe(id).some((c) => String(e[c] ?? "").trim() !== "");
}

// El núcleo está completo cuando los 5 tienen resultado.
export const nucleoCompleto = (e: Exam | null | undefined) =>
  NUCLEO_IDS.every((id) => testTieneResultado(e, id));

// Los complementarios elegidos están completos cuando todos tienen resultado.
export function complementariosCompletos(e: Exam | null | undefined): boolean {
  const sel = (e?.testsSel ?? []).map(normalizaId);
  return sel.every((id) => testTieneResultado(e, id));
}

// --- F · Hallazgos de alerta: no se resuelven con una plantilla ---
export function alertasDe(e: Exam | null | undefined): string[] {
  if (!e) return [];
  const out: string[] = [];
  if (e.thompson === "Positivo")
    out.push("Thompson positivo: sospecha de rotura del tendón de Aquiles — derivación urgente.");
  if (e.compresionCalcaneo === "Positivo")
    out.push("Compresión lateral del calcáneo positiva: descartar fractura de estrés antes de tratar.");
  if (e.tinel === "Positivo")
    out.push("Tinel positivo en túnel tarsiano: valorar atrapamiento del nervio tibial posterior.");
  if (e.territorioSensitivo && e.territorioSensitivo !== "Sin alteración sensitiva")
    out.push(`Alteración sensitiva (${e.territorioSensitivo.toLowerCase()}): valoración neurológica.`);
  return out;
}
