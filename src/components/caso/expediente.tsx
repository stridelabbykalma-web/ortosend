import type { Capture, Case, MediaAsset, Patient, Prescription, User } from "@prisma/client";
import { checklistOf } from "@/lib/cases";

type CaseFull = Case & {
  patient: Patient & { owner: User };
  capture: (Capture & { media: MediaAsset[] }) | null;
  prescription: Prescription | null;
};

// Expediente del estudio: lo que ve cualquier rol clínico/taller sobre la captura.
export function Expediente({ kase }: { kase: CaseFull }) {
  const cp = kase.capture;
  const q = cp?.questionnaire as { motivo?: string; dolor?: string; actividad?: string } | null;
  const e = cp?.physicalExam as { tobillo?: string; hallux?: string; dismetria?: string; alza?: string } | null;
  const cl = checklistOf(cp);
  return (
    <div className="card">
      <b style={{ fontFamily: "var(--font-sora)" }}>Expediente del estudio</b>
      <div className="grid g2" style={{ marginTop: 10 }}>
        <div>
          <div className="tiny">CUESTIONARIO CLÍNICO</div>
          <div className="muted">
            {q ? (
              <>
                Motivo: {q.motivo}
                <br />
                Dolor: {q.dolor || "—"} · Actividad: {q.actividad || "—"}
              </>
            ) : (
              "Pendiente"
            )}
          </div>
        </div>
        <div>
          <div className="tiny">EXPLORACIÓN FÍSICA</div>
          <div className="muted">
            {e ? (
              <>
                Tobillo: {e.tobillo}
                {e.hallux ? <> · Hallux: {e.hallux}</> : null}
                <br />
                Dismetría: {e.dismetria}
                {e.alza && e.alza !== "No" ? (
                  <>
                    {" "}
                    · <b>Alza: {e.alza}</b>
                  </>
                ) : null}
              </>
            ) : (
              "Pendiente"
            )}
          </div>
        </div>
        <div>
          <div className="tiny">ESCANEO 3D</div>
          <div className="muted">{cl.escaneos ? "Ambos pies ✓ (visor 3D pendiente)" : "Pendiente"}</div>
        </div>
        <div>
          <div className="tiny">VÍDEOS (7)</div>
          <div className="muted">{cl.videos}/7 confirmados por el servidor</div>
        </div>
        <div>
          <div className="tiny">BAROPODOMETRÍA</div>
          <div className="muted">{cl.baro ? "Estática 2/2 · Dinámica ✓ · Informe adjunto" : "Pendiente"}</div>
        </div>
        <div>
          <div className="tiny">PACIENTE</div>
          <div className="muted">
            {kase.patient.owner.phone ?? "—"} · {kase.patient.owner.email ?? "—"}
          </div>
        </div>
      </div>
      {kase.prescription && (
        <>
          <div className="sp" />
          <div className="note g">
            <b>Prescripción firmada</b> por {kase.prescription.prescriberName} ·{" "}
            {kase.prescription.diagnosis} · Pauta: {kase.prescription.fabricationOrder}
          </div>
        </>
      )}
      {kase.rxDraft && (
        <div className="note a" style={{ marginTop: 8 }}>
          <b>Borrador de valoración guardado:</b> {kase.rxDraft}
        </div>
      )}
    </div>
  );
}

export function Historial({ events }: { events: { id: string; at: Date; text: string; actor: string }[] }) {
  return (
    <>
      <div className="sp" />
      <div className="card">
        <b>Historial</b>
        <table style={{ marginTop: 8 }}>
          <tbody>
            {events.map((h) => (
              <tr key={h.id}>
                <td className="tiny" style={{ width: 90 }}>
                  {new Date(h.at).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                </td>
                <td>{h.text}</td>
                <td className="tiny">{h.actor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
