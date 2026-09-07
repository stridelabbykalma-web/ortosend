// Análisis preliminar de la marcha en el plano frontal (vídeos posterior y
// anterior) a partir de la trayectoria de los puntos de MediaPipe Pose que se
// guarda con el vídeo. Todo son cálculos 2D sobre la imagen: ORIENTATIVOS, para
// que el prescriptor tenga un primer barrido; no sustituyen a la exploración.

export const MARCHA_IDX = [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32] as const;
// posición de cada punto dentro de `p` (x, y, visibilidad por punto)
const I = {
  hombroIzq: 0, hombroDcho: 1, caderaIzq: 2, caderaDcha: 3, rodillaIzq: 4, rodillaDcha: 5,
  tobilloIzq: 6, tobilloDcho: 7, talonIzq: 8, talonDcho: 9, puntaIzq: 10, puntaDcha: 11,
} as const;

export type MarchaFrame = { t: number; p: number[] }; // t en segundos; p = [x,y,v]×12, coordenadas del vídeo grabado (0..1)
export type MarchaTrack = {
  vista: "posterior" | "anterior";
  w: number; // tamaño del vídeo grabado (para medir ángulos sin deformar)
  h: number;
  frames: MarchaFrame[];
};

export type Hallazgo = {
  clave: string;
  titulo: string;
  detalle: string;
  plantilla: string; // qué hacer (o no hacer) en la plantilla ante este hallazgo
  gravedad: "info" | "leve" | "revisar";
};

export type MarchaInforme = {
  vista: "posterior" | "anterior";
  framesTotales: number;
  apoyoIzq: number; // frames en apoyo monopodal sobre la pierna izquierda
  apoyoDcho: number;
  // Métricas (grados), por lado; null si no hay muestra suficiente
  caidaPelvica: { izq: number | null; dcha: number | null }; // apoyo sobre ese lado: cuánto cae la pelvis contralateral
  rodillaFrontal: { izq: number | null; dcha: number | null }; // + valgo (hacia dentro), − varo
  retropie: { izq: number | null; dcha: number | null }; // posterior: + eversión (valgo), − inversión
  progresion: { izq: number | null; dcha: number | null }; // anterior: + toe-out, − toe-in
  anchuraPaso: number | null; // separación de tobillos / anchura de caderas (mediana)
  hallazgos: Hallazgo[];
  plantilla: string[]; // resumen orientativo de la pauta de plantilla que sugieren los hallazgos
  muestraInsuficiente: boolean;
};

type Pt = { x: number; y: number; v: number };
const MIN_APOYO = 8; // frames mínimos en apoyo monopodal por lado para dar una cifra

function pt(f: MarchaFrame, i: number, w: number, h: number): Pt {
  return { x: f.p[i * 3] * w, y: f.p[i * 3 + 1] * h, v: f.p[i * 3 + 2] };
}
const ok = (...ps: Pt[]) => ps.every((q) => q.v > 0.4);
const deg = (r: number) => (r * 180) / Math.PI;
function percentil(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)));
  return Math.round(s[k] * 10) / 10;
}
const mediana = (xs: number[]) => percentil(xs, 0.5);

// Ángulo frontal de la rodilla de la pierna en apoyo: desviación respecto a la
// línea cadera→tobillo; positivo si la rodilla se mete hacia la línea media.
function rodillaFrontal(cadera: Pt, rodilla: Pt, tobillo: Pt, lineaMediaX: number): number {
  const v1x = cadera.x - rodilla.x, v1y = cadera.y - rodilla.y;
  const v2x = tobillo.x - rodilla.x, v2y = tobillo.y - rodilla.y;
  const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
  const desv = 180 - deg(Math.acos(Math.max(-1, Math.min(1, cos))));
  // ¿hacia dónde se desvía la rodilla respecto a la línea cadera→tobillo?
  const tY = (rodilla.y - cadera.y) / ((tobillo.y - cadera.y) || 1);
  const xLinea = cadera.x + (tobillo.x - cadera.x) * tY;
  const haciaMedia = Math.sign(lineaMediaX - rodilla.x) === Math.sign(rodilla.x - xLinea);
  return haciaMedia ? desv : -desv;
}

export function analizarMarcha(track: MarchaTrack): MarchaInforme {
  const { w, h, frames, vista } = track;
  const caida = { izq: [] as number[], dcha: [] as number[] };
  const rodilla = { izq: [] as number[], dcha: [] as number[] };
  const retro = { izq: [] as number[], dcha: [] as number[] };
  const prog = { izq: [] as number[], dcha: [] as number[] };
  const anchura: number[] = [];
  let apoyoIzq = 0, apoyoDcho = 0;

  for (const f of frames) {
    const cI = pt(f, I.caderaIzq, w, h), cD = pt(f, I.caderaDcha, w, h);
    const rI = pt(f, I.rodillaIzq, w, h), rD = pt(f, I.rodillaDcha, w, h);
    const tI = pt(f, I.tobilloIzq, w, h), tD = pt(f, I.tobilloDcho, w, h);
    const hI = pt(f, I.talonIzq, w, h), hD = pt(f, I.talonDcho, w, h);
    const pI = pt(f, I.puntaIzq, w, h), pD = pt(f, I.puntaDcha, w, h);
    if (!ok(cI, cD, tI, tD)) continue;
    const hipW = Math.abs(cI.x - cD.x);
    if (hipW < 4) continue;
    anchura.push(Math.abs(tI.x - tD.x) / hipW);
    // Apoyo monopodal: el tobillo más bajo en la imagen (mayor y) es el que apoya;
    // si están casi a la misma altura es doble apoyo y no se cuenta.
    const dif = (tI.y - tD.y) / hipW;
    const apoyo: "izq" | "dcha" | null = dif > 0.12 ? "izq" : dif < -0.12 ? "dcha" : null;
    if (!apoyo) continue;
    if (apoyo === "izq") apoyoIzq++; else apoyoDcho++;
    // Caída pélvica: inclinación de la línea de caderas; positiva si la cadera
    // del lado en el aire (contralateral) queda más baja que la del apoyo.
    const [cApoyo, cAire] = apoyo === "izq" ? [cI, cD] : [cD, cI];
    const tilt = deg(Math.atan2(cAire.y - cApoyo.y, Math.abs(cAire.x - cApoyo.x) || 1));
    caida[apoyo].push(tilt);
    // Rodilla frontal de la pierna en apoyo
    const lineaMediaX = (cI.x + cD.x) / 2;
    if (apoyo === "izq" && ok(rI)) rodilla.izq.push(rodillaFrontal(cI, rI, tI, lineaMediaX));
    if (apoyo === "dcha" && ok(rD)) rodilla.dcha.push(rodillaFrontal(cD, rD, tD, lineaMediaX));
    // Vista posterior: retropié en apoyo (tobillo → talón respecto a la vertical;
    // + si el talón cae hacia fuera = eversión/valgo). Desde atrás, la pierna
    // derecha del paciente está a la derecha de la imagen.
    if (vista === "posterior") {
      if (apoyo === "izq" && ok(hI)) retro.izq.push(-deg(Math.atan2(hI.x - tI.x, hI.y - tI.y)));
      if (apoyo === "dcha" && ok(hD)) retro.dcha.push(deg(Math.atan2(hD.x - tD.x, hD.y - tD.y)));
    }
    // Vista anterior: ángulo de progresión del pie en apoyo (talón → dedos respecto
    // al eje de avance; + toe-out). De frente, la pierna derecha queda a la izquierda.
    if (vista === "anterior") {
      if (apoyo === "izq" && ok(hI, pI)) prog.izq.push(deg(Math.atan2(pI.x - hI.x, Math.abs(pI.y - hI.y) || 1)));
      if (apoyo === "dcha" && ok(hD, pD)) prog.dcha.push(-deg(Math.atan2(pD.x - hD.x, Math.abs(pD.y - hD.y) || 1)));
    }
  }

  const val = (xs: number[], n: number, q: number) => (n >= MIN_APOYO ? percentil(xs, q) : null);
  const informe: MarchaInforme = {
    vista,
    framesTotales: frames.length,
    apoyoIzq,
    apoyoDcho,
    caidaPelvica: { izq: val(caida.izq, apoyoIzq, 0.8), dcha: val(caida.dcha, apoyoDcho, 0.8) },
    rodillaFrontal: { izq: val(rodilla.izq, apoyoIzq, 0.8), dcha: val(rodilla.dcha, apoyoDcho, 0.8) },
    retropie: { izq: val(retro.izq, apoyoIzq, 0.8), dcha: val(retro.dcha, apoyoDcho, 0.8) },
    progresion: { izq: val(prog.izq, apoyoIzq, 0.5), dcha: val(prog.dcha, apoyoDcho, 0.5) },
    anchuraPaso: mediana(anchura),
    hallazgos: [],
    plantilla: [],
    muestraInsuficiente: apoyoIzq < MIN_APOYO || apoyoDcho < MIN_APOYO,
  };
  informe.hallazgos = hallazgosDe(informe);
  informe.plantilla = pautaPlantilla(informe);
  return informe;
}

const f1 = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 1 });

// Reglas orientativas (umbrales habituales en la observación clínica).
function hallazgosDe(m: MarchaInforme): Hallazgo[] {
  const out: Hallazgo[] = [];
  const lados: ["izq" | "dcha", string][] = [["izq", "izquierda"], ["dcha", "derecha"]];
  for (const [k, nombre] of lados) {
    const cp = m.caidaPelvica[k];
    if (cp !== null && cp > 5)
      out.push({
        clave: `trendelenburg_${k}`,
        titulo: `Caída pélvica en apoyo sobre la pierna ${nombre} (${f1(cp)}°)`,
        detalle: "Compatible con signo de Trendelenburg: posible insuficiencia de abductores de cadera (glúteo medio) del lado en apoyo. Valorar fuerza de cadera.",
        plantilla: `La caída pélvica no se corrige con la plantilla: derivar a fortalecimiento de glúteo medio. En la plantilla, dar estabilidad al retropié ${nombre} (talonera envolvente) y, si hay pronación asociada, posteado medial suave. Comprobar dismetría antes de decidir alza.`,
        gravedad: cp > 8 ? "revisar" : "leve",
      });
    const rf = m.rodillaFrontal[k];
    if (rf !== null && rf > 10)
      out.push({
        clave: `valgo_rodilla_${k}`,
        titulo: `Valgo dinámico de rodilla ${nombre} (${f1(rf)}°)`,
        detalle: "La rodilla se mete hacia la línea media en apoyo: colapso medial, frecuentemente asociado a pronación del pie y a debilidad de cadera. Correlacionar con el retropié y el navicular drop.",
        plantilla: `Control de pronación en la plantilla ${nombre}: posteado medial de retropié (${rf > 15 ? "4-6" : "2-4"}°), soporte firme del arco longitudinal interno y talonera profunda; valorar extensión medial del talón (Kirby). Material semirrígido.`,
        gravedad: rf > 15 ? "revisar" : "leve",
      });
    if (rf !== null && rf < -8)
      out.push({
        clave: `varo_rodilla_${k}`,
        titulo: `Varo dinámico de rodilla ${nombre} (${f1(-rf)}°)`,
        detalle: "La rodilla se abre hacia fuera en apoyo (empuje en varo). Valorar retropié varo / pie cavo-supinado y alineación tibial.",
        plantilla: `Plantilla ${nombre} con posteado lateral de retropié (2-4°) y amortiguación en el borde externo; no añadir soporte de arco agresivo ni cuña medial. Material más blando.`,
        gravedad: "leve",
      });
    const rp = m.retropie[k];
    if (rp !== null && rp > 8)
      out.push({
        clave: `eversion_${k}`,
        titulo: `Eversión del retropié ${nombre} en apoyo (${f1(rp)}°)`,
        detalle: "Talón en valgo durante el apoyo: posible pronación excesiva del retropié. Contrastar con la foto posterior (Helbing / Perthes en estático).",
        plantilla: `Retropié ${nombre}: cuña supinadora / posteado medial de ${rp > 12 ? "4-6" : "2-4"}° con talonera profunda y envolvente, más soporte del arco longitudinal interno. Si la eversión es alta, valorar extensión medial del talón (Kirby) y material semirrígido.`,
        gravedad: rp > 12 ? "revisar" : "leve",
      });
    if (rp !== null && rp < -5)
      out.push({
        clave: `inversion_${k}`,
        titulo: `Inversión del retropié ${nombre} en apoyo (${f1(-rp)}°)`,
        detalle: "Talón en varo durante el apoyo: posible pie supinado / retropié varo. Valorar test de Coleman y estabilidad lateral de tobillo.",
        plantilla: `Retropié ${nombre}: cuña pronadora / posteado lateral de 2-3° y amortiguación en talón y borde externo; si el test de Coleman es positivo (antepié rígido), posteado lateral también en antepié o descarga bajo el 1.er metatarsiano. Evitar soporte de arco alto.`,
        gravedad: "leve",
      });
    const pg = m.progresion[k];
    if (pg !== null && pg > 18)
      out.push({
        clave: `toeout_${k}`,
        titulo: `Ángulo de progresión aumentado, pie ${nombre} (${f1(pg)}° hacia fuera)`,
        detalle: "Marcha en abducción (toe-out) por encima de lo habitual (5-15°). Puede relacionarse con torsión tibial externa, retroversión femoral o pronación compensadora.",
        plantilla: `Si es de origen torsional no se corrige con plantilla. Si acompaña a pronación, control del retropié ${nombre} (posteado medial 2-4°) y soporte de arco; valorar prolongar el soporte medial hasta el antepié.`,
        gravedad: "leve",
      });
    if (pg !== null && pg < -5)
      out.push({
        clave: `toein_${k}`,
        titulo: `Marcha en aducción, pie ${nombre} (${f1(-pg)}° hacia dentro)`,
        detalle: "Intoeing: valorar torsión tibial interna, anteversión femoral o metatarso aducto.",
        plantilla: `En adulto no se corrige con plantilla; en la plantilla ${nombre} priorizar confort y amortiguación lateral, y si hay supinación compensadora, posteado lateral suave. En niños, derivar a valoración ortopédica.`,
        gravedad: "leve",
      });
  }
  const asim = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.abs(a - b) : 0);
  if (asim(m.caidaPelvica.izq, m.caidaPelvica.dcha) > 5 || asim(m.rodillaFrontal.izq, m.rodillaFrontal.dcha) > 6 || asim(m.retropie.izq, m.retropie.dcha) > 6)
    out.push({
      clave: "asimetria",
      titulo: "Asimetría izquierda/derecha",
      detalle: "Diferencia relevante entre lados en pelvis, rodilla o retropié. Descartar dismetría (ver láminas) y patología unilateral.",
      plantilla: "Plantillas asimétricas: posteados distintos en cada lado según los hallazgos por pierna. Comprobar dismetría con láminas y, si la hay, alza en el lado corto (la mitad de la diferencia como punto de partida).",
      gravedad: "revisar",
    });
  if (m.anchuraPaso !== null && m.anchuraPaso > 1.6)
    out.push({
      clave: "base_ancha",
      titulo: `Base de marcha ancha (tobillos a ${f1(m.anchuraPaso)}× la anchura de caderas)`,
      detalle: "Aumento de la base de sustentación: valorar inestabilidad, equilibrio o compensación de dolor.",
      plantilla: "Priorizar estabilidad: talonera envolvente y profunda, material firme y plantilla de longitud completa; evitar posteados agresivos que aumenten la inestabilidad.",
      gravedad: "info",
    });
  if (m.muestraInsuficiente)
    out.push({
      clave: "muestra",
      titulo: "Muestra insuficiente para alguna cifra",
      detalle: `Pocos fotogramas en apoyo monopodal (izq. ${m.apoyoIzq}, dcha. ${m.apoyoDcho}). Las cifras que faltan requieren más pasos en plano o mejor detección.`,
      plantilla: "No basar la pauta en este vídeo: repetir con más pasos en plano o apoyarse en la exploración y la baropodometría.",
      gravedad: "info",
    });
  if (out.length === 0)
    out.push({
      clave: "sin_hallazgos",
      titulo: "Sin hallazgos por encima de los umbrales",
      detalle: "Pelvis, rodillas y retropié dentro de los rangos habituales en este vídeo. Sigue siendo necesaria la valoración clínica.",
      plantilla: "Desde esta vista no se justifican posteados correctores: plantilla de confort/descarga según el motivo de consulta, el cuestionario y la baropodometría.",
      gravedad: "info",
    });
  return out;
}

// Resumen por lado de lo que sugieren los hallazgos para la plantilla.
function pautaPlantilla(m: MarchaInforme): string[] {
  const out: string[] = [];
  const lados: ["izq" | "dcha", string][] = [["izq", "Izquierda"], ["dcha", "Derecha"]];
  for (const [k, nombre] of lados) {
    const rp = m.retropie[k];
    const rf = m.rodillaFrontal[k];
    const pron = (rp !== null && rp > 8) || (rf !== null && rf > 10);
    const sup = (rp !== null && rp < -5) || (rf !== null && rf < -8);
    if (pron) {
      const fuerte = (rp !== null && rp > 12) || (rf !== null && rf > 15);
      out.push(`${nombre}: control de pronación — posteado medial de retropié ${fuerte ? "4-6" : "2-4"}°, soporte del arco interno, talonera profunda${fuerte ? ", valorar Kirby" : ""}.`);
    } else if (sup) {
      out.push(`${nombre}: pie supinado — posteado lateral de retropié 2-3°, amortiguación en talón y borde externo, sin arco alto.`);
    } else if (!m.muestraInsuficiente) {
      out.push(`${nombre}: retropié y rodilla en rango — sin posteado corrector desde esta vista; plantilla de confort/descarga.`);
    }
  }
  if (m.hallazgos.some((h) => h.clave === "asimetria"))
    out.push("Posteados distintos por lado y comprobar dismetría (alza en el lado corto si procede).");
  if (m.hallazgos.some((h) => h.clave.startsWith("trendelenburg")))
    out.push("La caída pélvica se trabaja con fortalecimiento de cadera, no con la plantilla.");
  if (m.hallazgos.some((h) => h.clave === "muestra"))
    out.push("Muestra insuficiente en alguna pierna: confirmar con exploración y baropodometría antes de fijar la pauta.");
  return out;
}

// Saneado de lo que llega del navegador (track + informe recalculado en servidor).
const MAX_FRAMES = 400;
export function sanitizeMarcha(raw: unknown): { track: MarchaTrack; informe: MarchaInforme } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const t = r.track as Record<string, unknown> | undefined;
  if (!t || typeof t !== "object") return undefined;
  const vista = t.vista === "posterior" || t.vista === "anterior" ? t.vista : null;
  const w = typeof t.w === "number" && t.w > 0 ? t.w : null;
  const h = typeof t.h === "number" && t.h > 0 ? t.h : null;
  if (!vista || !w || !h || !Array.isArray(t.frames)) return undefined;
  const frames: MarchaFrame[] = [];
  for (const f of (t.frames as unknown[]).slice(0, MAX_FRAMES)) {
    if (!f || typeof f !== "object") continue;
    const ff = f as Record<string, unknown>;
    if (typeof ff.t !== "number" || !Array.isArray(ff.p) || ff.p.length !== MARCHA_IDX.length * 3) continue;
    if (!ff.p.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    frames.push({ t: Math.round(ff.t * 1000) / 1000, p: (ff.p as number[]).map((n) => Math.round(n * 10000) / 10000) });
  }
  if (frames.length < 5) return undefined;
  const track: MarchaTrack = { vista, w, h, frames };
  return { track, informe: analizarMarcha(track) }; // el informe se recalcula aquí, nunca se confía en el del cliente
}
