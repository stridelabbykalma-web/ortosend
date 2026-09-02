import type { Capture, Case, Incident, MediaAsset } from "@prisma/client";
import { checklistOf } from "@/lib/cases";
import { BARO_KINDS, VIDEO_KINDS } from "@/lib/format";
import { CheckLine } from "@/components/ui";
import {
  markMediaAction,
  saveExamAction,
  saveQuestionnaireAction,
  sendCaseAction,
} from "@/app/panel/clinica-actions";
import { signDirectRxAction } from "@/app/panel/rx-actions";

type CaseWithCapture = Case & {
  capture: (Capture & { media: MediaAsset[] }) | null;
  incidents: Incident[];
};

// Identidad del prescriptor cuando quien rellena puede recetar directamente
// (se firma automáticamente desde su perfil, no se teclea en el formulario).
export type DirectRx = { name: string; degree: string | null; collegiateNum: string };

// Asistente de captura de la clínica, con dos modos:
// · Quien rellena NO receta → 6 pasos con checklist bloqueante y envío a valoración (como siempre).
// · Quien rellena SÍ receta (directRx) → cualquier test es elegible (nada bloquea, vídeos de máx.
//   10 s), el motivo debe quedar registrado y abajo rellena y firma la receta en la misma visita.
export function Wizard({ kase, directRx }: { kase: CaseWithCapture; directRx?: DirectRx | null }) {
  const direct = !!directRx;
  const opc = direct ? <span className="tiny" style={{ fontWeight: 400 }}> (opcional)</span> : null;
  const cp = kase.capture;
  const q = cp?.questionnaire as { motivo?: string; dolor?: string; actividad?: string } | null;
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
      ) : direct ? (
        <div className="note">
          Modo receta directa · eres prescriptor verificado: registra el motivo, elige solo los
          tests que necesites (vídeos de máx. 10 s) y firma la receta abajo, en la misma visita.
        </div>
      ) : (
        <div className="note">
          Asistente de captura · borrador con guardado continuo — puedes completar cada paso desde
          el PC o el móvil, nada se pierde.
        </div>
      )}
      <div className="sp" />
      <div className="grid g2">
        <div className="card">
          <b>1 · Cuestionario clínico {cl.cuestionario && <span className="pill g">✓</span>}</b>
          {cl.cuestionario ? (
            <div className="muted" style={{ marginTop: 6 }}>
              {q?.motivo}
            </div>
          ) : (
            <form action={saveQuestionnaireAction}>
              <input type="hidden" name="caseId" value={kase.id} />
              <label>Motivo de consulta</label>
              <input name="motivo" placeholder="Ej.: dolor en talón derecho al levantarse, 3 meses" required />
              <div className="grid g2">
                <div>
                  <label>Dolor (0-10)</label>
                  <input name="dolor" placeholder="7/10" />
                </div>
                <div>
                  <label>Actividad</label>
                  <select name="actividad" defaultValue="Activo">
                    <option>Sedentario</option>
                    <option>Activo</option>
                    <option>Deportista habitual</option>
                    <option>Competición</option>
                  </select>
                </div>
              </div>
              <div className="sp" />
              <button type="submit" className="pri">
                Guardar cuestionario
              </button>
            </form>
          )}
        </div>
        <div className="card">
          <b>2 · Exploración física{opc} {cl.exploracion && <span className="pill g">✓</span>}</b>
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
          <b>3 · Escaneo 3D{opc} {cl.escaneos && <span className="pill g">✓</span>}</b>
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
            {direct
              ? "En receta directa el escaneo es elegible: captúralo solo si lo necesitas para tu valoración."
              : "Siempre ambos pies. Subida real del archivo del escáner con validación: pendiente (R2/S3 por fragmentos)."}
          </div>
        </div>
        <div className="card">
          <b>4 · Vídeos — modo captura guiado{opc} {cl.videos >= 7 && <span className="pill g">✓</span>}</b>
          {VIDEO_KINDS.map(([kind, label]) => (
            <CheckLine ok={has(kind)} key={kind}>
              {label}
              {!has(kind) && (
                <form action={markMediaAction}>
                  {hidden(kind)}
                  <button type="submit">{direct ? "● Grabar (máx. 10 s)" : "● Grabar"}</button>
                </form>
              )}
            </CheckLine>
          ))}
          <div className="tiny">
            {direct
              ? "Cualquier vídeo es elegible; graba solo los que necesites, con un máximo de 10 segundos por vídeo."
              : "En producción: grabación con la cámara del móvil en trípode (getUserMedia + MediaRecorder), silueta de encuadre y subida en segundo plano. El check verde solo aparece cuando el servidor confirma la subida."}
          </div>
        </div>
        <div className="card">
          <b>5 · Baropodometría (Podisense GO){opc} {cl.baro && <span className="pill g">✓</span>}</b>
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
        {direct ? (
          <div className="card">
            <b>6 · Receta directa</b>
            {!cl.cuestionario ? (
              <div className="tiny" style={{ marginTop: 6 }}>
                Registra primero el motivo de consulta (paso 1): debe quedar registrado en el caso
                antes de poder firmar la receta.
              </div>
            ) : (
              <form action={signDirectRxAction}>
                <input type="hidden" name="caseId" value={kase.id} />
                <label>Diagnóstico / indicación</label>
                <div className="row">
                  <select name="diagnosis" style={{ maxWidth: 280 }} defaultValue="Fascitis plantar">
                    <option>Fascitis plantar</option>
                    <option>Pie plano flexible</option>
                    <option>Metatarsalgia</option>
                    <option>Pie cavo</option>
                    <option>Dismetría</option>
                    <option>Otro (detallar)</option>
                  </select>
                  <input name="diagnosisDetail" placeholder="Matiz o detalle" style={{ flex: 1, minWidth: 160 }} />
                </div>
                <label>
                  Receta: cómo deben ser las plantillas, qué deben llevar y qué función tienen
                </label>
                <textarea
                  name="fabricationOrder"
                  rows={4}
                  placeholder="Cómo deben ser (tipo, material, rigidez)… qué deben llevar (cuñas, descargas, alza en mm)… y qué función tienen (objetivo del tratamiento)."
                  required
                />
                <label>Pauta de uso para el paciente</label>
                <textarea
                  name="usageGuidelines"
                  rows={2}
                  defaultValue="Adaptación progresiva 2-3 semanas, con calzado cerrado. Revisión anual incluida."
                />
                <label>Revisión de Ortosend (opcional)</label>
                <textarea
                  name="reviewQuestion"
                  rows={2}
                  placeholder="Si quieres una segunda opinión, escribe aquí tu consulta: uno de nuestros profesionales te responderá con la suya. No bloquea el caso."
                />
                <div className="sp" />
                <button type="submit" className="pri wfull">
                  Firmar y prescribir
                </button>
              </form>
            )}
            <div className="tiny" style={{ marginTop: 10 }}>
              Firma automática desde tu perfil: <b>{directRx!.name}</b>
              {directRx!.degree ? ` · ${directRx!.degree}` : ""} · col. {directRx!.collegiateNum}. El
              motivo de consulta queda registrado en la receta, el paciente la recibirá en su panel
              con el enlace de pago (30 días) y el taller la usará como orden de trabajo.
            </div>
          </div>
        ) : (
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
        )}
      </div>
    </>
  );
}
