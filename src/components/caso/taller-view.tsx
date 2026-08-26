import type { Case, Clinic, Payment, Prescription, Shipment } from "@prisma/client";
import { CheckLine } from "@/components/ui";
import {
  acceptCaseAction,
  attachQcPhotoAction,
  captureIncidentAction,
  confectionDoneAction,
  deliveredAction,
  designDoneAction,
  phaseDoneAction,
  qcFailAction,
  qcOkAction,
  releaseCaseAction,
} from "@/app/panel/taller-actions";

type CaseTaller = Case & {
  clinic: Clinic;
  prescription: Prescription | null;
  payment: Payment | null;
  shipment: Shipment | null;
};

// Zona de trabajo del taller según la fase del caso.
export function TallerView({ kase }: { kase: CaseTaller }) {
  let zone: React.ReactNode = null;
  const hid = <input type="hidden" name="caseId" value={kase.id} />;

  if (kase.state === "ENTRADA_TALLER")
    zone = (
      <>
        <b>Aceptación técnica (entrada)</b>
        <CheckLine ok={!!kase.prescription}>
          Prescripción firmada adjunta ({kase.prescription?.prescriberName ?? "—"})
        </CheckLine>
        <CheckLine ok={!!kase.payment?.paidAt}>Pago confirmado — 199,99 €</CheckLine>
        <form action={acceptCaseAction}>
          {hid}
          <label className="chk">
            <input type="checkbox" name="scanOk" required /> El escaneo abre correctamente y tiene
            resolución suficiente (ambos pies)
          </label>
          <div className="sp" />
          <button type="submit" className="pri">
            Aceptar → a diseño (imprime etiquetas + hoja)
          </button>
        </form>
        <div className="sp" />
        <form action={captureIncidentAction} className="row">
          {hid}
          <input name="reason" placeholder="Motivo de la incidencia de captura" style={{ flex: 1, minWidth: 180 }} />
          <button type="submit" className="warn">
            Incidencia de captura → devolver a clínica
          </button>
        </form>
      </>
    );

  if (kase.state === "DISENO")
    zone = (
      <>
        <b>Diseño</b>
        <div className="muted">
          Diseña sobre el escaneo 3D siguiendo la pauta de la prescripción. Al terminar, el archivo
          CAD queda archivado para reposiciones y revisión anual.
        </div>
        <form action={designDoneAction}>
          {hid}
          <label>Lote de mecanizado (los moldes se agrupan en tandas de CNC)</label>
          <input name="lot" placeholder="Ej.: L-09" style={{ maxWidth: 140 }} />
          <div className="sp" />
          <button type="submit" className="pri">
            Diseño terminado (CAD adjunto) → fabricación
          </button>
        </form>
      </>
    );

  if (kase.state === "FABRICACION" && kase.fabPhase === "MECANIZADO")
    zone = (
      <>
        <b>Fabricación — Mecanizado CNC del molde</b>
        <form action={phaseDoneAction}>
          {hid}
          <label>Lote de mecanizado</label>
          <input name="lot" defaultValue={kase.lot ?? ""} placeholder="L-09" style={{ maxWidth: 140 }} />
          <div className="tiny" style={{ margin: "6px 0" }}>
            Los moldes se agrupan en tandas de CNC para aprovechar material y preparación de máquina.
          </div>
          <button type="submit" className="pri">
            Molde mecanizado → confección a mano
          </button>
        </form>
      </>
    );

  if (kase.state === "FABRICACION" && kase.fabPhase === "CONFECCION")
    zone = (
      <>
        <b>Fabricación — Confección a mano</b>
        <div className="muted">
          Trabajo artesanal sobre el molde según la hoja de trabajo. Registra el material para
          trazabilidad.
        </div>
        <form action={confectionDoneAction}>
          {hid}
          <label>Material / lote de material</label>
          <input name="material" defaultValue={kase.material ?? ""} placeholder="Ej.: EVA-45 lote M-2211" style={{ maxWidth: 240 }} />
          <div className="sp" />
          <button type="submit" className="pri">
            Terminado → calidad
          </button>
        </form>
      </>
    );

  if (kase.state === "CALIDAD")
    zone = (
      <>
        <b>Control de calidad</b>
        {["Medidas conformes al diseño", "Acabados y pulido", "Marcado I/D correcto", "Etiquetado del par"].map(
          (x) => (
            <CheckLine ok={false} key={x}>
              {x} (verificación manual)
            </CheckLine>
          )
        )}
        <CheckLine ok={!!kase.qcPhotoUrl}>
          Foto del par adjunta (obligatoria)
          {!kase.qcPhotoUrl && (
            <form action={attachQcPhotoAction}>
              {hid}
              <button type="submit">Adjuntar foto</button>
            </form>
          )}
        </CheckLine>
        <div className="row" style={{ marginTop: 10 }}>
          <form action={qcOkAction}>
            {hid}
            <button type="submit" className="pri">
              Calidad OK → envío
            </button>
          </form>
        </div>
        <div className="sp" />
        <form action={qcFailAction} className="row">
          {hid}
          <input name="reason" placeholder="Defecto encontrado" style={{ flex: 1, minWidth: 160 }} />
          <button type="submit" className="warn">
            No pasa → rehacer
          </button>
        </form>
      </>
    );

  if (kase.state === "ENVIADO")
    zone = (
      <>
        <b>Envío</b>
        <div className="muted">
          Destino:{" "}
          {kase.delivery === "CLINICA"
            ? `Recogida en clínica — ${kase.clinic.name} (${kase.clinic.address})`
            : "Domicilio del paciente"}
        </div>
        {kase.shipment?.tracking && (
          <div className="tiny" style={{ marginTop: 8 }}>
            Seguimiento: {kase.shipment.tracking} · {kase.shipment.carrier}
          </div>
        )}
        <form action={deliveredAction} style={{ marginTop: 10 }}>
          {hid}
          <button type="submit" className="pri">
            Confirmar entrega (en producción: webhook del transportista)
          </button>
        </form>
      </>
    );

  return (
    <>
      <div className="note a row between">
        <span>Caso asociado a ti hasta completar la fase, soltarlo o cerrar sesión.</span>
        <form action={releaseCaseAction}>
          {hid}
          <button type="submit">Soltar caso</button>
        </form>
      </div>
      <div className="sp" />
      <div className="card">{zone}</div>
      {kase.prescription && (
        <>
          <div className="sp" />
          <div className="card" style={{ background: "var(--paper)" }}>
            <b style={{ fontFamily: "var(--font-sora)" }}>Hoja de trabajo — caso #{kase.number}</b>
            <div className="tiny">
              Acompaña físicamente al par por el taller · QR al caso · 2 etiquetas de molde (I / D)
            </div>
            <p style={{ marginTop: 8 }}>
              <b>El problema:</b> {kase.prescription.diagnosis}. {kase.prescription.assessment}
            </p>
            <p>
              <b>Modificaciones a ejecutar:</b> {kase.prescription.fabricationOrder}
            </p>
            <p className="tiny">
              Prescripción firmada por {kase.prescription.prescriberName} · Fases: mecanizado CNC →
              confección a mano → calidad → envío
            </p>
          </div>
        </>
      )}
    </>
  );
}
