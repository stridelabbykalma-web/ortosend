import type { Case } from "@prisma/client";
import {
  contactAction,
  draftAction,
  noPrescribeAction,
  repeatAction,
  reviewBackAction,
  signRxAction,
} from "@/app/panel/rx-actions";
import { REVISION_PREFIJO } from "@/lib/rx-route";
import { MEDIA_LABEL } from "@/lib/format";
import { PIEZAS_RECETA } from "@/lib/piezas-receta";

// Pruebas del protocolo que se pueden señalar al pedir repetición (su check se invalida).
const PRUEBAS_REPETIBLES = Object.entries(MEDIA_LABEL).filter(([k]) => k !== "foto_calidad");

// Vista de valoración y prescripción (prescriptor de clínica o recetador central).
export function RxView({
  kase,
  collegiateNum,
  central = false,
  requestedBy = null,
}: {
  kase: Case;
  collegiateNum: string | null;
  central?: boolean; // quien mira es el recetador de Ortosend
  requestedBy?: string | null; // profesional de la clínica que envió el caso
}) {
  const revisionPedida = central && kase.rxRoute === "REVISION";
  const revisionRecibida = !central && !!kase.rxDraft?.startsWith(REVISION_PREFIJO);
  return (
    <div className="card">
      <b style={{ fontFamily: "var(--font-sora)" }}>Valoración y prescripción</b>
      {revisionPedida && (
        <form action={reviewBackAction} className="note a" style={{ marginTop: 10 }}>
          <input type="hidden" name="caseId" value={kase.id} />
          <b>Segunda opinión pedida por {requestedBy ?? "la clínica"}</b> — receta propia de la clínica: la firma es suya.
          Escribe tu valoración y devuélveselo; te lo puedes quedar y firmarlo tú solo si la clínica
          lo pide expresamente.
          <label>Tu valoración para la clínica</label>
          <textarea
            name="review"
            rows={3}
            required
            placeholder="Hallazgos, diagnóstico que ves y pauta de fabricación que recomiendas…"
          />
          <div className="sp" />
          <button type="submit" className="pri">
            Devolver la segunda opinión a la clínica
          </button>
        </form>
      )}
      {revisionRecibida && (
        <div className="note g" style={{ marginTop: 10 }}>
          <b>Segunda opinión de Ortosend recibida</b> — la tienes abajo, en la valoración clínica, lista
          para completarla y firmar.
        </div>
      )}
      <form action={signRxAction} id={`rx-${kase.id}`}>
        <input type="hidden" name="caseId" value={kase.id} />
        <label>Valoración clínica (hallazgos relevantes)</label>
        <textarea
          name="assessment"
          rows={2}
          placeholder="Qué observas en la marcha, presiones, exploración…"
          defaultValue={kase.rxDraft ?? ""}
        />
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
          Receta: cómo deben ser las plantillas, qué deben llevar y qué función tienen (orden de
          trabajo para el taller)
        </label>
        <textarea
          name="fabricationOrder"
          rows={3}
          placeholder="Cómo deben ser (tipo, material, rigidez)… qué deben llevar (cuñas, descargas, alza en mm)… y qué función tienen (objetivo del tratamiento)."
        />
        <div className="grid g2" style={{ gap: "0 14px" }}>
          <div>
            <label>Pie izquierdo (si el trabajo es distinto en cada pie)</label>
            <textarea name="orderLeft" rows={2} placeholder="Solo lo específico del izquierdo: alza, cuña, descarga…" />
          </div>
          <div>
            <label>Pie derecho</label>
            <textarea name="orderRight" rows={2} placeholder="Solo lo específico del derecho. Vacío = igual que la receta general." />
          </div>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Piezas para el taller (opcional): márcalas y el programa del taller las pone en el molde
          </summary>
          <div className="tiny muted" style={{ margin: "6px 0" }}>
            Valores pensados para plantilla rígida. Marca en qué pie va cada una; el técnico las revisa al
            hacer el molde. Lo que escribas arriba sigue siendo la receta.
          </div>
          <table className="tiny" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th>Pieza</th>
                <th style={{ textAlign: "center" }}>Izq.</th>
                <th style={{ textAlign: "center" }}>Dcho.</th>
                <th>Valor</th>
                <th>Tipo</th>
              </tr>
            </thead>
            <tbody>
              {PIEZAS_RECETA.map((p) => (
                <tr key={p.tipo} style={{ borderTop: "1px solid var(--line, #e5e7eb)" }}>
                  <td>{p.nombre}</td>
                  <td style={{ textAlign: "center" }}>
                    <input type="checkbox" name={`pz_${p.tipo}_I`} aria-label={`${p.nombre} pie izquierdo`} />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input type="checkbox" name={`pz_${p.tipo}_D`} aria-label={`${p.nombre} pie derecho`} />
                  </td>
                  <td>
                    <input
                      name={`pz_${p.tipo}_valor`}
                      type="number"
                      step="0.5"
                      min={p.min}
                      max={p.max}
                      defaultValue={p.defecto}
                      style={{ width: 70 }}
                      aria-label={`${p.nombre}: valor en ${p.unidad}`}
                    />{" "}
                    {p.unidad}
                  </td>
                  <td>
                    {p.sentidos && (
                      <select name={`pz_${p.tipo}_sentido`} defaultValue={p.sentidos[0][0]} aria-label={`${p.nombre}: tipo`}>
                        {p.sentidos.map(([valor, texto]) => (
                          <option key={valor} value={valor}>
                            {texto}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <label>Pauta de uso para el paciente</label>
        <textarea
          name="usageGuidelines"
          rows={2}
          defaultValue="Adaptación progresiva 2-3 semanas, con calzado cerrado. Revisión anual incluida."
        />
        <div className="sp" />
        <button type="submit" className="pri">
          Firmar y prescribir
        </button>
      </form>
      <div className="sp" />
      <details>
        <summary style={{ cursor: "pointer", fontSize: 14 }}>Otras salidas del caso…</summary>
        <div className="grid g2" style={{ marginTop: 10 }}>
          <form className="card" action={contactAction} style={{ padding: 14 }}>
            <input type="hidden" name="caseId" value={kase.id} />
            <b style={{ fontSize: 13 }}>Contactar con el paciente</b>
            <label>Nota del contacto (obligatoria, quedará en el caso)</label>
            <input name="note" required />
            <div className="sp" />
            <button type="submit">Proponer llamada</button>
          </form>
          <form className="card" action={repeatAction} style={{ padding: 14 }}>
            <input type="hidden" name="caseId" value={kase.id} />
            <b style={{ fontSize: 13 }}>Pedir repetición de prueba</b>
            <label>¿Qué prueba hay que repetir?</label>
            <select name="mediaKind" defaultValue="">
              <option value="">Otra cosa (descríbelo abajo)</option>
              {PRUEBAS_REPETIBLES.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <label>Si es otra cosa, cuál</label>
            <input name="what" placeholder="Ej.: cuestionario incompleto" />
            <label>Motivo (lo verá la clínica)</label>
            <input name="why" />
            <div className="sp" />
            <button type="submit" className="warn">
              Devolver a clínica
            </button>
          </form>
          <form className="card" action={noPrescribeAction} style={{ padding: 14 }}>
            <input type="hidden" name="caseId" value={kase.id} />
            <b style={{ fontSize: 13 }}>No prescribir</b>
            <label>Recomendación para el paciente (se le comunicará con cuidado)</label>
            <input name="reason" />
            <div className="sp" />
            <button type="submit" className="dang">
              No prescribir (el cliente no paga)
            </button>
          </form>
          <form className="card" action={draftAction} style={{ padding: 14 }}>
            <input type="hidden" name="caseId" value={kase.id} />
            <b style={{ fontSize: 13 }}>Soltar el caso</b>
            <label>Borrador de valoración (se conserva)</label>
            <input name="assessment" defaultValue={kase.rxDraft ?? ""} />
            <div className="sp" />
            <button type="submit">Guardar borrador y soltar (conserva antigüedad)</button>
          </form>
        </div>
      </details>
      <div className="tiny" style={{ marginTop: 10 }}>
        La firma queda registrada con tu identidad y colegiación ({collegiateNum ?? "—"}). El
        paciente recibirá la prescripción en su panel y el enlace de pago (30 días).
      </div>
    </div>
  );
}
