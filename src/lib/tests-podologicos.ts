// Los 6 tests del protocolo. El profesional hace al menos 5, eligiendo cuáles
// según el caso; aquí se define para qué sirve cada uno, cuándo está indicado y
// una recomendación calculada a partir de lo que ya se sabe del paciente
// (zonas de dolor, desgaste del calzado, plantillas previas y exploración).
// La recomendación es una ayuda para elegir, nunca sustituye el criterio clínico.

import type { Questionnaire } from "./questionnaire";
import type { Exam } from "./exploracion";

export const MIN_TESTS = 5;

export type TestId =
  | "jack"
  | "navicular"
  | "resist_sup"
  | "max_pronacion"
  | "lunge"
  | "heel_rise";

export type TestDef = {
  id: TestId;
  nombre: string;
  para: string; // qué informa
  indicado: string; // en qué casos se pide
  zonas: string[]; // zonas de dolor que lo hacen especialmente útil
};

export const TESTS: TestDef[] = [
  {
    id: "jack",
    nombre: "Test de Jack / Hubscher",
    para: "Comprueba el mecanismo de windlass: si al extender el primer dedo se forma el arco.",
    indicado: "Fascitis plantar, dolor en arco, hallux limitus/rigidus y pie plano flexible (si es reductible).",
    zonas: ["Talón", "Arco / planta", "Dedos"],
  },
  {
    id: "navicular",
    nombre: "Navicular Drop",
    para: "Mide en mm cuánto desciende el escafoides del pie neutro al apoyo relajado.",
    indicado: "Cuantificar el colapso del arco interno y la pronación; dolor medial de arco, tobillo o rodilla.",
    zonas: ["Arco / planta", "Tobillo", "Rodilla"],
  },
  {
    id: "resist_sup",
    nombre: "Resistencia a la supinación",
    para: "Estima la fuerza necesaria para supinar el pie — orienta cuánta cuña/posting necesita la plantilla.",
    indicado: "Pies pronados y plantillas previas que no mejoraron; dolor medial de rodilla o tibial posterior.",
    zonas: ["Arco / planta", "Rodilla", "Tobillo"],
  },
  {
    id: "max_pronacion",
    nombre: "Máxima pronación",
    para: "Valora cuánta pronación queda disponible y si el pie llega al final de su recorrido en apoyo.",
    indicado: "Pie que pronota hasta el tope; sobrecarga de antepié y dolor medial.",
    zonas: ["Arco / planta", "Metatarsos / antepié", "Tobillo"],
  },
  {
    id: "lunge",
    nombre: "Lunge Test",
    para: "Mide la flexión dorsal de tobillo en carga (cm de la rodilla a la pared, sin despegar el talón).",
    indicado: "Equino o gemelos cortos, despegue precoz de talón, talalgia, metatarsalgia y dolor de tobillo o rodilla.",
    zonas: ["Tobillo", "Talón", "Metatarsos / antepié", "Rodilla"],
  },
  {
    id: "heel_rise",
    nombre: "Double Heel Rise",
    para: "Valora el tibial posterior y si el retropié se invierte al elevar talones.",
    indicado: "Sospecha de disfunción del tibial posterior, pie plano adquirido y dolor medial de tobillo o arco.",
    zonas: ["Arco / planta", "Tobillo", "Talón"],
  },
];

export const TEST_POR_ID = Object.fromEntries(TESTS.map((t) => [t.id, t])) as Record<TestId, TestDef>;

export type Recomendacion = {
  test: TestDef;
  motivos: string[]; // por qué se recomienda en este caso
};

// Ordena los 6 tests por lo indicados que están para este paciente y explica
// el porqué, para que el profesional vea de un vistazo cuál puede omitir.
export function recomendarTests(
  q: Questionnaire | null | undefined,
  e: Exam | null | undefined
): Recomendacion[] {
  const zonas = q?.zonas ?? [];
  const desgaste = q?.desgaste ?? "";
  const plantillas = q?.plantillasPrevias ?? "";
  const pronador = desgaste.includes("interno");
  const supinador = desgaste.includes("externo");

  const recs: Recomendacion[] = TESTS.map((test) => {
    const motivos: string[] = [];

    for (const z of test.zonas) {
      if (zonas.includes(z)) motivos.push(`dolor en ${z.toLowerCase()}`);
    }

    if (pronador && ["navicular", "resist_sup", "max_pronacion", "heel_rise"].includes(test.id))
      motivos.push("desgaste del calzado pronador");
    if (supinador && ["lunge", "heel_rise"].includes(test.id))
      motivos.push("desgaste del calzado supinador");
    if (plantillas === "Sí, sin mejora" && test.id === "resist_sup")
      motivos.push("llevó plantillas sin mejora");
    if (test.id === "lunge" && (e?.tobillo ?? "").startsWith("Limitada"))
      motivos.push("flexión dorsal limitada en camilla");
    if (test.id === "heel_rise" && e?.tipoPie?.startsWith("Plano"))
      motivos.push("pie plano en la exploración");
    if (test.id === "jack" && e?.hallux && e.hallux !== "Normal")
      motivos.push(`hallux: ${e.hallux.toLowerCase()}`);

    return { test, motivos };
  });

  // Más motivos primero; a igualdad, se respeta el orden del protocolo.
  return recs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.motivos.length - a.r.motivos.length || a.i - b.i)
    .map(({ r }) => r);
}

// --- Resultados: opciones de cada test ---
export const JACK_OPTS = [
  "Positivo (se forma el arco)",
  "Parcial",
  "Negativo (no se forma)",
] as const;

export const RESIST_SUP_OPTS = ["Baja", "Moderada", "Alta"] as const;

export const MAX_PRONACION_OPTS = [
  "Dentro de rango",
  "Llega al final del recorrido",
  "Rango disminuido",
] as const;

export const HEEL_RISE_OPTS = [
  "Normal bilateral",
  "Alterado izquierdo",
  "Alterado derecho",
  "Alterado bilateral",
] as const;

// Campos de resultado de cada test, para saber si ya está anotado.
const CAMPOS: Record<TestId, (keyof Exam)[]> = {
  jack: ["jackIzq", "jackDcho"],
  navicular: ["navDropIzq", "navDropDcho"],
  resist_sup: ["resistSupIzq", "resistSupDcho"],
  max_pronacion: ["maxPronIzq", "maxPronDcho"],
  lunge: ["lungeIzq", "lungeDcha"],
  heel_rise: ["heelRise"],
};

export function testTieneResultado(e: Exam | null | undefined, id: TestId): boolean {
  if (!e) return false;
  return CAMPOS[id].some((c) => String(e[c] ?? "").trim() !== "");
}

// Todos los tests elegidos tienen ya su resultado anotado.
export function testsCompletos(e: Exam | null | undefined): boolean {
  const sel = (e?.testsSel ?? []) as TestId[];
  return sel.length >= MIN_TESTS && sel.every((id) => testTieneResultado(e, id));
}
