import Link from "next/link";
import type { Capture, Case, Incident, MediaAsset } from "@prisma/client";
import { checklistOf } from "@/lib/cases";
import { BARO_KINDS } from "@/lib/format";
import { CAPTURA_KINDS, PASOS_CAPTURA, primerPasoPendiente } from "@/lib/captura-pasos";
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
  const q = cp?.questionnaire as { motivo?: string; dolor?: string; actividad?: string } | null;
  const e = cp?.physicalExam as { tobillo?: string; dismetria?: string; alza?: string } | null;
  const media = cp?.media.filter((m) => m.confirmedAt) ?? [];
  const has = (k: string) => media.some((m) => m.kind === k);
  const hechos = media.map((m) => m.kind).filter((k) => CAPTURA_KINDS.includes(k));
  const pendiente = primerPasoPendiente(hechos);
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
          <b>
            4 · Cámara — modo captura guiado{" "}
            {cl.fotos && cl.videos >= 7 && <span className="pill g">✓</span>}
          </b>
          {pendiente && (
            <>
              <div className="sp" />
              <Link className="btn pri" href={`/caso/${kase.id}?paso=${pendiente.paso}`}>
                ▶ {hechos.length ? "Continuar captura guiada" : "Iniciar captura guiada"} — paso{" "}
                {pendiente.paso} de {PASOS_CAPTURA.length}
              </Link>
              <div className="sp" />
            </>
          )}
          {PASOS_CAPTURA.map((p) => (
            <CheckLine ok={has(p.kind)} key={p.kind}>
              {p.titulo}
              <span className="push">
                <Link className="btn" href={`/caso/${kase.id}?paso=${p.paso}`}>
                  {has(p.kind) ? "↻ Repetir" : "● Capturar"}
                </Link>
              </span>
            </CheckLine>
          ))}
          <div className="tiny">
            Cámara en trípode con silueta de encuadre: la app comprueba sola que el paciente se ve
            entero y bien orientado, y dispara la foto o la grabación. El check verde solo aparece
            cuando el servidor confirma la subida real del archivo.
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
          <CheckLine ok={cl.fotos}>Estáticas de pie (2)</CheckLine>
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
