// Expediente del pedido en texto para Ortosend Taller (programa del taller): la receta, las capturas
// del estudio (vídeos y fotos con su análisis) y el cuestionario y la exploración. Es lo mismo que el
// taller ve en la web («Expediente clínico completo»), con las mismas etiquetas.
import type { Case, MediaAsset, Patient, Prescription, User } from "@prisma/client";
import { titularDe } from "./cases";
import { questionnaireLines, type Questionnaire } from "./questionnaire";
import { examLines, type Exam } from "./exploracion";
import { alertasDe } from "./tests-podologicos";
import { CAPTURA_VISUAL, MEDIA_LABEL, SCAN_KIND } from "./format";
import { helbingResumen, type Helbing } from "./helbing";
import type { MarchaInforme } from "./marcha";
import { nombreProyectoRevoScan } from "./scan";

export function recetaJson(caseId: string, rx: Prescription | null) {
  if (!rx) return null;
  return {
    prescriptor: rx.prescriberName,
    colegiado: rx.collegiateNum,
    firmada: rx.signedAt?.toISOString() ?? null,
    valoracion: rx.assessment,
    diagnostico: rx.diagnosis,
    pauta: rx.fabricationOrder,
    pautaIzq: rx.orderLeft ?? null,
    pautaDcha: rx.orderRight ?? null,
    pautaUso: rx.usageGuidelines,
    contacto: rx.contactNotes ?? null,
    pdf: rx.pdfBytes ? `/api/rx-pdf/${caseId}` : null,
  };
}

const grados = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-ES")}°`);

// Informe preliminar de un vídeo de marcha, en líneas de texto.
export function informeMarchaTexto(inf: MarchaInforme): string[] {
  if (inf.muestraInsuficiente) return ["Muestra insuficiente para medir (el paciente sale poco tiempo en apoyo)."];
  const out: string[] = [];
  if (inf.vista === "posterior") {
    out.push(`Retropié en apoyo: dcha. ${grados(inf.retropie.dcha)} · izq. ${grados(inf.retropie.izq)} (+ eversión / − inversión)`);
    out.push(`Caída pélvica en apoyo: dcha. ${grados(inf.caidaPelvica.dcha)} · izq. ${grados(inf.caidaPelvica.izq)}`);
  } else {
    out.push(`Ángulo de progresión: dcha. ${grados(inf.progresion.dcha)} · izq. ${grados(inf.progresion.izq)} (+ hacia fuera / − hacia dentro)`);
  }
  out.push(`Rodilla en el plano frontal: dcha. ${grados(inf.rodillaFrontal.dcha)} · izq. ${grados(inf.rodillaFrontal.izq)} (+ valgo / − varo)`);
  for (const h of inf.hallazgos) out.push(`${h.titulo}: ${h.detalle}${h.plantilla ? ` → Plantilla: ${h.plantilla}` : ""}`);
  if (inf.plantilla.length) out.push(`Sugerencia para la plantilla: ${inf.plantilla.join("; ")}`);
  return out;
}

type Meta = {
  seconds?: number;
  helbing?: Helbing;
  perthes?: Helbing;
  marcha?: { informe: MarchaInforme };
  mime?: string;
} | null;

// Vídeos y fotos del estudio (solo los subidos y confirmados), con su análisis en texto.
export function estudioJson(media: MediaAsset[]) {
  const orden = CAPTURA_VISUAL.map(([k]) => k as string);
  return media
    .filter((m) => m.confirmedAt && m.url.startsWith("/api/media/") && orden.includes(m.kind))
    .sort((a, b) => orden.indexOf(a.kind) - orden.indexOf(b.kind))
    .map((m) => {
      const meta = m.meta as Meta;
      const resumen: string[] = [];
      if (meta?.helbing) resumen.push(`Línea de Helbing (tendón de Aquiles): ${helbingResumen(meta.helbing)} (orientativa)`);
      if (meta?.perthes) resumen.push(`Regla de Perthes (eje del calcáneo): ${helbingResumen(meta.perthes)} (orientativa)`);
      if (meta?.marcha?.informe) resumen.push(...informeMarchaTexto(meta.marcha.informe));
      return {
        id: m.id,
        tipo: m.kind.startsWith("video_") ? "video" : "foto",
        etiqueta: MEDIA_LABEL[m.kind] ?? m.kind,
        url: m.url,
        mime: meta?.mime ?? null,
        segundos: meta?.seconds ?? null,
        resumen,
      };
    });
}

// Cuestionario, alertas y exploración en secciones de filas (etiqueta, valor).
export function expedienteSecciones(q: Questionnaire | null, e: Exam | null, motivo: string | null) {
  const secciones: { titulo: string; filas: [string, string][] }[] = [];
  const cuestionario = questionnaireLines(q);
  if (motivo) cuestionario.unshift(["Motivo indicado al reservar", motivo]);
  secciones.push({ titulo: "Cuestionario clínico", filas: cuestionario });
  const alertas = alertasDe(e);
  if (alertas.length) secciones.push({ titulo: "Hallazgos de alerta", filas: alertas.map((a) => ["⚠", a] as [string, string]) });
  secciones.push({ titulo: "Exploración biomecánica y tests", filas: examLines(e) });
  return secciones;
}

type PacienteEscaneo = Patient & { owner?: Pick<User, "name" | "phone" | "email"> | null };

// Nombre del proyecto de Revo Scan con el escaneo de las espumas (en la carpeta compartida de la clínica).
export function escaneoJson(kase: Pick<Case, "number">, paciente: PacienteEscaneo, media: MediaAsset[], clinica: string) {
  const marcado = media.find((m) => m.kind === SCAN_KIND && m.confirmedAt);
  if (!marcado) return null;
  const proyecto =
    (marcado.meta as { proyecto?: string } | null)?.proyecto ??
    nombreProyectoRevoScan(paciente.name, titularDe(paciente).phone, kase.number);
  return { proyecto, clinica };
}
