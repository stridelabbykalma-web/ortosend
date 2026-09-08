// Utilidades del puesto del revisor (prescriptor): edad, IMC, antigüedad y la
// síntesis de puntos clave del estudio. Todo son cálculos de presentación sobre
// lo que ya guardó la clínica; la valoración la firma siempre el profesional.
import type { MediaAsset } from "@prisma/client";
import { fpiLabel, type Exam } from "./exploracion";
import type { Questionnaire } from "./questionnaire";
import { alertasDe } from "./tests-podologicos";
import { helbingResumen, type Helbing } from "./helbing";
import type { MarchaInforme, MarchaTrack } from "./marcha";

export function edad(birth: Date | string | null | undefined): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}

// IMC a partir del peso (kg) y la altura (cm) del cuestionario.
export function imc(peso?: string, altura?: string): string | null {
  const p = Number(String(peso ?? "").replace(",", "."));
  const h = Number(String(altura ?? "").replace(",", ".")) / 100;
  if (!p || !h || p < 20 || h < 1) return null;
  const v = p / (h * h);
  const cat = v < 18.5 ? "bajo" : v < 25 ? "normal" : v < 30 ? "sobrepeso" : "obesidad";
  return `${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })} (${cat})`;
}

// «hace 3 d», «hace 40 min», «ahora mismo»
export function hace(d: Date | string | null | undefined, now = Date.now()): string {
  if (!d) return "—";
  const ms = now - new Date(d).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  return `hace ${days} d`;
}

// Instante de la petición (los componentes de servidor se pintan una vez por petición)
export const ahoraMs = () => Date.now();

// Días completos de espera (para la cola: antigüedad del caso)
export function diasDesde(d: Date | string, now = Date.now()): number {
  return Math.floor((now - new Date(d).getTime()) / 86400000);
}

export type MediaMeta = {
  seconds?: number;
  targetSeconds?: number;
  validPct?: number;
  validSeconds?: number;
  helbing?: Helbing;
  perthes?: Helbing;
  marcha?: { track: MarchaTrack; informe: MarchaInforme };
};

export function metaDe(m: Pick<MediaAsset, "meta">): MediaMeta | null {
  return (m.meta as MediaMeta | null) ?? null;
}

export type Clave = {
  texto: string;
  fuente: string; // de dónde sale: Tests, Exploración, Vídeo posterior…
  nivel: "alerta" | "revisar" | "nota";
};

export type Sintesis = {
  claves: Clave[];
  plantilla: string[]; // propuesta orientativa para la plantilla (deduplicada)
};

const num = (s?: string) => {
  const n = Number(String(s ?? "").replace(",", "."));
  return isNaN(n) || s === undefined || s === "" ? null : n;
};

// Puntos clave del estudio para que el revisor arranque con un primer barrido.
// Solo señala lo que sale de rango o de lo esperado; nunca diagnostica.
export function sintesisDe(
  q: Questionnaire | null | undefined,
  e: Exam | null | undefined,
  media: Pick<MediaAsset, "kind" | "meta" | "confirmedAt">[]
): Sintesis {
  const claves: Clave[] = [];
  const plantilla: string[] = [];
  const add = (nivel: Clave["nivel"], fuente: string, texto: string) => claves.push({ texto, fuente, nivel });

  for (const a of alertasDe(e)) add("alerta", "Tests", a);

  if (e) {
    const fpi = [
      e.fpiIzq ? `izq ${fpiLabel(e.fpiIzq)}` : "",
      e.fpiDcho ? `dcha ${fpiLabel(e.fpiDcho)}` : "",
    ]
      .filter(Boolean)
      .join(" / ");
    if (e.tipoPie || fpi) add("nota", "Exploración", [e.tipoPie, fpi ? `FPI-6 ${fpi}` : ""].filter(Boolean).join(" · "));

    const nd = { izq: num(e.navDropIzq), dcha: num(e.navDropDcho) };
    if (nd.izq !== null || nd.dcha !== null) {
      const alto = [nd.izq, nd.dcha].some((v) => v !== null && v >= 10);
      add(
        alto ? "revisar" : "nota",
        "Núcleo",
        `Navicular drop ${nd.izq !== null ? `izq ${nd.izq} mm` : ""}${nd.izq !== null && nd.dcha !== null ? " · " : ""}${nd.dcha !== null ? `dcha ${nd.dcha} mm` : ""}${alto ? " — ≥ 10 mm: pronación marcada" : ""}`
      );
    }
    const jackNeg = [e.jackIzq, e.jackDcho].some((v) => v && v.startsWith("Negativo"));
    if (jackNeg) add("revisar", "Núcleo", "Jack negativo: el arco no se forma al extender el hallux (mecanismo de windlass comprometido).");
    const heel = [
      e.singleHeelIzq && !e.singleHeelIzq.startsWith("Normal") ? `izq: ${e.singleHeelIzq.toLowerCase()}` : "",
      e.singleHeelDcho && !e.singleHeelDcho.startsWith("Normal") ? `dcha: ${e.singleHeelDcho.toLowerCase()}` : "",
    ].filter(Boolean);
    if (heel.length) add("revisar", "Núcleo", `Single heel rise alterado — ${heel.join(" · ")} (valorar tibial posterior).`);
    const lg = { izq: num(e.lungeIzq), dcha: num(e.lungeDcha) };
    if ([lg.izq, lg.dcha].some((v) => v !== null && v < 10))
      add(
        "nota",
        "Núcleo",
        `Lunge ${lg.izq !== null ? `izq ${lg.izq} cm` : ""}${lg.izq !== null && lg.dcha !== null ? " · " : ""}${lg.dcha !== null ? `dcha ${lg.dcha} cm` : ""} — < 10 cm: dorsiflexión de tobillo limitada.`
      );
    if (e.resistSupIzq === "Alta" || e.resistSupDcho === "Alta")
      add("nota", "Núcleo", `Resistencia a la supinación alta${e.resistSupIzq === "Alta" && e.resistSupDcho === "Alta" ? " bilateral" : e.resistSupDcho === "Alta" ? " dcha" : " izq"}: tolerará bien un control de retropié firme.`);
    if (e.dismetria === "Sí" || (e.dismetria && e.dismetria.startsWith("Sí"))) {
      const alza = e.alza && e.alza !== "No" ? (/^\d/.test(e.alza) ? `${e.alza} mm` : e.alza) : null;
      add(
        "revisar",
        "Exploración",
        `Dismetría${e.ladoCorto ? ` (${e.ladoCorto.toLowerCase()} más corta)` : ""}${e.lamina ? ` · nivela con lámina de ${e.lamina}` : ""}${alza ? ` · alza recomendada ${alza}` : ""}.`
      );
      if (alza) plantilla.push(`Alza de ${alza} en la pierna ${e.ladoCorto ? e.ladoCorto.toLowerCase() : "corta"}.`);
    }
    const marchaObs = [e.marchaPatron ? `patrón ${e.marchaPatron.toLowerCase()}` : "", e.retropieApoyo ? `retropié ${e.retropieApoyo.toLowerCase()}` : "", e.despegue && !e.despegue.startsWith("Normal") ? e.despegue.toLowerCase() : ""]
      .filter(Boolean)
      .join(", ");
    if (marchaObs) add("nota", "Marcha observada", marchaObs.charAt(0).toUpperCase() + marchaObs.slice(1) + ".");
  }

  for (const m of media) {
    if (!m.confirmedAt) continue;
    const meta = metaDe(m);
    if (!meta) continue;
    if (meta.helbing) {
      const desviado = [meta.helbing.izq, meta.helbing.dcha].some((l) => l && l.lado !== "neutro");
      add(desviado ? "revisar" : "nota", "Foto posterior", `Línea de Helbing: ${helbingResumen(meta.helbing)}.`);
    }
    if (meta.perthes) {
      const desviado = [meta.perthes.izq, meta.perthes.dcha].some((l) => l && l.lado !== "neutro");
      add(desviado ? "revisar" : "nota", "Foto posterior", `Regla de Perthes: ${helbingResumen(meta.perthes)}.`);
    }
    if (meta.marcha?.informe) {
      const inf = meta.marcha.informe;
      const fuente = inf.vista === "posterior" ? "Vídeo posterior" : "Vídeo anterior";
      if (inf.muestraInsuficiente) add("nota", fuente, "Muestra insuficiente para medir con fiabilidad; revisar el vídeo a mano.");
      for (const h of inf.hallazgos) add(h.gravedad === "revisar" ? "revisar" : "nota", fuente, `${h.titulo}: ${h.detalle}`);
      for (const p of inf.plantilla) if (!plantilla.includes(p)) plantilla.push(p);
    }
  }

  const orden: Record<Clave["nivel"], number> = { alerta: 0, revisar: 1, nota: 2 };
  claves.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
  return { claves, plantilla };
}

// Texto plano para volcar la síntesis en la valoración del revisor (editable).
export function sintesisComoTexto(s: Sintesis): string {
  const lines = s.claves.map((c) => `• ${c.texto} [${c.fuente}]`);
  return lines.join("\n");
}

// Agrupación de las líneas del cuestionario para la ficha del caso
export const Q_GRUPOS: [string, string[]][] = [
  ["Motivo y dolor", ["Motivo", "Evolución", "Dolor", "Lado", "Zonas", "Tipo de síntoma", "Cuándo duele"]],
  ["Actividad y físico", ["Actividad", "De pie al día", "Profesión", "Físico"]],
  ["Calzado", ["Calzado habitual", "Desgaste del calzado", "Plantillas previas"]],
  ["Antecedentes y tratamientos", ["Antecedentes", "Detalle antecedentes", "Medicación", "Tratamientos previos"]],
  ["Observaciones de la clínica", ["Observaciones"]],
];

// Agrupación de las líneas de la exploración. Lo que no esté en ninguna lista
// va a «Tests complementarios».
export const E_GRUPOS: [string, string[]][] = [
  ["Tipo de pie y movilidad", ["Tipo de pie", "Movilidad / flexibilidad relevante", "Subastragalina", "Hallux en descarga", "Cadena posterior"]],
  ["Dismetría", ["Dismetría", "Lámina que nivela la pelvis", "Alza recomendada en plantilla"]],
  ["Marcha observada en consulta", ["Patrón de pisada", "Contacto inicial", "Ángulo de paso", "Retropié en apoyo", "Despegue", "Observaciones de la marcha"]],
];
export const NUCLEO_LABELS = ["Jack / Hubscher", "Navicular drop", "Resistencia a la supinación", "Lunge test", "Single heel rise"];

export function agrupa(lines: [string, string][], grupos: [string, string[]][], resto?: string, excluir: string[] = []) {
  const out: [string, [string, string][]][] = [];
  const usados = new Set<string>(excluir);
  for (const [titulo, labels] of grupos) {
    const ls = lines.filter(([l]) => labels.includes(l));
    ls.forEach(([l]) => usados.add(l));
    if (ls.length) out.push([titulo, ls]);
  }
  if (resto) {
    const ls = lines.filter(([l]) => !usados.has(l));
    if (ls.length) out.push([resto, ls]);
  }
  return out;
}
