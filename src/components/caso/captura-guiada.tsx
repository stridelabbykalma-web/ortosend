import Link from "next/link";
import type { Capture, Case, Incident, MediaAsset, Patient } from "@prisma/client";
import { checklistOf } from "@/lib/cases";
import { BARO_KINDS, CAPTURA_VISUAL, FOTO_KINDS, SCAN_KIND, VIDEO_KINDS } from "@/lib/format";
import {
  ACTIVIDAD_OPTS,
  ANTECEDENTES_OPTS,
  CALZADO_OPTS,
  DESGASTE_OPTS,
  EVOLUCION_OPTS,
  HORAS_PIE_OPTS,
  LADO_OPTS,
  MOMENTO_OPTS,
  PLANTILLAS_OPTS,
  TIPO_SINTOMA_OPTS,
  TRATAMIENTOS_OPTS,
  ZONA_OPTS,
  type Questionnaire,
} from "@/lib/questionnaire";
import {
  ANGULO_PASO_OPTS,
  CONTACTO_OPTS,
  DESPEGUE_OPTS,
  LADO_CORTO_OPTS,
  LAMINA_OPTS,
  MARCHA_PATRON_OPTS,
  PRIMER_RADIO_OPTS,
  RETROPIE_OPTS,
  TIPO_PIE_OPTS,
  TOBILLO_OPTS,
  type Exam,
} from "@/lib/exploracion";
import {
  AVISO_VOLUMEN,
  COLEMAN_OPTS,
  ESTABILIDAD_OPTS,
  FORMULA_DIGITAL_OPTS,
  FORMULA_MTT_OPTS,
  HEEL_RISE_OPTS,
  JACK_OPTS,
  MAX_PRONACION_OPTS,
  NUCLEO,
  PALP_AQUILES_OPTS,
  PALP_CALCANEO_OPTS,
  POS_NEG_OPTS,
  RESIST_INV_OPTS,
  RESIST_SUP_OPTS,
  ROT_CADERA_OPTS,
  SINGLE_HEEL_OPTS,
  SQUAT_OPTS,
  STEP_DOWN_OPTS,
  TERRITORIO_OPTS,
  TESTS,
  TOO_MANY_TOES_OPTS,
  TRENDELENBURG_OPTS,
  alertasDe,
  complementariosCompletos,
  complementariosSugeridos,
  minutosDe,
  normalizaId,
  nucleoCompleto,
  ramasActivas,
  ramasSinCubrir,
  type TestId,
} from "@/lib/tests-podologicos";
import { nombreProyectoRevoScan } from "@/lib/scan";
import { CheckLine } from "@/components/ui";
import { RX_ROUTES, RX_ROUTE_HELP, RX_ROUTE_LABEL, type RxRoute } from "@/lib/rx-route";
import {
  autosaveSectionAction,
  chooseRxRouteAction,
  markMediaAction,
  saveExamSectionAction,
  saveQuestionnaireSectionAction,
  sendCaseAction,
} from "@/app/panel/clinica-actions";
import { CapturaStudio } from "./captura-studio";
import { CopiarTexto } from "./copiar-texto";
import { CAPTURE_GUIDES, durationLabel } from "@/lib/capture-guide";
import { AutosaveForm } from "./autosave-form";

type CaseWithCapture = Case & {
  patient: Patient & { owner?: { phone: string | null } | null };
  capture: (Capture & { media: MediaAsset[] }) | null;
  incidents: Incident[];
};

// --- Definición de las diapositivas del protocolo ---

type Slide =
  | { t: "q"; section: string; title: string; grupo: string }
  | { t: "e"; section: string; title: string; grupo: string }
  | { t: "media"; kind: string; title: string; grupo: string; help: string }
  | { t: "file"; kind: string; title: string; grupo: string; help: string; boton: string; hecho: string }
  | { t: "envio"; title: string; grupo: string };

// Para qué sirve cada captura de cámara. Cómo se hace (colocación, duración,
// checks de encuadre que valida MediaPipe) está en src/lib/capture-guide.ts.
const CAPTURA_META: Record<string, { grupo: string; help: string }> = {
  video_post_descalzo: {
    grupo: "Vídeos de marcha",
    help: "El paciente se aleja de la cámara, descalzo: retropié en dinámica (valgo/varo), eversión del calcáneo y compensaciones desde atrás.",
  },
  video_ant_descalzo: {
    grupo: "Vídeos de marcha",
    help: "El paciente viene hacia la cámara, descalzo: antepié, ángulo de paso, rótulas y alineamiento desde delante.",
  },
  foto_posterior: {
    grupo: "Fotos",
    help: "Primer plano de los talones desde atrás, en carga. Sobre esta foto se valora la inclinación del retropié comparando el eje del calcáneo con la vertical de la pierna.",
  },
  foto_anterior: {
    grupo: "Fotos",
    help: "Primer plano de los pies desde delante, en carga: dedos, antepié y tobillos (hallux, dedos en garra, antepié aducto/abducto).",
  },
};

function buildSlides(): Slide[] {
  const slides: Slide[] = [
    { t: "q", section: "motivo", title: "Motivo de consulta y dolor", grupo: "Cuestionario" },
    { t: "q", section: "zonas", title: "Dónde y cuándo duele", grupo: "Cuestionario" },
    { t: "q", section: "actividad", title: "Actividad y datos físicos", grupo: "Cuestionario" },
    { t: "q", section: "calzado", title: "Calzado y plantillas", grupo: "Cuestionario" },
    { t: "q", section: "antecedentes", title: "Antecedentes y tratamientos", grupo: "Cuestionario" },
    { t: "e", section: "movilidad", title: "Tipo de pie y observaciones", grupo: "Exploración" },
    { t: "e", section: "nucleo", title: `Tests generales (los ${NUCLEO.length} de siempre)`, grupo: "Exploración" },
    { t: "e", section: "comp_sel", title: "Tests complementarios: cuáles hacer", grupo: "Exploración" },
    { t: "e", section: "comp_res", title: "Tests complementarios: resultados", grupo: "Exploración" },
    { t: "e", section: "dismetria", title: "Dismetría: nivel y láminas", grupo: "Exploración" },
    // Con el paciente delante se termina primero la parte «de consulta» (cuestionario,
    // exploración y vídeos); las máquinas (escáner y Podisense) quedan para el final.
    ...CAPTURA_VISUAL.map(([kind, label]) => {
      const m = CAPTURA_META[kind];
      return { t: "media", kind, title: label, grupo: m.grupo, help: m.help } as Slide;
    }),
    // El análisis de la marcha va DESPUÉS de los vídeos: lo rellena el informe de
    // los vídeos posterior y anterior y el profesional solo revisa y completa.
    { t: "e", section: "marcha", title: "Análisis de la marcha (prellenado por los vídeos)", grupo: "Exploración" },
    {
      t: "file",
      kind: "baro_est",
      title: "Baropodometría estática",
      grupo: "Baropodometría",
      help: "Haz la captura estática en el programa del Podisense (paciente quieto, 10 segundos) y marca aquí que está hecha, adjuntando la exportación si la tienes.",
      boton: "Marcar estática como hecha",
      hecho: "Baropodometría estática registrada.",
    },
    {
      t: "file",
      kind: "baro_din_multi",
      title: "Baropodometría dinámica múltiple",
      grupo: "Baropodometría",
      help: "Haz el registro dinámico múltiple en el programa del Podisense (varias pasadas seguidas) y márcalo aquí como hecho, adjuntando la exportación si la tienes.",
      boton: "Marcar dinámica múltiple como hecha",
      hecho: "Baropodometría dinámica múltiple registrada.",
    },
    {
      t: "file",
      kind: SCAN_KIND,
      title: "Escaneo de las espumas fenólicas",
      grupo: "Escaneo",
      help: "Toma el molde en las espumas fenólicas y escanéalo con Revo Scan, guardando el proyecto con el nombre que se indica. El taller lo abre desde la carpeta compartida y lo procesa. Es el último paso del estudio.",
      boton: "Marcar escaneo como hecho",
      hecho: "Escaneo de las espumas registrado.",
    },
    { t: "envio", title: "Revisión y envío", grupo: "Envío" },
  ];
  return slides;
}

const SLIDES = buildSlides();

// ¿Está completada una diapositiva con los datos guardados?
function slideDone(s: Slide, q: Questionnaire | null, e: Exam | null, has: (k: string) => boolean): boolean {
  if (s.t === "q") {
    if (!q) return false;
    if (q.done) return true;
    const key = { motivo: "motivo", zonas: "zonas", actividad: "horasPie", calzado: "desgaste", antecedentes: "tratamientosPrevios" }[
      s.section
    ] as keyof Questionnaire;
    return key !== undefined && key in q;
  }
  if (s.t === "e") {
    if (!e) return false;
    if (e.done) return true;
    if (s.section === "nucleo") return nucleoCompleto(e);
    // Elegir es una decisión, no un dato: se da por hecha cuando toda rama
    // activa tiene ya algún test que la cubra.
    if (s.section === "comp_sel") return ramasSinCubrir(q, e).length === 0;
    if (s.section === "comp_res") return complementariosCompletos(e);
    const key = { movilidad: "tipoPie", dismetria: "dismetria", marcha: "marchaPatron" }[
      s.section
    ] as keyof Exam | undefined;
    return key !== undefined && key in e;
  }
  if (s.t === "media" || s.t === "file") return has(s.kind);
  return false;
}

const Sel = ({
  name,
  label,
  opts,
  def,
  empty,
}: {
  name: string;
  label: string;
  opts: readonly string[];
  def?: string;
  empty?: boolean;
}) => (
  <div>
    <label>{label}</label>
    <select name={name} defaultValue={def ?? (empty ? "" : opts[0])}>
      {empty && <option value="">—</option>}
      {opts.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  </div>
);

const Num = ({
  name,
  label,
  def,
  min,
  max,
  step,
  ph,
}: {
  name: string;
  label: string;
  def?: string;
  min: number;
  max: number;
  step?: string;
  ph?: string;
}) => (
  <div>
    <label>{label}</label>
    <input name={name} type="number" min={min} max={max} step={step} placeholder={ph} defaultValue={def} />
  </div>
);

const Checks = ({ name, opts, def }: { name: string; opts: readonly string[]; def?: string[] }) => (
  <div className="grid g3">
    {opts.map((o) => (
      <label className="chk" key={o}>
        <input type="checkbox" name={name} value={o} defaultChecked={def?.includes(o)} /> {o}
      </label>
    ))}
  </div>
);

// Campos de resultado de cada test complementario. Todo tiene respuesta
// cerrada (opciones o unidades): nada de texto libre, para que lo que llega al
// prescriptor sea comparable entre clínicas.
function CompCampos({ id, e }: { id: TestId; e: Exam | null }) {
  const dos = (a: React.ReactNode, b: React.ReactNode) => <div className="grid g2">{a}{b}</div>;
  switch (id) {
    case "double_heel_rise":
      return <Sel name="heelRise" label="Resultado" opts={HEEL_RISE_OPTS} def={e?.heelRise} />;
    case "max_pronacion":
      return dos(
        <Sel name="maxPronIzq" label="Pie izquierdo" opts={MAX_PRONACION_OPTS} def={e?.maxPronIzq} />,
        <Sel name="maxPronDcho" label="Pie derecho" opts={MAX_PRONACION_OPTS} def={e?.maxPronDcho} />
      );
    case "nav_drift":
      return dos(
        <Num name="navDriftIzq" label="Pie izquierdo (mm)" def={e?.navDriftIzq} min={0} max={30} ph="8" />,
        <Num name="navDriftDcho" label="Pie derecho (mm)" def={e?.navDriftDcho} min={0} max={30} ph="8" />
      );
    case "too_many_toes":
      return <Sel name="tooManyToes" label="Vista posterior" opts={TOO_MANY_TOES_OPTS} def={e?.tooManyToes} />;
    case "resist_inversion":
      return <Sel name="resistInversion" label="Resultado" opts={RESIST_INV_OPTS} def={e?.resistInversion} />;
    case "coleman":
      return <Sel name="coleman" label="Resultado" opts={COLEMAN_OPTS} def={e?.coleman} />;
    case "balance_mono":
      return dos(
        <Num name="balanceIzq" label="Apoyo izquierdo (s)" def={e?.balanceIzq} min={0} max={60} ph="30" />,
        <Num name="balanceDcho" label="Apoyo derecho (s)" def={e?.balanceDcho} min={0} max={60} ph="30" />
      );
    case "single_leg_squat":
      return <Sel name="singleLegSquat" label="Resultado" opts={SQUAT_OPTS} def={e?.singleLegSquat} />;
    case "step_down":
      return <Sel name="stepDown" label="Resultado" opts={STEP_DOWN_OPTS} def={e?.stepDown} />;
    case "trendelenburg":
      return <Sel name="trendelenburg" label="Resultado" opts={TRENDELENBURG_OPTS} def={e?.trendelenburg} />;
    case "rot_cadera":
      return <Sel name="rotCadera" label="Resultado" opts={ROT_CADERA_OPTS} def={e?.rotCadera} />;
    case "dorsiflex_1mtf":
      return dos(
        <Num name="dorsi1mtfIzq" label="Pie izquierdo (grados)" def={e?.dorsi1mtfIzq} min={0} max={90} ph="65" />,
        <Num name="dorsi1mtfDcho" label="Pie derecho (grados)" def={e?.dorsi1mtfDcho} min={0} max={90} ph="65" />
      );
    case "silfverskiold":
      return <Sel name="tobillo" label="Flexión dorsal de tobillo" opts={TOBILLO_OPTS} def={e?.tobillo} />;
    case "primer_radio":
      return <Sel name="primerRadio" label="Primer radio" opts={PRIMER_RADIO_OPTS} def={e?.primerRadio} />;
    case "formula_metatarsal":
      return dos(
        <Sel name="formulaMetatarsal" label="Fórmula metatarsal" opts={FORMULA_MTT_OPTS} def={e?.formulaMetatarsal} />,
        <Sel name="formulaDigital" label="Fórmula digital" opts={FORMULA_DIGITAL_OPTS} def={e?.formulaDigital} />
      );
    case "compresion_mtt":
      return <Sel name="compresionMtt" label="Resultado" opts={POS_NEG_OPTS} def={e?.compresionMtt} />;
    case "mulder":
      return <Sel name="mulder" label="Resultado" opts={POS_NEG_OPTS} def={e?.mulder} />;
    case "compresion_calcaneo":
      return <Sel name="compresionCalcaneo" label="Resultado" opts={POS_NEG_OPTS} def={e?.compresionCalcaneo} />;
    case "palpacion_calcaneo":
      return <Sel name="palpacionCalcaneo" label="Resultado" opts={PALP_CALCANEO_OPTS} def={e?.palpacionCalcaneo} />;
    case "palpacion_aquiles":
      return <Sel name="palpacionAquiles" label="Resultado" opts={PALP_AQUILES_OPTS} def={e?.palpacionAquiles} />;
    case "thompson":
      return <Sel name="thompson" label="Resultado" opts={POS_NEG_OPTS} def={e?.thompson} />;
    case "tinel":
      return <Sel name="tinel" label="Resultado" opts={POS_NEG_OPTS} def={e?.tinel} />;
    case "estabilidad_tobillo":
      return <Sel name="estabilidadTobillo" label="Resultado" opts={ESTABILIDAD_OPTS} def={e?.estabilidadTobillo} />;
    case "territorio_sensitivo":
      return <Sel name="territorioSensitivo" label="Territorio afectado" opts={TERRITORIO_OPTS} def={e?.territorioSensitivo} />;
    default:
      return null;
  }
}

// --- Formularios de cada sección (con los valores ya guardados como defaults) ---

function QSection({ section, q }: { section: string; q: Questionnaire | null }) {
  if (section === "motivo")
    return (
      <>
        <label>Motivo de consulta *</label>
        <input name="motivo" defaultValue={q?.motivo} placeholder="Ej.: dolor en talón derecho al levantarse, 3 meses" required />
        <div className="grid g3">
          <Sel name="evolucion" label="Tiempo de evolución" opts={EVOLUCION_OPTS} def={q?.evolucion || "1-3 meses"} />
          <div>
            <label>Intensidad del dolor (0-10) *</label>
            <select name="dolor" defaultValue={q?.dolor ?? "5"}>
              {Array.from({ length: 11 }, (_, i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
          <Sel name="lado" label="Lado afectado" opts={LADO_OPTS} def={q?.lado} />
        </div>
      </>
    );
  if (section === "zonas")
    return (
      <>
        <label>Zonas de dolor (marca todas las que apliquen)</label>
        <Checks name="zonas" opts={ZONA_OPTS} def={q?.zonas} />
        <div className="tiny">
          Cada zona activa después los tests que la valoran, así que conviene afinar: no es lo
          mismo la cara interna del tobillo que la externa.
        </div>
        <Sel name="tipoSintoma" label="Tipo de síntoma" opts={TIPO_SINTOMA_OPTS} def={q?.tipoSintoma} />
        <label>¿Cuándo aparece el dolor?</label>
        <Checks name="momentos" opts={MOMENTO_OPTS} def={q?.momentos} />
      </>
    );
  if (section === "actividad")
    return (
      <>
        <div className="grid g2">
          <Sel name="actividad" label="Nivel de actividad" opts={ACTIVIDAD_OPTS} def={q?.actividad || "Activo"} />
          <div>
            <label>Deporte principal y frecuencia</label>
            <input name="deporte" defaultValue={q?.deporte} placeholder="Ej.: running, 3 días/semana" />
          </div>
          <Sel name="horasPie" label="Horas de pie al día" opts={HORAS_PIE_OPTS} def={q?.horasPie || "4-8 h"} />
          <div>
            <label>Profesión / ocupación</label>
            <input name="profesion" defaultValue={q?.profesion} placeholder="Ej.: camarero, oficina…" />
          </div>
        </div>
        <div className="grid g3">
          <Num name="peso" label="Peso (kg)" def={q?.peso} min={20} max={250} step="0.1" ph="78" />
          <Num name="altura" label="Altura (cm)" def={q?.altura} min={100} max={230} ph="175" />
          <Num name="tallaCalzado" label="Talla de calzado (EU)" def={q?.tallaCalzado} min={30} max={52} step="0.5" ph="42" />
        </div>
      </>
    );
  if (section === "calzado")
    return (
      <>
        <label>Calzado habitual (marca todos los que apliquen)</label>
        <Checks name="calzado" opts={CALZADO_OPTS} def={q?.calzado} />
        <div className="grid g2">
          <Sel name="desgaste" label="Desgaste del calzado" opts={DESGASTE_OPTS} def={q?.desgaste} />
          <Sel name="plantillasPrevias" label="¿Ha usado plantillas antes?" opts={PLANTILLAS_OPTS} def={q?.plantillasPrevias} />
        </div>
      </>
    );
  return (
    <>
      <label>Antecedentes relevantes</label>
      <Checks name="antecedentes" opts={ANTECEDENTES_OPTS} def={q?.antecedentes} />
      <div className="grid g2">
        <div>
          <label>Detalle de antecedentes (lesión, cirugía, año…)</label>
          <input name="antecedentesDetalle" defaultValue={q?.antecedentesDetalle} placeholder="Ej.: esguince tobillo dcho. 2023" />
        </div>
        <div>
          <label>Medicación habitual relevante</label>
          <input name="medicacion" defaultValue={q?.medicacion} placeholder="Ej.: anticoagulantes, corticoides…" />
        </div>
      </div>
      <label>Tratamientos previos para este problema</label>
      <Checks name="tratamientosPrevios" opts={TRATAMIENTOS_OPTS} def={q?.tratamientosPrevios} />
      <label>Observaciones del profesional</label>
      <textarea name="observaciones" rows={2} defaultValue={q?.observaciones} placeholder="Cualquier dato relevante que no encaje arriba" />
    </>
  );
}

function ESection({ section, e, q }: { section: string; e: Exam | null; q: Questionnaire | null }) {
  if (section === "movilidad")
    return (
      <>
        <div className="grid g3">
          <Sel name="tipoPie" label="Tipo de pie" opts={TIPO_PIE_OPTS} def={e?.tipoPie} />
          <Num name="fpiIzq" label="FPI-6 pie izquierdo (opcional)" def={e?.fpiIzq} min={-12} max={12} ph="+4" />
          <Num name="fpiDcho" label="FPI-6 pie derecho (opcional)" def={e?.fpiDcho} min={-12} max={12} ph="+4" />
        </div>
        <div className="tiny">
          El tipo de pie y el FPI-6 activan las ramas de pie plano y pie cavo en los tests
          complementarios. FPI-6: 0 a +5 neutro · +6 a +9 pronado · +10 o más muy pronado ·
          negativo supinado.
        </div>
        <label style={{ marginTop: 12 }}>
          ¿Hay algo de movilidad o flexibilidad relevante para las plantillas? (opcional)
        </label>
        <textarea
          name="movilidadObs"
          rows={3}
          defaultValue={e?.movilidadObs}
          placeholder="Ej.: gemelos muy acortados, subastragalina rígida, hallux rígido, cadena posterior tensa…"
        />
        <div className="tiny">
          Lo que necesite un resultado cerrado (Silfverskiöld, primer radio, 1.ª MTF…) se anota en
          los tests complementarios, que salen según el cuadro.
        </div>
      </>
    );
  // Núcleo: los 5 que se hacen siempre. Van antes de elegir complementarios
  // para que sus resultados puedan orientar esa elección.
  if (section === "nucleo")
    return (
      <>
        <p className="muted" style={{ margin: "4px 0 10px" }}>
          Estos {NUCLEO.length} se hacen en todos los pacientes, duela lo que duela. Sus
          resultados se usan luego para proponer los complementarios.
        </p>
        <div className="tiny" style={{ marginTop: 12 }}>1 · JACK / HUBSCHER</div>
        <div className="grid g2">
          <Sel name="jackIzq" label="Pie izquierdo" opts={JACK_OPTS} def={e?.jackIzq} />
          <Sel name="jackDcho" label="Pie derecho" opts={JACK_OPTS} def={e?.jackDcho} />
        </div>
        <div className="tiny">Windlass: al dorsiflexionar el hallux debe formarse el arco.</div>

        <div className="tiny" style={{ marginTop: 12 }}>2 · NAVICULAR DROP</div>
        <div className="grid g2">
          <Num name="navDropIzq" label="Pie izquierdo (mm)" def={e?.navDropIzq} min={0} max={30} ph="6" />
          <Num name="navDropDcho" label="Pie derecho (mm)" def={e?.navDropDcho} min={0} max={30} ph="6" />
        </div>
        <div className="tiny">De neutro a apoyo relajado. Más de 10 mm se considera patológico.</div>

        <div className="tiny" style={{ marginTop: 12 }}>3 · RESISTENCIA A LA SUPINACIÓN</div>
        <div className="grid g2">
          <Sel name="resistSupIzq" label="Pie izquierdo" opts={RESIST_SUP_OPTS} def={e?.resistSupIzq} />
          <Sel name="resistSupDcho" label="Pie derecho" opts={RESIST_SUP_OPTS} def={e?.resistSupDcho} />
        </div>
        <div className="tiny">Alta resistencia → hace falta más cuña o posting medial en la plantilla.</div>

        <div className="tiny" style={{ marginTop: 12 }}>4 · LUNGE TEST / KNEE TO WALL</div>
        <div className="grid g2">
          <Num name="lungeIzq" label="Pie izquierdo (cm a la pared)" def={e?.lungeIzq} min={0} max={20} step="0.5" ph="10" />
          <Num name="lungeDcha" label="Pie derecho (cm a la pared)" def={e?.lungeDcha} min={0} max={20} step="0.5" ph="10" />
        </div>
        <div className="tiny">Sin despegar el talón. Menos de 9-10 cm sugiere restricción de flexión dorsal.</div>

        <div className="tiny" style={{ marginTop: 12 }}>5 · SINGLE HEEL RISE</div>
        <div className="grid g2">
          <Sel name="singleHeelIzq" label="Pie izquierdo" opts={SINGLE_HEEL_OPTS} def={e?.singleHeelIzq} />
          <Sel name="singleHeelDcho" label="Pie derecho" opts={SINGLE_HEEL_OPTS} def={e?.singleHeelDcho} />
        </div>
        <div className="tiny">
          Si el paciente no puede hacerlo, márcalo como tal: es un hallazgo en sí mismo y la app te
          propondrá el <b>Double Heel Rise</b> como alternativa en la pantalla siguiente.
        </div>
      </>
    );

  // Elegir complementarios: se agrupan por la rama que los pide, ya
  // deduplicados y con tope, para que elegir sea inmediato.
  if (section === "comp_sel") {
    const ramas = ramasActivas(q, e);
    const sugerencias = complementariosSugeridos(q, e);
    // Al entrar por primera vez no hay nada guardado, pero sí premarcado: el
    // aviso y el tiempo tienen que hablar de lo que se ve marcado en pantalla.
    const guardado = (e?.testsSel ?? []).map(normalizaId);
    const efectiva = guardado.length
      ? guardado
      : sugerencias.filter((x) => x.sugerido).map((x) => x.test.id);
    const sel = guardado;
    const sinCubrir = ramas
      .filter(({ rama }) => !rama.tests.some((id) => efectiva.includes(id)))
      .map(({ rama }) => rama.nombre);
    const minutos = minutosDe(efectiva as TestId[]);
    if (ramas.length === 0)
      return (
        <>
          <div className="note">
            Con lo anotado hasta ahora no se activa ninguna rama: no hay zonas de dolor marcadas ni
            un morfotipo que pida tests extra. Con los {NUCLEO.length} generales es suficiente, pero
            puedes añadir los que veas.
          </div>
          <div className="sp" />
          {TESTS.filter((t) => !NUCLEO.includes(t)).map((test) => (
            <label className="testcard" key={test.id}>
              <input type="checkbox" name="testsSel" value={test.id} defaultChecked={sel.includes(test.id)} />
              <div>
                <b>{test.nombre}</b>
                <div className="tiny" style={{ marginTop: 3 }}>{test.para}</div>
              </div>
            </label>
          ))}
        </>
      );
    return (
      <>
        <p className="muted" style={{ margin: "4px 0 10px" }}>
          Según el cuadro se activan estas ramas:{" "}
          <b>{ramas.map(({ rama }) => rama.nombre).join(" · ")}</b>. Cada rama necesita al menos un
          test que la valore. Nada se repite: lo que ya está en los generales o en la exploración no
          vuelve a salir.
        </p>
        {sinCubrir.length > 0 && (
          <div className="note a">
            Sin cubrir todavía: <b>{sinCubrir.join(", ")}</b>. Marca al menos un test de cada una.
          </div>
        )}
        {sugerencias.map(({ test, ramas: rs, motivos, sugerido }) => (
          <label className="testcard" key={test.id}>
            <input
              type="checkbox"
              name="testsSel"
              value={test.id}
              defaultChecked={sel.length ? sel.includes(test.id) : sugerido}
            />
            <div>
              <div className="row" style={{ gap: 8 }}>
                <b>{test.nombre}</b>
                {rs.length > 1 ? (
                  <span className="pill g">Sirve para {rs.length} ramas</span>
                ) : sugerido ? (
                  <span className="pill a">Sugerido</span>
                ) : (
                  <span className="pill n">Opcional</span>
                )}
                {test.alerta && <span className="pill r">Descarta bandera roja</span>}
              </div>
              <div className="tiny" style={{ marginTop: 3 }}>{test.para}</div>
              <div className="tiny">
                <b>Rama:</b> {rs.join(" · ")} · ~{test.minutos} min
              </div>
              {motivos.length > 0 && (
                <div className="tiny" style={{ color: "var(--green)" }}>
                  En este paciente: {motivos.join(", ")}.
                </div>
              )}
            </div>
          </label>
        ))}
        <div className="tiny" style={{ marginTop: 8 }}>
          Vienen premarcados los que propone la app. Los {NUCLEO.length} generales no aparecen aquí
          porque ya se han hecho. Tiempo estimado de lo marcado: ~{minutos} min
          {efectiva.length > AVISO_VOLUMEN && " — son bastantes pruebas para una sola visita"}.
        </div>
      </>
    );
  }

  // Resultados: solo los complementarios elegidos
  if (section === "comp_res") {
    const sel = (e?.testsSel ?? []).map(normalizaId);
    if (sel.length === 0)
      return (
        <div className="note">
          No has elegido ningún test complementario, así que aquí no hay nada que anotar. Con los{" "}
          {NUCLEO.length} generales el estudio sigue siendo válido: continúa a la dismetría.
        </div>
      );
    return (
      <>
        <p className="muted" style={{ margin: "4px 0 10px" }}>
          Anota el resultado de los {sel.length} tests complementarios que has elegido.
        </p>
        {TESTS.filter((t) => sel.includes(t.id)).map((t) => (
          <div key={t.id}>
            <div className="tiny" style={{ marginTop: 12 }}>
              {t.nombre.toUpperCase()}
              {t.alerta && " · HALLAZGO DE ALERTA SI ES POSITIVO"}
            </div>
            <CompCampos id={t.id} e={e} />
          </div>
        ))}
      </>
    );
  }
  if (section === "dismetria")
    return (
      <>
        <div className="grid g3">
          <Sel name="dismetria" label="¿Dismetría aparente?" opts={["No", "Sí"]} def={e?.dismetria} />
          <Sel name="ladoCorto" label="Pierna corta" opts={LADO_CORTO_OPTS} def={e?.ladoCorto} empty />
          <Sel name="lamina" label="Lámina que nivela la pelvis" opts={LAMINA_OPTS} def={e?.lamina} empty />
        </div>
        <label>Alza recomendada en plantilla (mm)</label>
        <input
          name="alza"
          type="number"
          min={0}
          max={20}
          placeholder="Ej.: 5"
          defaultValue={e?.alza && e.alza !== "No" ? e.alza : ""}
          style={{ maxWidth: 200 }}
        />
        <div className="tiny">
          Con el paciente de pie y nivel sobre las crestas ilíacas, añade láminas calibradas bajo la
          pierna corta hasta nivelar. La corrección inicial en plantilla suele ser parcial (50-75 %
          de la lámina) y se ajusta en revisiones.
        </div>
      </>
    );
  return (
    <>
      {e?.marchaAuto ? (
        <div className="note g" style={{ marginBottom: 10 }}>
          <b>Prellenado con el análisis de los vídeos de marcha.</b> Patrón, ángulo de paso y
          retropié vienen del informe de los vídeos posterior y anterior; revisa, corrige si no
          coincide con lo que has visto y completa contacto inicial y despegue observándolo en consulta.
        </div>
      ) : (
        <div className="note a" style={{ marginBottom: 10 }}>
          Aún no hay vídeos posterior y anterior analizados: al grabarlos, este apartado se
          rellena solo. Puedes rellenarlo a mano igualmente.
        </div>
      )}
      <div className="grid g3">
        <Sel name="marchaPatron" label="Patrón de pisada" opts={MARCHA_PATRON_OPTS} def={e?.marchaPatron} />
        <Sel name="contactoInicial" label="Contacto inicial" opts={CONTACTO_OPTS} def={e?.contactoInicial} />
        <Sel name="anguloPaso" label="Ángulo de progresión del paso" opts={ANGULO_PASO_OPTS} def={e?.anguloPaso} />
      </div>
      <div className="grid g2">
        <Sel name="retropieApoyo" label="Retropié en apoyo" opts={RETROPIE_OPTS} def={e?.retropieApoyo} />
        <Sel name="despegue" label="Despegue / propulsión" opts={DESPEGUE_OPTS} def={e?.despegue} />
      </div>
      <label>Observaciones de la marcha (asimetrías, claudicación, compensaciones…)</label>
      <textarea
        name="marchaObs"
        rows={e?.marchaAuto ? 6 : 2}
        defaultValue={e?.marchaObs}
        placeholder="Ej.: colapso del arco interno izquierdo en apoyo medio"
      />
      <div className="tiny">
        {e?.marchaAuto
          ? "Las cifras de las observaciones salen del análisis 2D de los vídeos (orientativo). Al guardar, quedan como valoración del profesional."
          : "La baropodometría completa esta valoración."}
      </div>
    </>
  );
}

// --- Componente principal: una prueba por pantalla ---

// Primera pantalla del caso: quién receta. De ello depende el protocolo.
function ElegirQuienReceta({
  kase,
  puedeRecetar,
}: {
  kase: CaseWithCapture;
  puedeRecetar: boolean;
}) {
  const actual = (kase.rxRoute as RxRoute | null) ?? null;
  return (
    <div className="slide-wrap">
      <div className="card slide-card">
        <h3 style={{ margin: "0 0 4px", fontFamily: "var(--font-sora)" }}>¿Quién receta este caso?</h3>
        <p className="muted" style={{ margin: "4px 0 10px" }}>
          Se decide antes de empezar, porque el estudio que hay que hacer depende de ello.
        </p>
        <form action={chooseRxRouteAction}>
          <input type="hidden" name="caseId" value={kase.id} />
          {puedeRecetar ? (
            RX_ROUTES.map((r) => (
              <label className="chk" key={r} style={{ alignItems: "flex-start" }}>
                <input type="radio" name="rxRoute" value={r} defaultChecked={(actual ?? "ORTOSEND") === r} required />{" "}
                <span>
                  {RX_ROUTE_LABEL[r]}
                  <span className="tiny" style={{ display: "block" }}>{RX_ROUTE_HELP[r]}</span>
                </span>
              </label>
            ))
          ) : (
            <>
              <input type="hidden" name="rxRoute" value="ORTOSEND" />
              <div className="note">Receta por parte del equipo de Ortosend.</div>
            </>
          )}
          <div className="sp" />
          <button type="submit" className="pri wfull">
            {actual ? "Guardar y continuar →" : "Empezar →"}
          </button>
        </form>
        {actual && (
          <div className="row between" style={{ marginTop: 14 }}>
            <Link className="tiny" href={`/caso/${kase.id}`}>
              ← Volver sin cambiar
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export async function CapturaGuiada({
  kase,
  paso,
  puedeRecetar = false,
  elegir = false,
}: {
  kase: CaseWithCapture;
  paso?: number;
  puedeRecetar?: boolean; // la clínica tiene un prescriptor con colegiación verificada
  elegir?: boolean; // volver a la pantalla de quién receta
}) {
  // Sin decidir quién receta no hay protocolo.
  if (!kase.rxRoute || elegir) return <ElegirQuienReceta kase={kase} puedeRecetar={puedeRecetar} />;
  // Receta propia (con o sin segunda opinión de Ortosend): mismo protocolo guiado,
  // pero cualquier prueba es elegible — solo el motivo de consulta es obligatorio.
  // El estudio completo con checklist bloqueante es el de la vía Ortosend.
  const propio = kase.rxRoute !== "ORTOSEND";
  const ruta = RX_ROUTE_LABEL[kase.rxRoute as RxRoute];

  const cp = kase.capture;
  const q = (cp?.questionnaire as Questionnaire | null) ?? null;
  const e = (cp?.physicalExam as Exam | null) ?? null;
  const media = cp?.media.filter((m) => m.confirmedAt) ?? [];
  const has = (k: string) => media.some((m) => m.kind === k);
  const cl = checklistOf(cp);
  const alertas = alertasDe(e);
  const repeat = kase.state === "DEVUELTO_CLINICA";
  const lastIncident = repeat
    ? [...kase.incidents].sort((a, b) => +b.createdAt - +a.createdAt).find((i) => i.type === "CAPTURA_INVALIDA")
    : null;

  // Receta propia: para enviar basta el motivo de consulta (primera pantalla).
  // El autoguardado crea la clave «motivo» con la primera tecla, así que se exige
  // que tenga texto: es lo mismo que comprueba el servidor al enviar.
  const motivoDone = !!q?.motivo?.trim();
  // Receta propia: obligatorios el motivo de consulta, la baropodometría (estática y
  // dinámica) y el escaneo de las espumas; el resto de pruebas son elegibles.
  const obligatoria = (s: Slide, i: number) =>
    i === 0 || (s.t === "file" && (s.kind === SCAN_KIND || BARO_KINDS.some(([k]) => k === s.kind)));
  const puedeEnviar = propio ? motivoDone && cl.baro && cl.escaneos : cl.completa;

  const doneFlags = SLIDES.map((s) => (s.t === "envio" ? puedeEnviar : slideDone(s, q, e, has)));
  const total = SLIDES.length;
  const firstPending = doneFlags.findIndex(
    (d, i) => !d && SLIDES[i].t !== "envio" && (!propio || obligatoria(SLIDES[i], i))
  );
  const continueAt = firstPending === -1 ? total : firstPending + 1;

  // --- Índice (sin ?paso): resumen del protocolo y continuar donde se quedó ---
  if (!paso || paso < 1 || paso > total) {
    return (
      <>
        {repeat ? (
          <div className="note r">
            <b>Caso devuelto:</b> {lastIncident?.reason ?? "repetir prueba indicada"}. Repite la
            prueba señalada y reenvía el estudio.
          </div>
        ) : propio ? (
          <div className="note">
            <b>{ruta}.</b> Obligatorios: el <b>motivo de consulta</b>, la{" "}
            <b>baropodometría</b> (estática y dinámica múltiple) y el <b>escaneo de las espumas</b>.
            El resto de pruebas son elegibles — haz únicamente las que necesites para tu valoración
            (vídeos guiados de 8-10 s como máximo). Al enviar, la receta la rellena y firma el prescriptor de vuestra
            clínica{kase.rxRoute === "REVISION" ? ", con la segunda opinión de Ortosend recibida" : ""}.
          </div>
        ) : (
          <div className="note">
            Protocolo guiado: una prueba por pantalla, con guardado automático mientras escribes
            (como en Drive). Puedes empezar en el PC y seguir desde el móvil o la tablet — siempre
            continúa por donde se quedó, sin perder nada.
          </div>
        )}
        <div className="sp" />
        <div className="card">
          <div className="row between">
            <b style={{ fontFamily: "var(--font-sora)" }}>
              {propio ? "Protocolo de receta propia" : "Protocolo de captura"}
            </b>
            <span className="tiny">
              {ruta} · <Link href={`/caso/${kase.id}?elegir=1`}>cambiar</Link>
            </span>
            <span className="pill n">
              {doneFlags.filter((d, j) => d && SLIDES[j].t !== "envio").length}/{total - 1} pruebas
            </span>
          </div>
          <div className="sp" />
          {SLIDES.map((s, i) => {
            const header = i === 0 || SLIDES[i - 1].grupo !== s.grupo;
            if (s.t === "envio") return null;
            return (
              <div key={i}>
                {header && (
                  <div className="tiny" style={{ margin: "10px 0 4px" }}>
                    {s.grupo.toUpperCase()}
                  </div>
                )}
                <Link href={`/caso/${kase.id}?paso=${i + 1}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <CheckLine ok={doneFlags[i]}>
                    {s.title}
                    {propio && obligatoria(s, i) && !doneFlags[i] && (
                      <span className="pill a">obligatorio</span>
                    )}
                    <span className="push tiny">
                      {doneFlags[i] ? "revisar" : propio && !obligatoria(s, i) ? "elegible →" : "hacer →"}
                    </span>
                  </CheckLine>
                </Link>
              </div>
            );
          })}
          <div className="sp" />
          <Link href={`/caso/${kase.id}?paso=${continueAt}`}>
            <button className="pri wfull" type="button">
              {doneFlags.some(Boolean) ? "Continuar donde se quedó →" : "Empezar el protocolo →"}
            </button>
          </Link>
        </div>
      </>
    );
  }

  // --- Diapositiva actual ---
  const i = paso - 1;
  const s = SLIDES[i];
  const prev = paso > 1 ? paso - 1 : null;
  const next = paso < total ? paso + 1 : null;
  const done = doneFlags[i];

  // Escaneo de las espumas: el proyecto de Revo Scan se guarda en la carpeta
  // compartida de la clínica con este nombre, y por él lo encuentra el taller.
  const nombreProyecto =
    s.t === "file" && s.kind === SCAN_KIND
      ? nombreProyectoRevoScan(kase.patient.name, kase.patient.owner?.phone, kase.number)
      : null;

  const navFooter = (
    <div className="row between" style={{ marginTop: 14 }}>
      <Link className="tiny" href={prev ? `/caso/${kase.id}?paso=${prev}` : `/caso/${kase.id}`}>
        ← {prev ? "Anterior" : "Índice"}
      </Link>
      <Link className="tiny" href={`/caso/${kase.id}`}>
        Índice del protocolo
      </Link>
      {next ? (
        <Link className="tiny" href={`/caso/${kase.id}?paso=${next}`}>
          Siguiente →
        </Link>
      ) : (
        <span />
      )}
    </div>
  );

  const hiddenNav = (section: string, block: "q" | "e") => (
    <>
      <input type="hidden" name="caseId" value={kase.id} />
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="block" value={block} />
      <input type="hidden" name="paso" value={paso} />
      <input type="hidden" name="next" value={next ?? ""} />
    </>
  );

  return (
    <div className="slide-wrap">
      <div className="slide-head">
        <div className="row between">
          <span className="tiny">
            {s.grupo.toUpperCase()} · PASO {paso} DE {total}
          </span>
          {done && s.t !== "envio" && <span className="pill g">✓ hecho</span>}
        </div>
        <div className="slide-bar">
          <div className="slide-bar-fill" style={{ width: `${Math.round((doneFlags.filter(Boolean).length / total) * 100)}%` }} />
        </div>
      </div>

      <div className="card slide-card">
        <h3 style={{ margin: "0 0 4px", fontFamily: "var(--font-sora)" }}>{s.title}</h3>

        {s.t === "q" && (
          <AutosaveForm action={saveQuestionnaireSectionAction} autosave={autosaveSectionAction}>
            {hiddenNav(s.section, "q")}
            <QSection section={s.section} q={q} />
            <div className="sp" />
            <button type="submit" className="pri wfull">
              Continuar →
            </button>
          </AutosaveForm>
        )}

        {s.t === "e" && (
          <AutosaveForm action={saveExamSectionAction} autosave={autosaveSectionAction}>
            {hiddenNav(s.section, "e")}
            <ESection section={s.section} e={e} q={q} />
            <div className="sp" />
            <button type="submit" className="pri wfull">
              Continuar →
            </button>
          </AutosaveForm>
        )}

        {s.t === "media" &&
          (done ? (
            <>
              <div className="note g">
                Prueba capturada y confirmada por el servidor. Puedes pasar a la siguiente.
              </div>
              <div className="sp" />
              <Link href={`/caso/${kase.id}?paso=${next ?? total}`}>
                <button className="pri wfull" type="button">
                  Siguiente →
                </button>
              </Link>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: "4px 0 10px" }}>
                {s.help}
              </p>
              <div className="tiny" style={{ marginBottom: 6 }}>
                {durationLabel(s.kind)}
                {CAPTURE_GUIDES[s.kind]?.mode === "video"
                  ? " · los checks de encuadre solo hacen falta para arrancar"
                  : " · deben verse los dos pies de cerca"}
              </div>
              <ul className="muted" style={{ margin: "0 0 12px 18px", padding: 0 }}>
                {CAPTURE_GUIDES[s.kind]?.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <CapturaStudio
                caseId={kase.id}
                kind={s.kind}
                label={s.title}
                autoStart
                nextHref={`/caso/${kase.id}?paso=${next ?? total}`}
              />
              <div className="tiny" style={{ marginTop: 8 }}>
                La cámara se abre a pantalla completa. MediaPipe comprueba el encuadre en vivo y el
                botón de grabar solo se activa con todo en verde; el check del protocolo aparece
                cuando el servidor confirma la subida.
              </div>
            </>
          ))}

        {s.t === "file" &&
          (done ? (
            <>
              <div className="note g">
                {s.hecho} Queda asociado a <b>{kase.patient.name}</b> (caso #{kase.number}).
                {nombreProyecto && (
                  <>
                    {" "}
                    Proyecto en Revo Scan: <b>{nombreProyecto}</b>.
                  </>
                )}
              </div>
              <div className="sp" />
              <Link href={`/caso/${kase.id}?paso=${next ?? total}`}>
                <button className="pri wfull" type="button">
                  Siguiente →
                </button>
              </Link>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: "4px 0 10px" }}>
                {s.help}
              </p>
              {nombreProyecto && (
                <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                  <div className="tiny muted">En Revo Scan, al crear el proyecto, ponle este nombre:</div>
                  <div className="row between" style={{ gap: 8, alignItems: "center", marginTop: 6 }}>
                    <b style={{ fontSize: 18 }}>{nombreProyecto}</b>
                    <CopiarTexto texto={nombreProyecto} />
                  </div>
                  <div className="tiny muted" style={{ marginTop: 6 }}>
                    Escanea y pulsa Parar. El proyecto se guarda en la carpeta compartida de la
                    clínica y el taller lo abre por ese nombre. No hay que exportar ni subir nada.
                  </div>
                </div>
              )}
              <form action={markMediaAction}>
                <input type="hidden" name="caseId" value={kase.id} />
                <input type="hidden" name="kind" value={s.kind} />
                <input type="hidden" name="next" value={next ?? ""} />
                <button type="submit" className="pri wfull">
                  {s.boton}
                </button>
              </form>
              <div className="tiny" style={{ marginTop: 8 }}>
                {nombreProyecto ? (
                  <>
                    Márcalo cuando el escaneo esté guardado con ese nombre: queda asociado a{" "}
                    <b>{kase.patient.name}</b> (caso #{kase.number}).
                  </>
                ) : (
                  <>
                    Se guardará asociado a <b>{kase.patient.name}</b> — caso #{kase.number}. No
                    hace falta renombrar el archivo: el nombre del paciente y el caso se añaden
                    solos.
                  </>
                )}
              </div>
            </>
          ))}

        {s.t === "envio" && (
          <>
            <p className="muted" style={{ margin: "4px 0 10px" }}>
              {propio
                ? "Receta propia: son obligatorios el motivo de consulta, la baropodometría y el escaneo de las espumas. Las demás pruebas son elegibles y se adjuntan las que hayas hecho."
                : "Checklist bloqueante del protocolo: sin todo en verde no hay envío a prescripción."}
            </p>
            {propio ? (
              <>
                <CheckLine ok={motivoDone}>Motivo de consulta y dolor (obligatorio)</CheckLine>
                <CheckLine ok={cl.cuestionario}>Cuestionario clínico completo (elegible)</CheckLine>
                <CheckLine ok={cl.exploracion}>Exploración y tests (elegible)</CheckLine>
                <CheckLine ok={cl.capturas > 0}>
                  Vídeos y fotos adjuntos: {cl.capturas}/{CAPTURA_VISUAL.length} (elegibles, máx. 10
                  s por vídeo)
                </CheckLine>
                <CheckLine ok={cl.baro}>Baropodometría estática + dinámica múltiple (obligatoria)</CheckLine>
                <CheckLine ok={cl.escaneos}>Escaneo de las espumas fenólicas (obligatorio)</CheckLine>
              </>
            ) : (
              <>
                <CheckLine ok={cl.cuestionario}>Cuestionario clínico (5 pantallas)</CheckLine>
                <CheckLine ok={cl.exploracion}>Exploración y tests (6 pantallas)</CheckLine>
                <CheckLine ok={cl.capturas >= CAPTURA_VISUAL.length}>
                  Vídeos y fotos {cl.capturas}/{CAPTURA_VISUAL.length} ({VIDEO_KINDS.length} vídeos de
                  marcha + {FOTO_KINDS.length} fotos de los pies de cerca)
                </CheckLine>
                <CheckLine ok={cl.baro}>Baropodometría (estática + dinámica múltiple)</CheckLine>
                <CheckLine ok={cl.escaneos}>Escaneo de las espumas fenólicas</CheckLine>
              </>
            )}
            {alertas.length > 0 && (
              <div className="note r" style={{ marginTop: 10 }}>
                <b>Hallazgos de alerta en la exploración</b> — se envían destacados al prescriptor,
                porque no se resuelven con una plantilla:
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {alertas.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {puedeEnviar ? (
              <form action={sendCaseAction}>
                <input type="hidden" name="caseId" value={kase.id} />
                <input type="hidden" name="paso" value={paso} />
                <div className="sp" />
                <div className="tiny">
                  Vía elegida al empezar: <b>{ruta.toLowerCase()}</b> (·{" "}
                  <Link href={`/caso/${kase.id}?elegir=1`}>cambiar</Link>).
                  {propio &&
                    (kase.rxRoute === "REVISION"
                      ? " Ortosend valorará el estudio y devolverá su segunda opinión; después la receta la rellena y firma el prescriptor de vuestra clínica, con su identidad y colegiación puestas automáticamente desde su perfil."
                      : " Al enviar, la receta (cómo deben ser las plantillas, qué deben llevar y qué función tienen) la rellena y firma el prescriptor de vuestra clínica, con su identidad y colegiación puestas automáticamente desde su perfil.")}
                </div>
                <div className="sp" />
                <button type="submit" className="pri wfull">
                  {repeat
                    ? "Reenviar caso a prescripción"
                    : propio
                      ? kase.rxRoute === "REVISION"
                        ? "Enviar a Ortosend para la segunda opinión"
                        : "Enviar y pasar a la receta"
                      : "Enviar caso a prescripción"}
                </button>
              </form>
            ) : (
              <>
                <div className="sp" />
                <Link href={`/caso/${kase.id}?paso=${continueAt}`}>
                  <button className="wfull" type="button">
                    {propio ? "Ir a la primera prueba obligatoria pendiente →" : "Ir a la primera prueba pendiente →"}
                  </button>
                </Link>
              </>
            )}
          </>
        )}

        {navFooter}
      </div>
    </div>
  );
}
