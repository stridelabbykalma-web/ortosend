import type { Case } from "@prisma/client";
import {
  contactAction,
  draftAction,
  noPrescribeAction,
  repeatAction,
  signRxAction,
} from "@/app/panel/rx-actions";

// Vista de valoración y prescripción (prescriptor de clínica o recetador central).
export function RxView({ kase, collegiateNum }: { kase: Case; collegiateNum: string | null }) {
  return (
    <div className="card">
      <b style={{ fontFamily: "var(--font-sora)" }}>Valoración y prescripción</b>
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
        <label>Pauta de fabricación (orden de trabajo para el taller)</label>
        <textarea
          name="fabricationOrder"
          rows={2}
          placeholder="Tipo de plantilla, correcciones, cuñas, descargas, alza en mm…"
        />
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
            <input name="what" placeholder="Ej.: vídeo marcha posterior descalzo" required />
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
