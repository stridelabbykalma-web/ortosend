import type { Capture, Case, MediaAsset, Patient, Prescription, User } from "@prisma/client";
import { checklistOf } from "@/lib/cases";
import { MEDIA_LABEL, VIDEO_COUNT } from "@/lib/format";

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
          <div className="tiny">VÍDEOS DE MARCHA ({VIDEO_COUNT})</div>
          <div className="muted">
            {cl.videos}/{VIDEO_COUNT} confirmados por el servidor
          </div>
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
