import type { Case } from "@prisma/client";
import {
  contactAction,
  draftAction,
  markHardAction,
  noPrescribeAction,
  repeatAction,
  signRxAction,
} from "@/app/panel/rx-actions";
import { Insertar } from "@/components/revisor/insertar";
import { VIDEO_KINDS, FOTO_KINDS } from "@/lib/format";

// Pautas frecuentes de fabricación: chips que añaden texto a la orden de trabajo.
const PAUTAS = [
  "Plantilla semirrígida de contacto total.",
  "Plantilla rígida con control de retropié.",
  "Descarga retrocapital (barra metatarsal).",
  "Cuña supinadora de retropié 3° bilateral.",
  "Cuña pronadora de retropié 3°.",
  "Estabilizador de talón profundo.",
  "Soporte del arco interno reforzado.",
  "Descarga de talón (herradura) en el lado doloroso.",
  "Extensión de Morton (primer radio).",
];

const DIAGNOSTICOS = [
  "Fascitis plantar",
  "Pie plano flexible",
  "Pie cavo",
  "Metatarsalgia",
  "Neuroma de Morton",
  "Tendinopatía del tibial posterior",
  "Tendinopatía aquílea",
  "Dismetría",
  "Hallux valgus / limitus",
  "Otro (detallar)",
];

// Formulario de valoración y prescripción (prescriptor de clínica o recetador
// central). Va en la columna fija del puesto del revisor.
export function RxView({
  kase,
  collegiateNum,
  sintesisTexto,
  plantillaSugerida = [],
}: {
  kase: Case;
  collegiateNum: string | null;
  sintesisTexto?: string;
  plantillaSugerida?: string[];
}) {
  const enContacto = kase.state === "EN_CONTACTO";
  return (
    <div className="card rev-form">
      <div className="row between">
        <b style={{ fontFamily: "var(--font-sora)" }}>Valoración y prescripción</b>
        {enContacto && <span className="pill a">En contacto con el paciente</span>}
      </div>
      <form action={signRxAction} id={`rx-${kase.id}`}>
        <input type="hidden" name="caseId" value={kase.id} />
        <label htmlFor="rx-assessment">Valoración clínica (hallazgos relevantes)</label>
        <textarea
          id="rx-assessment"
          name="assessment"
          rows={4}
          placeholder="Qué observas en la marcha, presiones, exploración…"
          defaultValue={kase.rxDraft ?? ""}
        />
        {sintesisTexto && (
          <div className="rev-chips">
            <Insertar target="rx-assessment" text={sintesisTexto}>
              ＋ Volcar los puntos clave del estudio
            </Insertar>
          </div>
        )}
        <label htmlFor="rx-diagnosis">Diagnóstico / indicación</label>
        <select id="rx-diagnosis" name="diagnosis" defaultValue="Fascitis plantar">
          {DIAGNOSTICOS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <input name="diagnosisDetail" placeholder="Matiz o detalle (lado, grado…)" style={{ marginTop: 6 }} />
        <label htmlFor="rx-fab">
          Pauta de fabricación <span className="tiny">· orden de trabajo del taller, obligatoria</span>
        </label>
        <textarea
          id="rx-fab"
          name="fabricationOrder"
          rows={4}
          required
          placeholder="Tipo de plantilla, correcciones, cuñas, descargas, alza en mm…"
        />
        <div className="rev-chips">
          {plantillaSugerida.map((p) => (
            <Insertar key={p} target="rx-fab" text={p} className="rev-chip sug">
              ✦ {p}
            </Insertar>
          ))}
          {PAUTAS.map((p) => (
            <Insertar key={p} target="rx-fab" text={p}>
              ＋ {p.replace(/\.$/, "")}
            </Insertar>
          ))}
        </div>
        {plantillaSugerida.length > 0 && (
          <div className="tiny" style={{ marginTop: 6 }}>
            ✦ propuestas orientativas a partir de los vídeos y la exploración; el resto son pautas frecuentes.
          </div>
        )}
        <label htmlFor="rx-uso">Pauta de uso para el paciente</label>
        <textarea
          id="rx-uso"
          name="usageGuidelines"
          rows={2}
          defaultValue="Adaptación progresiva 2-3 semanas, con calzado cerrado. Revisión anual incluida."
        />
        <div className="sp" />
        <button type="submit" className="pri wfull">
          Firmar y prescribir
        </button>
        <div className="tiny" style={{ marginTop: 8 }}>
          Firma con tu identidad y colegiación ({collegiateNum ?? "sin verificar"}). El paciente recibe la
          prescripción en su panel y el enlace de pago (30 días). Sin prescripción no hay pago.
        </div>
      </form>

      <details className="rev-salidas">
        <summary>Otras salidas: contactar, pedir ayuda, repetir prueba, no prescribir o soltar</summary>
        {!enContacto && (
          <form className="rev-salida" action={contactAction}>
            <input type="hidden" name="caseId" value={kase.id} />
            <b>Contactar con el paciente</b>
            <div className="tiny">El caso queda asignado a ti hasta resolverlo; el paciente recibe un aviso.</div>
            <label>Nota del contacto (obligatoria, quedará en el caso)</label>
            <input name="note" required placeholder="Qué quieres aclarar con el paciente" />
            <div className="sp" />
            <button type="submit">Proponer llamada</button>
          </form>
        )}
        <form className="rev-salida" action={repeatAction}>
          <input type="hidden" name="caseId" value={kase.id} />
          <b>Pedir repetición de prueba</b>
          <div className="tiny">Vuelve a la clínica sin coste para el paciente; el resto del estudio se conserva.</div>
          <label>¿Qué prueba hay que repetir?</label>
          <input name="what" list="rx-pruebas" placeholder="Ej.: vídeo marcha posterior descalzo" required />
          <datalist id="rx-pruebas">
            {[...VIDEO_KINDS, ...FOTO_KINDS].map(([k, l]) => (
              <option key={k} value={l} />
            ))}
            <option value="Baropodometría dinámica" />
            <option value="Escaneo de las espumas" />
          </datalist>
          <label>Motivo (lo verá la clínica)</label>
          <input name="why" placeholder="Encuadre, iluminación, paciente calzado…" />
          <div className="sp" />
          <button type="submit" className="warn">
            Devolver a clínica
          </button>
        </form>
        <form className="rev-salida" action={noPrescribeAction}>
          <input type="hidden" name="caseId" value={kase.id} />
          <b>No prescribir</b>
          <div className="tiny">El cliente no paga y la clínica no cobra. Se le comunica con cuidado.</div>
          <label>Recomendación para el paciente</label>
          <input name="reason" placeholder="Derivación, ejercicios, calzado…" />
          <div className="sp" />
          <button type="submit" className="dang">
            No prescribir
          </button>
        </form>
        <form className="rev-salida rev-salida-hard" action={markHardAction}>
          <input type="hidden" name="caseId" value={kase.id} />
          <b>Pedir una segunda opinión</b>
          <div className="tiny">
            Marca el caso como complicado: tus compañeros lo verán destacado en su cola y podrán cogerlo aunque no sea
            el más antiguo.
          </div>
          <label>¿Qué hay que mirar? (lo verá quien lo coja)</label>
          <textarea
            name="hardNote"
            rows={2}
            required
            defaultValue={kase.hardNote ?? ""}
            placeholder="Dudo entre control de retropié o descarga; el vídeo posterior no cuadra con la exploración…"
          />
          <label className="chk" style={{ marginTop: 8 }}>
            <input type="checkbox" name="release" defaultChecked /> Dejarlo en la cola para que lo coja otro
          </label>
          <div className="sp" />
          <button type="submit" className="warn">
            {kase.hardAt ? "Actualizar la petición de ayuda" : "Marcar como complicado"}
          </button>
        </form>
        <form className="rev-salida" action={draftAction}>
          <input type="hidden" name="caseId" value={kase.id} />
          <b>Guardar borrador y soltar el caso</b>
          <div className="tiny">Vuelve a la cola conservando su antigüedad; tus notas se guardan.</div>
          <label>Borrador de valoración (se conserva)</label>
          <input name="assessment" defaultValue={kase.rxDraft ?? ""} />
          <div className="sp" />
          <button type="submit">Guardar y soltar</button>
        </form>
      </details>
    </div>
  );
}
