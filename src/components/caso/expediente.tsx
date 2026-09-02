import type { Capture, Case, MediaAsset, Patient, Prescription, User } from "@prisma/client";
import { checklistOf } from "@/lib/cases";
import { questionnaireLines, type Questionnaire } from "@/lib/questionnaire";
import { examLines, type Exam } from "@/lib/exploracion";
import { alertasDe } from "@/lib/tests-podologicos";
import { CAPTURA_VISUAL, FOTO_KINDS, MEDIA_LABEL, VIDEO_KINDS } from "@/lib/format";

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
  const alertas = alertasDe(e);
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
      {alertas.length > 0 && (
        <div className="note r" style={{ marginTop: 12 }}>
          <b>Hallazgos de alerta</b> — valorar antes de prescribir:
          <ul style={{ margin: "6px 0 0 18px" }}>
            {alertas.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
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
          <div className="tiny">VÍDEOS Y FOTOS ({CAPTURA_VISUAL.length})</div>
          <div className="muted">
            {cl.capturas}/{CAPTURA_VISUAL.length} confirmados — {VIDEO_KINDS.length} vídeos de
            marcha y {FOTO_KINDS.length} fotos de los pies de cerca
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
      <MediaGallery media={cp?.media ?? []} />
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

// Visor de las capturas reales subidas desde el estudio web (vídeos y fotos).
// Solo hay archivo servible cuando la URL apunta a /api/media (subida confirmada).
function MediaGallery({ media }: { media: MediaAsset[] }) {
  const files = media.filter((m) => m.confirmedAt && m.url.startsWith("/api/media/"));
  if (files.length === 0) return null;
  return (
    <>
      <div className="sp" />
      <div className="tiny">CAPTURAS DEL ESTUDIO (VÍDEOS Y FOTOS)</div>
      <div className="grid g3" style={{ marginTop: 8 }}>
        {files.map((m) => {
          const meta = m.meta as {
            seconds?: number;
            targetSeconds?: number;
            validPct?: number;
            validSeconds?: number;
          } | null;
          const isVideo = m.kind.startsWith("video_");
          return (
            <figure key={m.id} className="media-item">
              {isVideo ? (
                <video src={m.url} controls playsInline preload="metadata" />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={m.url} alt={MEDIA_LABEL[m.kind] ?? m.kind} loading="lazy" />
              )}
              <figcaption className="tiny">
                {MEDIA_LABEL[m.kind] ?? m.kind}
                {meta?.seconds
                  ? ` · ${meta.seconds} s${meta.targetSeconds ? ` de ${meta.targetSeconds} s` : ""}`
                  : ""}
                {typeof meta?.validSeconds === "number"
                  ? ` · encuadre válido ${meta.validSeconds} s`
                  : typeof meta?.validPct === "number"
                    ? ` · encuadre ${meta.validPct}%`
                    : ""}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </>
  );
}
