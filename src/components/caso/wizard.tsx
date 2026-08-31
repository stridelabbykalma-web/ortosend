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
  const e = cp?.physicalExam as { tobillo?: string; dismetria?: string; alza?: string } | null;
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
      <div className="grid g2">
        <div className="card">
          <b>2 · Exploración física {cl.exploracion && <span className="pill g">✓</span>}</b>
          {cl.exploracion ? (
            <div className="muted" style={{ marginTop: 6 }}>
              Tobillo: {e?.tobillo} · Dismetría: {e?.dismetria}
              {e?.alza && e.alza !== "No" ? ` · Alza: ${e.alza}` : ""}
            </div>
          ) : (
            <form action={saveExamAction}>
              <input type="hidden" name="caseId" value={kase.id} />
              <label>Flexión dorsal de tobillo (Silfverskiöld)</label>
              <select name="tobillo" defaultValue="Normal">
                <option>Normal</option>
                <option>Limitada rodilla extendida (gastrocnemios)</option>
                <option>Limitada también con rodilla flexionada (sóleo)</option>
              </select>
              <label>Hallux (primer dedo)</label>
              <select name="hallux" defaultValue="Normal">
                <option>Normal</option>
                <option>Hallux limitus</option>
                <option>Hallux rigidus</option>
                <option>Hallux valgus</option>
              </select>
              <div className="grid g2">
                <div>
                  <label>Dismetría</label>
                  <select name="dismetria" defaultValue="No">
                    <option>No</option>
                    <option>Sí — izq. más corta</option>
                    <option>Sí — dcha. más corta</option>
                  </select>
                </div>
                <div>
                  <label>Alza (mm, si procede)</label>
                  <input name="alza" placeholder="No" />
                </div>
              </div>
              <div className="sp" />
              <button type="submit" className="pri">
                Guardar exploración
              </button>
            </form>
          )}
        </div>
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
