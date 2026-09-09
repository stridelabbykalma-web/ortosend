import type { Capture, Case, MediaAsset, Patient, Prescription, User } from "@prisma/client";
import { checklistOf } from "@/lib/cases";
import { questionnaireLines, type Questionnaire } from "@/lib/questionnaire";
import { examLines, type Exam } from "@/lib/exploracion";
import { alertasDe } from "@/lib/tests-podologicos";
import { CAPTURA_VISUAL, FOTO_KINDS, MEDIA_LABEL, SCAN_KIND, VIDEO_KINDS, fmtdt } from "@/lib/format";
import { nombreProyectoRevoScan } from "@/lib/scan";
import { helbingResumen, type Helbing } from "@/lib/helbing";
import { HelbingOverlay } from "@/components/caso/helbing-overlay";
import { VideoAnalizado } from "@/components/caso/video-analizado";
import type { MarchaInforme, MarchaTrack } from "@/lib/marcha";

type CaseFull = Case & {
  patient: Patient & { owner: User };
  clinic: { name: string };
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
          <Escaneos
            media={cp?.media ?? []}
            hecho={cl.escaneos}
            proyecto={nombreProyectoRevoScan(kase.patient.name, kase.patient.owner.phone, kase.number)}
            clinica={kase.clinic.name}
          />
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

// Modelos 3D de las espumas: llegan desde el PC del escáner al almacén común y
// desde aquí el taller (o quien receta) los descarga con la URL autenticada.
// Escaneo de las espumas: la clínica lo guarda en su carpeta compartida con el
// nombre que dictó el asistente; el taller lo abre en Revo Scan por ese nombre.
function Escaneos({
  media,
  hecho,
  proyecto,
  clinica,
}: {
  media: MediaAsset[];
  hecho: boolean;
  proyecto: string;
  clinica: string;
}) {
  if (!hecho) return <div className="muted">Pendiente</div>;
  const marcado = media.find((m) => m.kind === SCAN_KIND && m.confirmedAt);
  const nombre = (marcado?.meta as { proyecto?: string } | null)?.proyecto ?? proyecto;
  return (
    <div className="muted">
      Proyecto Revo Scan <b>«{nombre}»</b>
      <br />
      en la carpeta compartida de <b>{clinica}</b> · abrir en Revo Scan → Un clic → Exportar
    </div>
  );
}

// Visor de las capturas reales subidas desde el estudio web (vídeos y fotos).
// Solo hay archivo servible cuando la URL apunta a /api/media (subida confirmada).
function MediaGallery({ media }: { media: MediaAsset[] }) {
  // Los escaneos 3D no se ven aquí: tienen su botón de descarga en la ficha.
  const files = media.filter((m) => m.confirmedAt && m.url.startsWith("/api/media/") && m.kind !== SCAN_KIND);
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
            helbing?: Helbing;
            perthes?: Helbing;
            marcha?: { track: MarchaTrack; informe: MarchaInforme };
          } | null;
          const isVideo = m.kind.startsWith("video_");
          const hb = meta?.helbing;
          const pt = meta?.perthes;
          const label = MEDIA_LABEL[m.kind] ?? m.kind;
          // La única foto posterior se presenta DOS veces: una con la línea de
          // Helbing y otra con la regla de Perthes. No hace falta otra foto.
          if (!isVideo && (hb || pt)) {
            const vistas: { key: string; titulo: string; hb?: Helbing; pt?: Helbing; resumen: string }[] = [];
            if (hb) vistas.push({ key: "hb", titulo: "Línea de Helbing (tendón de Aquiles)", hb, resumen: helbingResumen(hb) });
            if (pt) vistas.push({ key: "pt", titulo: "Regla de Perthes (eje del calcáneo)", pt, resumen: helbingResumen(pt) });
            return vistas.map((v) => (
              <figure key={`${m.id}-${v.key}`} className="media-item">
                <div className="photo-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={`${label} — ${v.titulo}`} loading="lazy" />
                  <HelbingOverlay hb={v.hb} pt={v.pt} />
                </div>
                <figcaption className="tiny">
                  <b>{v.titulo}</b>
                  <br />
                  {v.resumen} <span>(orientativa · sobre la {label.toLowerCase()})</span>
                </figcaption>
              </figure>
            ));
          }
          // Vídeo de marcha con puntos e informe preliminar: ocupa todo el ancho
          if (isVideo && meta?.marcha) {
            return (
              <figure key={m.id} className="media-item" style={{ gridColumn: "1 / -1" }}>
                <figcaption className="tiny" style={{ marginBottom: 4 }}>
                  <b>{label}</b>
                  {meta.seconds ? ` · ${meta.seconds} s` : ""} · con puntos de referencia e informe preliminar
                </figcaption>
                <VideoAnalizado src={m.url} track={meta.marcha.track} informe={meta.marcha.informe} />
              </figure>
            );
          }
          return (
            <figure key={m.id} className="media-item">
              {isVideo ? (
                <video src={m.url} controls playsInline preload="metadata" />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={m.url} alt={label} loading="lazy" />
              )}
              <figcaption className="tiny">
                {label}
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
