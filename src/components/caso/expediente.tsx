import type { Capture, Case, MediaAsset, Patient, Prescription, User } from "@prisma/client";
import { checklistOf } from "@/lib/cases";
import { questionnaireLines, type Questionnaire } from "@/lib/questionnaire";
import { examLines, type Exam } from "@/lib/exploracion";
import { VIDEO_KINDS } from "@/lib/format";

type CaseFull = Case & {
  patient: Patient & { owner: User };
  capture: (Capture & { media: MediaAsset[] }) | null;
  prescription: Prescription | null;
};

// Expediente del estudio: lo que ve cualquier rol clínico/taller sobre la captura.
export function Expediente({ kase }: { kase: CaseFull }) {
  const cp = kase.capture;
  const q = cp?.questionnaire as Questionnaire | null;
  const e = cp?.physicalExam as Exam | null;
  const cl = checklistOf(cp);
  const qLines = questionnaireLines(q);
  const eLines = examLines(e);
  return (
    <div className="card">
      <b style={{ fontFamily: "var(--font-sora)" }}>Expediente del estudio</b>
      <div style={{ marginTop: 10 }}>
        <div className="tiny">CUESTIONARIO CLÍNICO</div>
        {qLines.length ? (
          <div className="grid g2" style={{ gap: "2px 14px", marginTop: 4 }}>
            {qLines.map(([label, value]) => (
              <div className="muted" key={label}>
                <span style={{ fontWeight: 600 }}>{label}:</span> {value}
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">Pendiente</div>
        )}
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="tiny">EXPLORACIÓN BIOMECÁNICA Y TESTS</div>
        {eLines.length ? (
          <div className="grid g2" style={{ gap: "2px 14px", marginTop: 4 }}>
            {eLines.map(([label, value]) => (
              <div className="muted" key={label}>
                <span style={{ fontWeight: 600 }}>{label}:</span>{" "}
                {label.startsWith("Alza") ? <b>{value}</b> : value}
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">Pendiente</div>
        )}
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div>
          <div className="tiny">VÍDEOS ({VIDEO_KINDS.length})</div>
          <div className="muted">
            {cl.videos}/{VIDEO_KINDS.length} confirmados (de pie, marcha y elevación de talones)
          </div>
        </div>
        <div>
          <div className="tiny">ESCANEO DE ESPUMAS</div>
          <div className="muted">{cl.escaneos ? "Hecho ✓ (llega desde la plataforma del escáner)" : "Pendiente"}</div>
        </div>
        <div>
          <div className="tiny">BAROPODOMETRÍA</div>
          <div className="muted">
            {cl.baro ? "Estática ✓ · Dinámica múltiple ✓ (informe desde Podisense)" : "Pendiente"}
          </div>
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
