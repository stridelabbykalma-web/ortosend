import type { Capture, Case, Incident, MediaAsset } from "@prisma/client";
import { checklistOf } from "@/lib/cases";
import { BARO_KINDS, VIDEO_KINDS } from "@/lib/format";
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
  dolorLabel,
  type Questionnaire,
} from "@/lib/questionnaire";
import {
  ANGULO_PASO_OPTS,
  CADENA_POSTERIOR_OPTS,
  CONTACTO_OPTS,
  DESPEGUE_OPTS,
  HALLUX_OPTS,
  HEEL_RISE_OPTS,
  JACK_OPTS,
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
import { CheckLine } from "@/components/ui";
import {
  markMediaAction,
  saveExamAction,
  saveQuestionnaireAction,
  sendCaseAction,
} from "@/app/panel/clinica-actions";

type CaseWithCapture = Case & {
  capture: (Capture & { media: MediaAsset[] }) | null;
  incidents: Incident[];
};

// Asistente de captura de la clínica: 6 pasos con guardado continuo y checklist bloqueante.
export function Wizard({ kase }: { kase: CaseWithCapture }) {
  const cp = kase.capture;
  const q = cp?.questionnaire as Questionnaire | null;
  const e = cp?.physicalExam as Exam | null;
  const media = cp?.media.filter((m) => m.confirmedAt) ?? [];
  const has = (k: string) => media.some((m) => m.kind === k);
  const cl = checklistOf(cp);
  const repeat = kase.state === "DEVUELTO_CLINICA";
  const lastIncident = repeat
    ? [...kase.incidents].sort((a, b) => +b.createdAt - +a.createdAt).find((i) => i.type === "CAPTURA_INVALIDA")
    : null;

  const hidden = (kind: string) => (
    <>
      <input type="hidden" name="caseId" value={kase.id} />
      <input type="hidden" name="kind" value={kind} />
    </>
  );

  return (
    <>
      {repeat ? (
        <div className="note r">
          <b>Caso devuelto:</b> {lastIncident?.reason ?? "repetir prueba indicada"}. Repite la
          prueba señalada y reenvía el estudio.
        </div>
      ) : (
        <div className="note">
          Asistente de captura · borrador con guardado continuo — puedes completar cada paso desde
          el PC o el móvil, nada se pierde.
        </div>
      )}
      <div className="sp" />
      <div className="card">
        <b>1 · Cuestionario clínico {cl.cuestionario && <span className="pill g">✓</span>}</b>
        {cl.cuestionario ? (
          <div className="muted" style={{ marginTop: 6 }}>
            {q?.motivo}
            {q?.dolor ? ` · Dolor ${dolorLabel(q)}` : ""}
            {q?.evolucion ? ` · ${q.evolucion}` : ""}
            {q?.actividad ? ` · ${q.actividad}` : ""}
            <div className="tiny" style={{ marginTop: 4 }}>
              Cuestionario completo visible en el expediente del caso.
            </div>
          </div>
        ) : (
          <form action={saveQuestionnaireAction}>
            <input type="hidden" name="caseId" value={kase.id} />

            <div className="tiny" style={{ marginTop: 12 }}>MOTIVO DE CONSULTA Y DOLOR</div>
            <label>Motivo de consulta *</label>
            <input
              name="motivo"
              placeholder="Ej.: dolor en talón derecho al levantarse, 3 meses"
              required
            />
            <div className="grid g3">
              <div>
                <label>Tiempo de evolución</label>
                <select name="evolucion" defaultValue="1-3 meses">
                  {EVOLUCION_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Intensidad del dolor (0-10) *</label>
                <select name="dolor" defaultValue="5">
                  {Array.from({ length: 11 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Lado afectado</label>
                <select name="lado" defaultValue="Ambos">
                  {LADO_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
            <label>Zonas de dolor (marca todas las que apliquen)</label>
            <div className="grid g3">
              {ZONA_OPTS.map((o) => (
                <label className="chk" key={o}>
                  <input type="checkbox" name="zonas" value={o} /> {o}
                </label>
              ))}
            </div>
            <label>¿Cuándo aparece el dolor?</label>
            <div className="grid g3">
              {MOMENTO_OPTS.map((o) => (
                <label className="chk" key={o}>
                  <input type="checkbox" name="momentos" value={o} /> {o}
                </label>
              ))}
            </div>

            <div className="tiny" style={{ marginTop: 16 }}>ACTIVIDAD Y DATOS FÍSICOS</div>
            <div className="grid g2">
              <div>
                <label>Nivel de actividad</label>
                <select name="actividad" defaultValue="Activo">
                  {ACTIVIDAD_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Deporte principal y frecuencia</label>
                <input name="deporte" placeholder="Ej.: running, 3 días/semana" />
              </div>
              <div>
                <label>Horas de pie al día</label>
                <select name="horasPie" defaultValue="4-8 h">
                  {HORAS_PIE_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Profesión / ocupación</label>
                <input name="profesion" placeholder="Ej.: camarero, oficina…" />
              </div>
            </div>
            <div className="grid g3">
              <div>
                <label>Peso (kg)</label>
                <input name="peso" type="number" min={20} max={250} step="0.1" placeholder="78" />
              </div>
              <div>
                <label>Altura (cm)</label>
                <input name="altura" type="number" min={100} max={230} placeholder="175" />
              </div>
              <div>
                <label>Talla de calzado (EU)</label>
                <input name="tallaCalzado" type="number" min={30} max={52} step="0.5" placeholder="42" />
              </div>
            </div>

            <div className="tiny" style={{ marginTop: 16 }}>CALZADO Y PLANTILLAS</div>
            <label>Calzado habitual (marca todos los que apliquen)</label>
            <div className="grid g3">
              {CALZADO_OPTS.map((o) => (
                <label className="chk" key={o}>
                  <input type="checkbox" name="calzado" value={o} /> {o}
                </label>
              ))}
            </div>
            <div className="grid g2">
              <div>
                <label>Desgaste del calzado</label>
                <select name="desgaste" defaultValue="Normal / simétrico">
                  {DESGASTE_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>¿Ha usado plantillas antes?</label>
                <select name="plantillasPrevias" defaultValue="No, nunca">
                  {PLANTILLAS_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="tiny" style={{ marginTop: 16 }}>ANTECEDENTES Y TRATAMIENTOS</div>
            <label>Antecedentes relevantes</label>
            <div className="grid g3">
              {ANTECEDENTES_OPTS.map((o) => (
                <label className="chk" key={o}>
                  <input type="checkbox" name="antecedentes" value={o} /> {o}
                </label>
              ))}
            </div>
            <div className="grid g2">
              <div>
                <label>Detalle de antecedentes (lesión, cirugía, año…)</label>
                <input name="antecedentesDetalle" placeholder="Ej.: esguince tobillo dcho. 2023" />
              </div>
              <div>
                <label>Medicación habitual relevante</label>
                <input name="medicacion" placeholder="Ej.: anticoagulantes, corticoides…" />
              </div>
            </div>
            <label>Tratamientos previos para este problema</label>
            <div className="grid g3">
              {TRATAMIENTOS_OPTS.map((o) => (
                <label className="chk" key={o}>
                  <input type="checkbox" name="tratamientosPrevios" value={o} /> {o}
                </label>
              ))}
            </div>

            <label>Observaciones del profesional</label>
            <textarea
              name="observaciones"
              rows={2}
              placeholder="Cualquier dato relevante para la valoración que no encaje arriba"
            />
            <div className="sp" />
            <button type="submit" className="pri">
              Guardar cuestionario
            </button>
          </form>
        )}
      </div>
      <div className="sp" />
      <div className="card">
        <b>2 · Exploración biomecánica y tests {cl.exploracion && <span className="pill g">✓</span>}</b>
        {cl.exploracion ? (
          <div className="muted" style={{ marginTop: 6 }}>
            {[
              e?.tobillo ? `Tobillo: ${e.tobillo}` : "",
              e?.tipoPie ? `Pie: ${e.tipoPie}` : "",
              e?.marchaPatron ? `Marcha: ${e.marchaPatron}` : "",
              e?.dismetria && e.dismetria !== "No" ? `Dismetría: ${e.dismetria}` : "",
              e?.alza && e.alza !== "No" ? `Alza: ${e.alza} mm` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            <div className="tiny" style={{ marginTop: 4 }}>
              Exploración completa visible en el expediente del caso.
            </div>
          </div>
        ) : (
          <form action={saveExamAction}>
            <input type="hidden" name="caseId" value={kase.id} />

            <div className="tiny" style={{ marginTop: 12 }}>A · MOVILIDAD Y FLEXIBILIDAD (EN CAMILLA)</div>
            <div className="grid g2">
              <div>
                <label>Flexión dorsal de tobillo (Silfverskiöld)</label>
                <select name="tobillo" defaultValue="Normal">
                  {TOBILLO_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Hallux (primer dedo)</label>
                <select name="hallux" defaultValue="Normal">
                  {HALLUX_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid g3">
              <div>
                <label>Articulación subastragalina</label>
                <select name="subastragalina" defaultValue="Normal">
                  {SUBASTRAGALINA_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Primer radio</label>
                <select name="primerRadio" defaultValue="Normal">
                  {PRIMER_RADIO_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Cadena posterior (isquios/gemelos)</label>
                <select name="cadenaPosterior" defaultValue="Normal">
                  {CADENA_POSTERIOR_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid g2">
              <div>
                <label>Lunge test — pie izquierdo (cm a la pared)</label>
                <input name="lungeIzq" type="number" min={0} max={20} step="0.5" placeholder="10" />
              </div>
              <div>
                <label>Lunge test — pie derecho (cm a la pared)</label>
                <input name="lungeDcha" type="number" min={0} max={20} step="0.5" placeholder="10" />
              </div>
            </div>
            <div className="tiny">Lunge: rodilla a la pared sin despegar talón. Menos de 9-10 cm sugiere restricción de flexión dorsal.</div>

            <div className="tiny" style={{ marginTop: 16 }}>B · TESTS EN CARGA</div>
            <div className="grid g2">
              <div>
                <label>FPI-6 pie izquierdo (−12 a +12)</label>
                <input name="fpiIzq" type="number" min={-12} max={12} placeholder="+4" />
              </div>
              <div>
                <label>FPI-6 pie derecho (−12 a +12)</label>
                <input name="fpiDcho" type="number" min={-12} max={12} placeholder="+4" />
              </div>
            </div>
            <div className="tiny">FPI-6: 0 a +5 neutro · +6 a +9 pronado · +10 o más muy pronado · negativo supinado.</div>
            <div className="grid g2">
              <div>
                <label>Test de Jack (windlass) — izquierdo</label>
                <select name="jackIzq" defaultValue="Positivo (arco se restaura)">
                  {JACK_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Test de Jack (windlass) — derecho</label>
                <select name="jackDcho" defaultValue="Positivo (arco se restaura)">
                  {JACK_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid g2">
              <div>
                <label>Navicular drop izquierdo (mm)</label>
                <input name="navDropIzq" type="number" min={0} max={30} placeholder="6" />
              </div>
              <div>
                <label>Navicular drop derecho (mm)</label>
                <input name="navDropDcho" type="number" min={0} max={30} placeholder="6" />
              </div>
            </div>
            <div className="tiny">Navicular drop: descenso del navicular de neutro a apoyo relajado. Más de 10 mm se considera patológico.</div>
            <div className="grid g2">
              <div>
                <label>Heel rise test (puntillas monopodal)</label>
                <select name="heelRise" defaultValue="Normal bilateral">
                  {HEEL_RISE_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Tipo de pie</label>
                <select name="tipoPie" defaultValue="Neutro">
                  {TIPO_PIE_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="tiny" style={{ marginTop: 16 }}>C · DISMETRÍA (NIVEL PÉLVICO + LÁMINAS CALIBRADAS)</div>
            <div className="grid g3">
              <div>
                <label>¿Dismetría aparente?</label>
                <select name="dismetria" defaultValue="No">
                  <option>No</option>
                  <option>Sí</option>
                </select>
              </div>
              <div>
                <label>Pierna corta</label>
                <select name="ladoCorto" defaultValue="">
                  <option value="">—</option>
                  {LADO_CORTO_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Lámina que nivela la pelvis</label>
                <select name="lamina" defaultValue="">
                  <option value="">—</option>
                  {LAMINA_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
            <label>Alza recomendada en plantilla (mm)</label>
            <input name="alza" type="number" min={0} max={20} placeholder="Ej.: 5" style={{ maxWidth: 200 }} />
            <div className="tiny">
              Con el paciente de pie y nivel sobre las crestas ilíacas, añade láminas bajo la pierna
              corta hasta nivelar. La corrección inicial en plantilla suele ser parcial (50-75 % de
              la lámina) y se ajusta en revisiones.
            </div>

            <div className="tiny" style={{ marginTop: 16 }}>D · ANÁLISIS DE LA MARCHA (OBSERVACIONAL)</div>
            <div className="grid g3">
              <div>
                <label>Patrón de pisada</label>
                <select name="marchaPatron" defaultValue="Neutro">
                  {MARCHA_PATRON_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Contacto inicial</label>
                <select name="contactoInicial" defaultValue="Talón (normal)">
                  {CONTACTO_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Ángulo de progresión del paso</label>
                <select name="anguloPaso" defaultValue="Normal">
                  {ANGULO_PASO_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid g2">
              <div>
                <label>Retropié en apoyo</label>
                <select name="retropieApoyo" defaultValue="Neutro">
                  {RETROPIE_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Despegue / propulsión</label>
                <select name="despegue" defaultValue="Normal">
                  {DESPEGUE_OPTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
            <label>Observaciones de la marcha (asimetrías, claudicación, compensaciones…)</label>
            <textarea
              name="marchaObs"
              rows={2}
              placeholder="Ej.: colapso del arco interno izquierdo en apoyo medio, brazo derecho más pegado al cuerpo"
            />
            <div className="tiny">
              Apóyate en los 6 vídeos de marcha del paso 4 y en la baropodometría del paso 5: el
              prescriptor los verá junto a esta valoración.
            </div>
            <div className="sp" />
            <button type="submit" className="pri">
              Guardar exploración
            </button>
          </form>
        )}
      </div>
      <div className="sp" />
      <div className="grid g2">
        <div className="card">
          <b>3 · Escaneo 3D {cl.escaneos && <span className="pill g">✓</span>}</b>
          {(["scan_L", "scan_R"] as const).map((kind) => (
            <CheckLine ok={has(kind)} key={kind}>
              Pie {kind === "scan_L" ? "izquierdo" : "derecho"}
              {!has(kind) && (
                <form action={markMediaAction}>
                  {hidden(kind)}
                  <button type="submit">Capturar (Revopoint)</button>
                </form>
              )}
            </CheckLine>
          ))}
          <div className="tiny">
            Siempre ambos pies. Subida real del archivo del escáner con validación: pendiente
            (R2/S3 por fragmentos).
          </div>
        </div>
        <div className="card">
          <b>4 · Vídeos — modo captura guiado {cl.videos >= 7 && <span className="pill g">✓</span>}</b>
          {VIDEO_KINDS.map(([kind, label]) => (
            <CheckLine ok={has(kind)} key={kind}>
              {label}
              {!has(kind) && (
                <form action={markMediaAction}>
                  {hidden(kind)}
                  <button type="submit">● Grabar</button>
                </form>
              )}
            </CheckLine>
          ))}
          <div className="tiny">
            En producción: grabación con la cámara del móvil en trípode (getUserMedia +
            MediaRecorder), silueta de encuadre y subida en segundo plano. El check verde solo
            aparece cuando el servidor confirma la subida.
          </div>
        </div>
        <div className="card">
          <b>5 · Baropodometría (Podisense GO) {cl.baro && <span className="pill g">✓</span>}</b>
          {BARO_KINDS.map(([kind, label]) => (
            <CheckLine ok={has(kind)} key={kind}>
              {label}
              {!has(kind) && (
                <form action={markMediaAction}>
                  {hidden(kind)}
                  <button type="submit">{kind === "baro_informe" ? "Adjuntar archivo" : "Capturar"}</button>
                </form>
              )}
            </CheckLine>
          ))}
        </div>
        <div className="card">
          <b>6 · Revisión y envío</b>
          <CheckLine ok={cl.cuestionario}>Cuestionario</CheckLine>
          <CheckLine ok={cl.exploracion}>Exploración</CheckLine>
          <CheckLine ok={cl.escaneos}>Escaneo 3D (2)</CheckLine>
          <CheckLine ok={cl.videos >= 7}>Vídeos 7/7</CheckLine>
          <CheckLine ok={cl.baro}>Baropodometría</CheckLine>
          {cl.completa ? (
            <form action={sendCaseAction}>
              <input type="hidden" name="caseId" value={kase.id} />
              <button type="submit" className="pri wfull">
                {repeat ? "Reenviar caso a prescripción" : "Enviar caso a prescripción"}
              </button>
            </form>
          ) : (
            <div className="tiny">
              El botón de envío aparece con todos los ítems en verde (checklist obligatoria del
              protocolo).
            </div>
          )}
        </div>
      </div>
    </>
  );
}
