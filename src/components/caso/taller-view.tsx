import Link from "next/link";
import type { Capture, Case, Clinic, Incident, MediaAsset, Patient, Payment, Prescription, Shipment, User } from "@prisma/client";
import { CheckLine } from "@/components/ui";
import { FotoCalidad } from "@/components/caso/foto-calidad";
import { CopiarTexto } from "@/components/caso/copiar-texto";
import { checklistOf } from "@/lib/cases";
import { PRICE_LABEL, SCAN_KIND, fmtd } from "@/lib/format";
import { nombreProyectoRevoScan } from "@/lib/scan";
import { PROD_STEPS, QC_CHECKS, fichaTecnica, prodStepIndex, slaDe, trabajoPorPie } from "@/lib/taller";
import type { Questionnaire } from "@/lib/questionnaire";
import type { Exam } from "@/lib/exploracion";
import {
  acceptCaseAction,
  captureIncidentAction,
  confectionDoneAction,
  deliveredAction,
  designDoneAction,
  phaseDoneAction,
  qcFailAction,
  qcOkAction,
  releaseCaseAction,
  updateShipmentAction,
} from "@/app/panel/taller-actions";

type CaseTaller = Case & {
  patient: Patient & { owner: User };
  clinic: Clinic;
  capture: (Capture & { media: MediaAsset[] }) | null;
  prescription: Prescription | null;
  payment: Payment | null;
  shipment: Shipment | null;
  incidents: Incident[];
};

// Paso de producción en el que está el par (mecanizado y confección separados).
export function ProdSteps({ state, fabPhase }: { state: Case["state"]; fabPhase: Case["fabPhase"] }) {
  const current = prodStepIndex(state, fabPhase);
  return (
    <div className="steps prod">
      {PROD_STEPS.map((s, i) => (
        <div key={s.key} className={`step ${i < current ? "done" : i === current ? "cur" : ""}`}>
          <div className="dot" />
          <div className="lb">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// Zona de trabajo del taller según la fase del caso + ficha técnica de fabricación.
export function TallerView({ kase }: { kase: CaseTaller }) {
  const hid = <input type="hidden" name="caseId" value={kase.id} />;
  const q = kase.capture?.questionnaire as Questionnaire | null;
  const e = kase.capture?.physicalExam as Exam | null;
  const ficha = fichaTecnica(q, e, kase);
  const cl = checklistOf(kase.capture);
  const scanMarcado = kase.capture?.media.find((m) => m.kind === SCAN_KIND && m.confirmedAt);
  const proyecto =
    (scanMarcado?.meta as { proyecto?: string } | null)?.proyecto ??
    nombreProyectoRevoScan(kase.patient.name, kase.patient.owner.phone, kase.number);
  const sla = slaDe(kase);
  const rehacer = kase.incidents.filter((i) => i.type === "REHACER_DEFECTO" && !i.closedAt);
  const rx = kase.prescription;
  const pies = trabajoPorPie(rx, e, q);

  let zone: React.ReactNode = null;

  if (kase.state === "ENTRADA_TALLER")
    zone = (
      <>
        <h3>Aceptación técnica</h3>
        <div className="muted" style={{ margin: "4px 0 10px" }}>
          Comprueba que el caso se puede fabricar antes de imprimir la hoja de trabajo y las etiquetas de molde.
        </div>
        <CheckLine ok={!!rx}>Prescripción firmada ({rx?.prescriberName ?? "falta"})</CheckLine>
        <CheckLine ok={!!kase.payment?.paidAt}>
          Pago confirmado — {PRICE_LABEL}
          {kase.payment?.paidAt ? ` · ${fmtd(kase.payment.paidAt)}` : ""}
        </CheckLine>
        <CheckLine ok={cl.escaneos}>Escaneo de las espumas marcado como hecho por la clínica</CheckLine>
        <form action={acceptCaseAction}>
          {hid}
          <label className="chk">
            <input type="checkbox" name="scanOk" required /> El proyecto «{proyecto}» abre en Revo Scan desde la carpeta
            de {kase.clinic.name} y tiene resolución suficiente en ambos pies
          </label>
          <label className="chk">
            <input type="checkbox" name="rxOk" required /> La pauta de fabricación es clara y ejecutable
          </label>
          <div className="sp" />
          <div className="row">
            <button type="submit" className="pri">
              Aceptar → a diseño
            </button>
            <Link href={`/caso/${kase.id}/hoja`} className="btn" target="_blank">
              Hoja de trabajo y etiquetas
            </Link>
          </div>
        </form>
        <div className="sp" />
        <details>
          <summary className="muted" style={{ cursor: "pointer" }}>
            Algo falla en la captura (escaneo ilegible, falta una prueba…)
          </summary>
          <form action={captureIncidentAction} className="row" style={{ marginTop: 8 }}>
            {hid}
            <input name="reason" placeholder="Qué falla y qué debe repetir la clínica" style={{ flex: 1, minWidth: 220 }} />
            <button type="submit" className="warn">
              Devolver a clínica (sin coste)
            </button>
          </form>
        </details>
      </>
    );

  if (kase.state === "DISENO")
    zone = (
      <>
        <h3>Diseño CAD</h3>
        <div className="muted" style={{ margin: "4px 0 10px" }}>
          Abre el proyecto en Revo Scan, exporta y diseña siguiendo la pauta. El archivo queda archivado para
          reposiciones y para la revisión anual.
        </div>
        <div className="checkline" style={{ justifyContent: "space-between" }}>
          <span>
            Proyecto Revo Scan <b>«{proyecto}»</b> · carpeta compartida de {kase.clinic.name}
          </span>
          <CopiarTexto texto={proyecto} />
        </div>
        <form action={designDoneAction}>
          {hid}
          <label>Lote de mecanizado (los moldes se agrupan en tandas de CNC; se puede asignar después)</label>
          <input name="lot" placeholder="Ej.: L-09" style={{ maxWidth: 140 }} />
          <label className="chk" style={{ marginTop: 12 }}>
            <input type="checkbox" name="cadOk" required /> CAD guardado en el archivo del taller como{" "}
            <code>caso-{kase.number}</code>
          </label>
          <div className="sp" />
          <button type="submit" className="pri">
            Diseño terminado → mecanizado CNC
          </button>
        </form>
      </>
    );

  if (kase.state === "FABRICACION" && kase.fabPhase === "MECANIZADO")
    zone = (
      <>
        <h3>Mecanizado CNC del molde</h3>
        <div className="muted" style={{ margin: "4px 0 10px" }}>
          Los moldes se mecanizan por tandas. Si este par va en un lote, márcalo entero desde la pestaña
          «Lotes CNC» del panel; aquí puedes cerrar solo este molde.
        </div>
        <form action={phaseDoneAction}>
          {hid}
          <label>Lote de mecanizado</label>
          <input name="lot" defaultValue={kase.lot ?? ""} placeholder="L-09" style={{ maxWidth: 140 }} />
          <div className="sp" />
          <div className="row">
            <button type="submit" className="pri">
              Molde mecanizado → confección a mano
            </button>
            <Link href="/panel?tab=lotes" className="btn">
              Ver lotes
            </Link>
          </div>
        </form>
      </>
    );

  if (kase.state === "FABRICACION" && kase.fabPhase === "CONFECCION")
    zone = (
      <>
        <h3>Confección a mano</h3>
        {rehacer.length > 0 && (
          <div className="note r" style={{ margin: "6px 0 10px" }}>
            <b>Rehacer con prioridad.</b> No pasó calidad: {rehacer.map((i) => i.reason).join(" · ")}
          </div>
        )}
        <div className="muted" style={{ margin: "4px 0 10px" }}>
          Trabajo artesanal sobre el molde {kase.lot ? `(lote ${kase.lot})` : ""} según la pauta. Registra el
          material para la trazabilidad del par.
        </div>
        <form action={confectionDoneAction}>
          {hid}
          <label>Material y lote de material</label>
          <input name="material" defaultValue={kase.material ?? ""} placeholder="Ej.: EVA-45 lote M-2211" style={{ maxWidth: 280 }} required />
          <div className="sp" />
          <button type="submit" className="pri">
            Par terminado → control de calidad
          </button>
        </form>
      </>
    );

  if (kase.state === "CALIDAD")
    zone = (
      <>
        <h3>Control de calidad</h3>
        <div className="muted" style={{ margin: "4px 0 10px" }}>
          Verifica el par contra el diseño y la pauta. Sin los cuatro puntos y la foto no se aprueba.
        </div>
        <form action={qcOkAction}>
          {hid}
          {QC_CHECKS.map(([k, label]) => (
            <label className="chk qc" key={k}>
              <input type="checkbox" name={`qc_${k}`} required /> {label}
            </label>
          ))}
          <CheckLine ok={!!kase.qcPhotoUrl}>Foto del par terminado (obligatoria)</CheckLine>
          <FotoCalidad caseId={kase.id} actual={kase.qcPhotoUrl} />
          <div className="grid g2" style={{ marginTop: 6 }}>
            <div>
              <label>Transportista</label>
              <input name="carrier" placeholder="Sendcloud / Correos / mensajería" />
            </div>
            <div>
              <label>Nº de seguimiento (si ya lo tienes)</label>
              <input name="tracking" placeholder={`TRK-${kase.number}-ES`} />
            </div>
          </div>
          <div className="sp" />
          <button type="submit" className="pri" disabled={!kase.qcPhotoUrl}>
            Calidad OK → enviar a {kase.delivery === "CLINICA" ? "la clínica" : "domicilio"}
          </button>
        </form>
        <div className="sp" />
        <details>
          <summary className="muted" style={{ cursor: "pointer" }}>
            El par no pasa el control
          </summary>
          <form action={qcFailAction} className="row" style={{ marginTop: 8 }}>
            {hid}
            <input name="reason" placeholder="Defecto encontrado" style={{ flex: 1, minWidth: 200 }} />
            <button type="submit" className="warn">
              No pasa → rehacer en confección
            </button>
          </form>
        </details>
      </>
    );

  if (kase.state === "ENVIADO")
    zone = (
      <>
        <h3>Envío en curso</h3>
        <div className="muted" style={{ margin: "4px 0 10px" }}>
          Destino:{" "}
          {kase.delivery === "CLINICA"
            ? `recogida en clínica — ${kase.clinic.name}, ${kase.clinic.address}, ${kase.clinic.postalCode} ${kase.clinic.town}`
            : "domicilio del paciente"}
          {kase.shipment?.shippedAt ? ` · enviado el ${fmtd(kase.shipment.shippedAt)}` : ""}
        </div>
        <form action={updateShipmentAction} className="grid g2">
          {hid}
          <div>
            <label>Transportista</label>
            <input name="carrier" defaultValue={kase.shipment?.carrier ?? ""} />
          </div>
          <div>
            <label>Nº de seguimiento</label>
            <input name="tracking" defaultValue={kase.shipment?.tracking ?? ""} required />
          </div>
          <div>
            <button type="submit">Actualizar seguimiento</button>
          </div>
        </form>
        <div className="sp" />
        <form action={deliveredAction}>
          {hid}
          <button type="submit" className="pri">
            Confirmar entrega
          </button>
          <span className="tiny" style={{ marginLeft: 10 }}>
            En producción lo confirmará el webhook del transportista.
          </span>
        </form>
      </>
    );

  return (
    <>
      <ProdSteps state={kase.state} fabPhase={kase.fabPhase} />
      <div className="row between" style={{ marginBottom: 12 }}>
        <div className="row">
          {sla && (
            <span className={`pill ${sla.nivel === "fuera" ? "r" : sla.nivel === "ajustado" ? "a" : "g"}`}>
              Plazo: {sla.texto}
            </span>
          )}
          {kase.lot && <span className="pill n">Lote {kase.lot}</span>}
          {kase.material && <span className="pill n">{kase.material}</span>}
          <span className="pill b">{kase.delivery === "CLINICA" ? "Recogida en clínica" : "Envío a domicilio"}</span>
        </div>
        <form action={releaseCaseAction} className="row">
          {hid}
          <Link href={`/caso/${kase.id}/hoja`} className="btn" target="_blank">
            Hoja de trabajo
          </Link>
          <button type="submit">Soltar caso</button>
        </form>
      </div>
      <div className="taller-grid">
        <div className="card">{zone}</div>
        <div className="card ficha">
          <b style={{ fontFamily: "var(--font-sora)" }}>Ficha de fabricación</b>
          {rx ? (
            <>
              <div className="tiny" style={{ marginTop: 8 }}>
                PAUTA DE FABRICACIÓN · {rx.prescriberName}
              </div>
              <p className="pauta">{rx.fabricationOrder}</p>
              <div className="tiny">POR PIE (lo que va en cada etiqueta de molde)</div>
              <div className="pies">
                {pies.map((t) => (
                  <div key={t.pie} className={`pie ${t.especifica ? "esp" : ""}`}>
                    <div className="lado">{t.pie}</div>
                    <div>
                      <b>{t.nombre}</b>
                      {t.especifica ? <div>{t.pauta}</div> : <div className="muted">Igual que la receta general</div>}
                      {t.datos.length > 0 && <div className="tiny">{t.datos.join(" · ")}</div>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="tiny">DIAGNÓSTICO</div>
              <p className="muted" style={{ margin: "2px 0 10px" }}>
                {rx.diagnosis}
              </p>
            </>
          ) : (
            <div className="note r" style={{ marginTop: 8 }}>
              Sin prescripción firmada: no se fabrica.
            </div>
          )}
          <div className="tiny">DATOS QUE CONDICIONAN EL PAR</div>
          {ficha.length ? (
            <dl className="ficha-dl">
              {ficha.map(([l, v]) => (
                <div key={l}>
                  <dt>{l}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="muted">Sin datos del cuestionario.</div>
          )}
          <div className="tiny" style={{ marginTop: 10 }}>
            ESCANEO
          </div>
          <div className="muted">
            Proyecto Revo Scan <b>«{proyecto}»</b> en la carpeta compartida de <b>{kase.clinic.name}</b>
          </div>
        </div>
      </div>
    </>
  );
}
