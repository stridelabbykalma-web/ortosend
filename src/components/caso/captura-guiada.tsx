import Link from "next/link";
import type { Capture, Case, Incident, MediaAsset, Patient } from "@prisma/client";
import { checklistOf } from "@/lib/cases";
import { SCAN_KIND, VIDEO_KINDS } from "@/lib/format";
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
  TRATAMIENTOS_OPTS,
  ZONA_OPTS,
  type Questionnaire,
} from "@/lib/questionnaire";
import {
  ANGULO_PASO_OPTS,
  CADENA_POSTERIOR_OPTS,
  CONTACTO_OPTS,
  DESPEGUE_OPTS,
  HALLUX_OPTS,
  LADO_CORTO_OPTS,
  LAMINA_OPTS,
  MARCHA_PATRON_OPTS,
  PRIMER_RADIO_OPTS,
  RETROPIE_OPTS,
  SUBASTRAGALINA_OPTS,
  TIPO_PIE_OPTS,
  TOBILLO_OPTS,
  type Exam,
} from "@/lib/exploracion";
import {
  HEEL_RISE_OPTS,
  JACK_OPTS,
  MAX_PRONACION_OPTS,
  MIN_TESTS,
  RESIST_SUP_OPTS,
  recomendarTests,
  testsCompletos,
  type TestId,
} from "@/lib/tests-podologicos";
import { CheckLine } from "@/components/ui";
import {
  autosaveSectionAction,
  markMediaAction,
  saveExamSectionAction,
  saveQuestionnaireSectionAction,
  sendCaseAction,
} from "@/app/panel/clinica-actions";
import { CamaraGuiada, type OverlayKind } from "./camara-guiada";
import { AutosaveForm } from "./autosave-form";

type CaseWithCapture = Case & {
  patient: Patient;
  capture: (Capture & { media: MediaAsset[] }) | null;
  incidents: Incident[];
};

// --- Definición de las diapositivas del protocolo ---

type Slide =
  | { t: "q"; section: string; title: string; grupo: string }
  | { t: "e"; section: string; title: string; grupo: string }
  | {
      t: "media";
      kind: string;
      title: string;
      grupo: string;
      overlay: OverlayKind;
      mode: "foto" | "video";
      checks: string[];
      help: string;
    }
  | { t: "file"; kind: string; title: string; grupo: string; help: string; boton: string; hecho: string }
  | { t: "envio"; title: string; grupo: string };

const VIDEO_META: Record<string, { overlay: OverlayKind; checks: string[]; help: string }> = {
  video_pie_post: {
    overlay: "pie_post",
    checks: [
      "El paciente va descalzo, de espaldas y quieto",
      "Se ve el cuerpo entero, centrado en la línea",
      "Pies a la anchura de las caderas, brazos relajados al costado",
      "Cámara en trípode a la altura de la cadera",
    ],
    help: "Bipedestación desde atrás: se valora la alineación del retropié (valgo/varo), las rodillas y la pelvis en estático.",
  },
  video_pie_ant: {
    overlay: "pie_ant",
    checks: [
      "El paciente va descalzo, de frente y quieto",
      "Se ve el cuerpo entero, centrado en el encuadre",
      "Pies a la anchura de las caderas, brazos relajados al costado",
      "Cámara en trípode a la altura de la cadera",
    ],
    help: "Bipedestación de frente: se valora el alineamiento de rodillas, rótulas y antepié, y la simetría en estático.",
  },
  video_marcha_post: {
    overlay: "marcha_post",
    checks: [
      "El paciente va descalzo",
      "Se ve el cuerpo entero de espaldas, centrado en la línea",
      "Pasillo de 4-5 m libre; cámara en trípode a la altura de la cadera",
      "Camina a ritmo natural, sin posar",
    ],
    help: "El paciente se aleja de la cámara: se valora el retropié en dinámica y las compensaciones desde atrás.",
  },
  video_marcha_ant: {
    overlay: "marcha_ant",
    checks: [
      "El paciente va descalzo",
      "Se ve el cuerpo entero de frente, centrado en el encuadre",
      "Cámara en trípode a la altura de la cadera",
      "Camina hacia la cámara a ritmo natural",
    ],
    help: "El paciente camina de frente: se valora el antepié, el ángulo de paso y el alineamiento desde delante.",
  },
  video_marcha_lat: {
    overlay: "marcha_lat",
    checks: [
      "El paciente va descalzo",
      "Se ve el cuerpo entero de perfil, como en la figura",
      "Grabado desde AMBOS lados: una pasada por el lado derecho y otra por el izquierdo",
      "Camina a ritmo natural, sin posar (2-3 pasadas por lado)",
    ],
    help: "Marcha de perfil por los dos lados: se valora el ciclo completo (contacto, apoyo medio y despegue) en cada pie.",
  },
  video_heel_rise: {
    overlay: "heel_rise",
    checks: [
      "Paciente de espaldas y descalzo, con apoyo ligero de los dedos en la pared",
      "Ambos talones bien visibles, como en la figura",
      "Primero bilateral y después monopodal de cada pie",
      "Elevaciones a ritmo constante (una cada 2 segundos)",
    ],
    help: "Elevación de talones desde atrás, bilateral y monopodal: se valora el tibial posterior y si el retropié se invierte al subir.",
  },
};

function buildSlides(): Slide[] {
  const slides: Slide[] = [
    { t: "q", section: "motivo", title: "Motivo de consulta y dolor", grupo: "Cuestionario" },
    { t: "q", section: "zonas", title: "Dónde y cuándo duele", grupo: "Cuestionario" },
    { t: "q", section: "actividad", title: "Actividad y datos físicos", grupo: "Cuestionario" },
    { t: "q", section: "calzado", title: "Calzado y plantillas", grupo: "Cuestionario" },
    { t: "q", section: "antecedentes", title: "Antecedentes y tratamientos", grupo: "Cuestionario" },
    { t: "e", section: "movilidad", title: "Movilidad y flexibilidad", grupo: "Exploración" },
    { t: "e", section: "tests_sel", title: `Tests: elige al menos ${MIN_TESTS} de 6`, grupo: "Exploración" },
    { t: "e", section: "tests_res", title: "Tests: resultados", grupo: "Exploración" },
    { t: "e", section: "dismetria", title: "Dismetría: nivel y láminas", grupo: "Exploración" },
    { t: "e", section: "marcha", title: "Análisis de la marcha", grupo: "Exploración" },
    // Con el paciente delante se termina primero la parte «de consulta» (cuestionario,
    // exploración y vídeos); las máquinas (escáner y Podisense) quedan para el final.
    ...VIDEO_KINDS.map(([kind, label]) => {
      const m = VIDEO_META[kind];
      return {
        t: "media",
        kind,
        title: label,
        grupo: "Vídeos",
        overlay: m.overlay,
        mode: "video",
        checks: m.checks,
        help: m.help,
      } as Slide;
    }),
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
      help: "Toma el molde en las espumas fenólicas y escanéalo en su plataforma. Cuando esté hecho, márcalo aquí — es el último paso del estudio.",
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
    if (s.section === "tests_sel") return (e.testsSel ?? []).length >= MIN_TESTS;
    if (s.section === "tests_res") return testsCompletos(e);
    const key = { movilidad: "subastragalina", dismetria: "dismetria", marcha: "marchaPatron" }[
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
        <div className="grid g2">
          <Sel name="tobillo" label="Flexión dorsal de tobillo (Silfverskiöld)" opts={TOBILLO_OPTS} def={e?.tobillo} />
          <Sel name="hallux" label="Hallux (primer dedo)" opts={HALLUX_OPTS} def={e?.hallux} />
        </div>
        <div className="grid g3">
          <Sel name="subastragalina" label="Articulación subastragalina" opts={SUBASTRAGALINA_OPTS} def={e?.subastragalina} />
          <Sel name="primerRadio" label="Primer radio" opts={PRIMER_RADIO_OPTS} def={e?.primerRadio} />
          <Sel name="cadenaPosterior" label="Cadena posterior (isquios/gemelos)" opts={CADENA_POSTERIOR_OPTS} def={e?.cadenaPosterior} />
        </div>
        <div className="grid g3">
          <Sel name="tipoPie" label="Tipo de pie" opts={TIPO_PIE_OPTS} def={e?.tipoPie} />
          <Num name="fpiIzq" label="FPI-6 pie izquierdo (−12 a +12)" def={e?.fpiIzq} min={-12} max={12} ph="+4" />
          <Num name="fpiDcho" label="FPI-6 pie derecho (−12 a +12)" def={e?.fpiDcho} min={-12} max={12} ph="+4" />
        </div>
        <div className="tiny">FPI-6: 0 a +5 neutro · +6 a +9 pronado · +10 o más muy pronado · negativo supinado.</div>
      </>
    );
  // Elegir qué tests se hacen: se ordenan por lo indicados que están para este
  // paciente y se explica el motivo, para que elegir sea inmediato.
  if (section === "tests_sel") {
    const recs = recomendarTests(q, e);
    const sel = e?.testsSel ?? [];
    const conMotivo = recs.filter((r) => r.motivos.length > 0).length;
    return (
      <>
        <p className="muted" style={{ margin: "4px 0 10px" }}>
          Haz al menos {MIN_TESTS} de los 6 y elige cuáles según el caso. Están ordenados por lo
          indicados que resultan para este paciente; el último de la lista es el que menos aporta
          aquí, si necesitas omitir uno.
        </p>
        {conMotivo === 0 && (
          <div className="note">
            Aún no hay zonas de dolor ni desgaste anotados en el cuestionario, así que no se puede
            priorizar: elige según tu criterio.
          </div>
        )}
        {recs.map(({ test, motivos }) => (
          <label className="testcard" key={test.id}>
            <input
              type="checkbox"
              name="testsSel"
              value={test.id}
              defaultChecked={sel.includes(test.id)}
            />
            <div>
              <div className="row" style={{ gap: 8 }}>
                <b>{test.nombre}</b>
                {motivos.length >= 2 ? (
                  <span className="pill g">Muy indicado</span>
                ) : motivos.length === 1 ? (
                  <span className="pill a">Indicado</span>
                ) : (
                  <span className="pill n">Menos indicado aquí</span>
                )}
              </div>
              <div className="tiny" style={{ marginTop: 3 }}>{test.para}</div>
              <div className="tiny">
                <b>Indicado en:</b> {test.indicado}
              </div>
              {motivos.length > 0 && (
                <div className="tiny" style={{ color: "var(--green)" }}>
                  En este paciente: {motivos.join(", ")}.
                </div>
              )}
            </div>
          </label>
        ))}
      </>
    );
  }

  // Resultados: solo se piden los de los tests elegidos
  if (section === "tests_res") {
    const sel = (e?.testsSel ?? []) as TestId[];
    if (sel.length === 0)
      return (
        <div className="note a">
          Todavía no has elegido los tests. Vuelve a la pantalla anterior y marca al menos{" "}
          {MIN_TESTS}.
        </div>
      );
    return (
      <>
        <p className="muted" style={{ margin: "4px 0 10px" }}>
          Anota el resultado de los {sel.length} tests que has elegido.
        </p>
        {sel.includes("jack") && (
          <>
            <div className="tiny" style={{ marginTop: 12 }}>TEST DE JACK / HUBSCHER</div>
            <div className="grid g2">
              <Sel name="jackIzq" label="Pie izquierdo" opts={JACK_OPTS} def={e?.jackIzq} />
              <Sel name="jackDcho" label="Pie derecho" opts={JACK_OPTS} def={e?.jackDcho} />
            </div>
          </>
        )}
        {sel.includes("navicular") && (
          <>
            <div className="tiny" style={{ marginTop: 12 }}>NAVICULAR DROP</div>
            <div className="grid g2">
              <Num name="navDropIzq" label="Pie izquierdo (mm)" def={e?.navDropIzq} min={0} max={30} ph="6" />
              <Num name="navDropDcho" label="Pie derecho (mm)" def={e?.navDropDcho} min={0} max={30} ph="6" />
            </div>
            <div className="tiny">Descenso del escafoides de neutro a apoyo relajado. Más de 10 mm se considera patológico.</div>
          </>
        )}
        {sel.includes("resist_sup") && (
          <>
            <div className="tiny" style={{ marginTop: 12 }}>RESISTENCIA A LA SUPINACIÓN</div>
            <div className="grid g2">
              <Sel name="resistSupIzq" label="Pie izquierdo" opts={RESIST_SUP_OPTS} def={e?.resistSupIzq} />
              <Sel name="resistSupDcho" label="Pie derecho" opts={RESIST_SUP_OPTS} def={e?.resistSupDcho} />
            </div>
            <div className="tiny">Alta resistencia → hace falta más cuña/posting medial en la plantilla.</div>
          </>
        )}
        {sel.includes("max_pronacion") && (
          <>
            <div className="tiny" style={{ marginTop: 12 }}>MÁXIMA PRONACIÓN</div>
            <div className="grid g2">
              <Sel name="maxPronIzq" label="Pie izquierdo" opts={MAX_PRONACION_OPTS} def={e?.maxPronIzq} />
              <Sel name="maxPronDcho" label="Pie derecho" opts={MAX_PRONACION_OPTS} def={e?.maxPronDcho} />
            </div>
          </>
        )}
        {sel.includes("lunge") && (
          <>
            <div className="tiny" style={{ marginTop: 12 }}>LUNGE TEST</div>
            <div className="grid g2">
              <Num name="lungeIzq" label="Pie izquierdo (cm a la pared)" def={e?.lungeIzq} min={0} max={20} step="0.5" ph="10" />
              <Num name="lungeDcha" label="Pie derecho (cm a la pared)" def={e?.lungeDcha} min={0} max={20} step="0.5" ph="10" />
            </div>
            <div className="tiny">Rodilla a la pared sin despegar el talón. Menos de 9-10 cm sugiere restricción de flexión dorsal.</div>
          </>
        )}
        {sel.includes("heel_rise") && (
          <>
            <div className="tiny" style={{ marginTop: 12 }}>DOUBLE HEEL RISE</div>
            <Sel name="heelRise" label="Resultado" opts={HEEL_RISE_OPTS} def={e?.heelRise} />
          </>
        )}
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
        rows={2}
        defaultValue={e?.marchaObs}
        placeholder="Ej.: colapso del arco interno izquierdo en apoyo medio"
      />
      <div className="tiny">Los vídeos de marcha y la baropodometría de los siguientes pasos completan esta valoración.</div>
    </>
  );
}

// --- Componente principal: una prueba por pantalla ---

export function CapturaGuiada({ kase, paso }: { kase: CaseWithCapture; paso?: number }) {
  const cp = kase.capture;
  const q = (cp?.questionnaire as Questionnaire | null) ?? null;
  const e = (cp?.physicalExam as Exam | null) ?? null;
  const media = cp?.media.filter((m) => m.confirmedAt) ?? [];
  const has = (k: string) => media.some((m) => m.kind === k);
  const cl = checklistOf(cp);
  const repeat = kase.state === "DEVUELTO_CLINICA";
  const lastIncident = repeat
    ? [...kase.incidents].sort((a, b) => +b.createdAt - +a.createdAt).find((i) => i.type === "CAPTURA_INVALIDA")
    : null;

  const doneFlags = SLIDES.map((s) => (s.t === "envio" ? cl.completa : slideDone(s, q, e, has)));
  const total = SLIDES.length;
  const firstPending = doneFlags.findIndex((d, i) => !d && SLIDES[i].t !== "envio");
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
            <b style={{ fontFamily: "var(--font-sora)" }}>Protocolo de captura</b>
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
                    <span className="push tiny">{doneFlags[i] ? "revisar" : "hacer →"}</span>
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
              <CamaraGuiada
                caseId={kase.id}
                kind={s.kind}
                overlay={s.overlay}
                mode={s.mode}
                checks={s.checks}
                next={next ?? total}
              />
            </>
          ))}

        {s.t === "file" &&
          (done ? (
            <>
              <div className="note g">
                {s.hecho} Queda asociado a <b>{kase.patient.name}</b> (caso #{kase.number}).
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
              <form action={markMediaAction}>
                <input type="hidden" name="caseId" value={kase.id} />
                <input type="hidden" name="kind" value={s.kind} />
                <input type="hidden" name="next" value={next ?? ""} />
                <button type="submit" className="pri wfull">
                  {s.boton}
                </button>
              </form>
              <div className="tiny" style={{ marginTop: 8 }}>
                Se guardará asociado a <b>{kase.patient.name}</b> — caso #{kase.number}. No hace
                falta renombrar el archivo: el nombre del paciente y el caso se añaden solos.
              </div>
            </>
          ))}

        {s.t === "envio" && (
          <>
            <p className="muted" style={{ margin: "4px 0 10px" }}>
              Checklist bloqueante del protocolo: sin todo en verde no hay envío a prescripción.
            </p>
            <CheckLine ok={cl.cuestionario}>Cuestionario clínico (5 pantallas)</CheckLine>
            <CheckLine ok={cl.exploracion}>Exploración y tests (5 pantallas)</CheckLine>
            <CheckLine ok={cl.videos >= VIDEO_KINDS.length}>
              Vídeos {cl.videos}/{VIDEO_KINDS.length} (de pie, marcha y elevación de talones)
            </CheckLine>
            <CheckLine ok={cl.baro}>Baropodometría (estática + dinámica múltiple)</CheckLine>
            <CheckLine ok={cl.escaneos}>Escaneo de las espumas fenólicas</CheckLine>
            {cl.completa ? (
              <form action={sendCaseAction}>
                <input type="hidden" name="caseId" value={kase.id} />
                <div className="sp" />
                <button type="submit" className="pri wfull">
                  {repeat ? "Reenviar caso a prescripción" : "Enviar caso a prescripción"}
                </button>
              </form>
            ) : (
              <>
                <div className="sp" />
                <Link href={`/caso/${kase.id}?paso=${continueAt}`}>
                  <button className="wfull" type="button">
                    Ir a la primera prueba pendiente →
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
