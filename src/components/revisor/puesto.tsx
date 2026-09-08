import Link from "next/link";
import type { Capture, Case, CaseEvent, Clinic, Incident, MediaAsset, Patient, User } from "@prisma/client";
import { checklistOf } from "@/lib/cases";
import { questionnaireLines, type Questionnaire } from "@/lib/questionnaire";
import { examLines, fpiLabel, type Exam } from "@/lib/exploracion";
import { CAPTURA_VISUAL, fmtd, fmtdt, VIDEO_KINDS, FOTO_KINDS } from "@/lib/format";
import { OPEN_CASE_TIMEOUT_MIN } from "@/lib/states";
import {
  agrupa,
  ahoraMs,
  E_GRUPOS,
  edad,
  hace,
  imc,
  NUCLEO_LABELS,
  Q_GRUPOS,
  sintesisComoTexto,
  sintesisDe,
} from "@/lib/revisor";
import { unmarkHardAction } from "@/app/panel/rx-actions";
import { StatePill } from "@/components/ui";
import { MediaGallery } from "@/components/caso/expediente";
import { RxView } from "@/components/caso/rx-view";

export type CasoRevisor = Case & {
  patient: Patient & { owner: User };
  clinic: Clinic;
  capture: (Capture & { media: MediaAsset[] }) | null;
  incidents: Incident[];
  events: CaseEvent[];
};

const SECCIONES: [string, string][] = [
  ["resumen", "Resumen"],
  ["claves", "Puntos clave"],
  ["exploracion", "Exploración y tests"],
  ["medios", "Vídeos y fotos"],
  ["historial", "Historial"],
];

const NIVEL_PILL: Record<string, [string, string]> = {
  alerta: ["r", "alerta"],
  revisar: ["a", "revisar"],
  nota: ["n", "nota"],
};

// Puesto del revisor: expediente por secciones a la izquierda y la
// prescripción fija a la derecha. Todo lo que ayuda a decidir, de un vistazo.
export function PuestoRevisor({
  kase: k,
  collegiateNum,
  ahora = ahoraMs(),
}: {
  kase: CasoRevisor;
  collegiateNum: string | null;
  ahora?: number;
}) {
  const cp = k.capture;
  const q = (cp?.questionnaire as Questionnaire | null) ?? null;
  const e = (cp?.physicalExam as Exam | null) ?? null;
  const cl = checklistOf(cp);
  const media = cp?.media ?? [];
  const sintesis = sintesisDe(q, e, media);
  const alertas = sintesis.claves.filter((c) => c.nivel === "alerta");
  const qLines = questionnaireLines(q);
  const eLines = examLines(e);
  const qGrupos = agrupa(qLines, Q_GRUPOS, "Otros datos");
  const eGrupos = agrupa(eLines, E_GRUPOS, "Tests complementarios", [...NUCLEO_LABELS, "FPI-6", "Tests complementarios"]);
  const years = edad(k.patient.birthDate);
  const bmi = imc(q?.peso, q?.altura);
  const dolor = q?.dolor ? Number(String(q.dolor).split("/")[0]) : NaN;
  const abiertas = k.incidents.filter((i) => !i.closedAt);
  const filesOk = media.filter((m) => m.confirmedAt && m.url.startsWith("/api/media/")).length;

  return (
    <>
      <div className="rev-head">
        <div className="rev-head-in">
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="row" style={{ gap: 10 }}>
              <h2>
                Caso #{k.number} · {k.patient.name}
              </h2>
              <StatePill state={k.state} />
            </div>
            <div className="tiny">
              {years !== null ? `${years} años · ` : ""}
              {k.clinic.name} ({k.clinic.town}) · estudio {cp?.completedAt ? `cerrado ${fmtd(cp.completedAt)}` : "en curso"} ·
              flujo {k.flow}
            </div>
          </div>
          <div className="rev-timer">
            {k.openAt ? (
              <>
                Abierto por ti {hace(k.openAt, ahora)} · se libera a los {OPEN_CASE_TIMEOUT_MIN} min sin actividad
              </>
            ) : k.assignedTo ? (
              <>Asignado a ti hasta resolver el contacto</>
            ) : null}
          </div>
          <a href="#salidas" className="btn">
            Otras salidas
          </a>
        </div>
      </div>

      <div className="rev-subnav">
        {SECCIONES.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </div>

      {alertas.length > 0 && (
        <div className="note r" style={{ marginBottom: 14 }}>
          <b>Hallazgos de alerta</b> — no se resuelven con una plantilla; valorar antes de prescribir:
          <ul style={{ margin: "6px 0 0 18px" }}>
            {alertas.map((a) => (
              <li key={a.texto}>{a.texto}</li>
            ))}
          </ul>
        </div>
      )}
      {k.hardAt && (
        <div className="note a rev-hard-note" style={{ marginBottom: 14 }}>
          <div>
            <b>Caso marcado como complicado</b> por {k.hardByName ?? "un compañero"} {hace(k.hardAt, ahora)}:{" "}
            {k.hardNote}
          </div>
          <form action={unmarkHardAction}>
            <input type="hidden" name="caseId" value={k.id} />
            <button type="submit">Retirar la marca</button>
          </form>
        </div>
      )}
      {abiertas.length > 0 && (
        <div className="note a" style={{ marginBottom: 14 }}>
          <b>Incidencias abiertas:</b>{" "}
          {abiertas.map((i) => `${i.reason} (${i.openedBy}, ${fmtd(i.createdAt)})`).join(" · ")}
        </div>
      )}
      {k.rxDraft && (
        <div className="note a" style={{ marginBottom: 14 }}>
          <b>Tienes un borrador guardado</b> — ya está cargado en la valoración de la derecha.
        </div>
      )}

      <div className="rev-layout">
        <div className="rev-main">
          {/* --- Resumen --- */}
          <section id="resumen" className="card rev-sec">
            <h3>
              Resumen del caso <span className="tiny">· cuestionario clínico de la clínica</span>
            </h3>
            {q ? (
              <>
                <div className="rev-facts">
                  <div className="rev-fact wide">
                    <div className="k">Motivo de consulta</div>
                    <div className="v" style={{ fontSize: 15 }}>
                      {q.motivo || "—"}
                    </div>
                  </div>
                  <div className="rev-fact">
                    <div className="k">Dolor</div>
                    <div className="v rev-dolor">
                      <span>{q.dolor ? (String(q.dolor).includes("/") ? q.dolor : `${q.dolor}/10`) : "—"}</span>
                      {!isNaN(dolor) && (
                        <span className="bar">
                          <i style={{ width: `${Math.max(0, Math.min(10, dolor)) * 10}%` }} />
                        </span>
                      )}
                    </div>
                  </div>
                  <Fact k="Lado" v={q.lado} />
                  <Fact k="Zonas" v={q.zonas?.join(", ")} />
                  <Fact k="Evolución" v={q.evolucion} />
                  <Fact k="Tipo de síntoma" v={q.tipoSintoma} />
                  <Fact k="Cuándo duele" v={q.momentos?.join(", ")} />
                  <Fact k="Actividad" v={[q.actividad, q.deporte].filter(Boolean).join(" · ")} />
                  <Fact k="De pie al día" v={q.horasPie} />
                  <Fact k="Profesión" v={q.profesion} />
                  <Fact
                    k="Peso · altura · talla"
                    v={[q.peso ? `${q.peso} kg` : "", q.altura ? `${q.altura} cm` : "", q.tallaCalzado ? `EU ${q.tallaCalzado}` : ""].filter(Boolean).join(" · ")}
                  />
                  <Fact k="IMC" v={bmi ?? undefined} />
                  <Fact k="Calzado habitual" v={q.calzado?.join(", ")} />
                  <Fact k="Desgaste" v={q.desgaste} />
                  <Fact k="Plantillas previas" v={q.plantillasPrevias} />
                </div>
                {qGrupos
                  .filter(([t]) => t === "Antecedentes y tratamientos" || t === "Observaciones de la clínica" || t === "Otros datos")
                  .map(([titulo, ls]) => (
                    <div key={titulo} style={{ marginTop: 12 }}>
                      <div className="tiny" style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>
                        {titulo}
                      </div>
                      <div className="rev-kv" style={{ marginTop: 4 }}>
                        {ls.map(([l, v]) => (
                          <div key={l}>
                            <b>{l}:</b> {v}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </>
            ) : (
              <div className="muted">La clínica no ha rellenado el cuestionario.</div>
            )}
            <div className="tiny" style={{ marginTop: 12 }}>
              Contacto del paciente: {k.patient.owner.phone ?? "—"} · {k.patient.owner.email ?? "—"}
              {k.patient.isMinor ? " · menor (titular: adulto)" : ""}
            </div>
          </section>

          {/* --- Puntos clave --- */}
          <section id="claves" className="card rev-sec">
            <h3>
              Puntos clave del estudio{" "}
              <span className="tiny">· primer barrido automático, orientativo; decide tú</span>
            </h3>
            {sintesis.claves.length ? (
              <div>
                {sintesis.claves.map((c, i) => (
                  <div className="rev-clave" key={i}>
                    <span className={`pill ${NIVEL_PILL[c.nivel][0]}`}>{NIVEL_PILL[c.nivel][1]}</span>
                    <span>
                      {c.texto}
                      <span className="src">{c.fuente}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">Nada que destacar: valores dentro de lo esperado o estudio sin datos.</div>
            )}
            {sintesis.plantilla.length > 0 && (
              <div className="note g" style={{ marginTop: 12 }}>
                <b>Qué sugieren los vídeos y la exploración para la plantilla</b>
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {sintesis.plantilla.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <div className="tiny" style={{ marginTop: 4, color: "inherit", opacity: 0.8 }}>
                  Cada línea aparece como chip ✦ en la pauta de fabricación, a la derecha.
                </div>
              </div>
            )}
          </section>

          {/* --- Exploración --- */}
          <section id="exploracion" className="card rev-sec">
            <h3>
              Exploración biomecánica y tests{" "}
              <span className="tiny">· {cl.exploracion ? "completa" : "incompleta"}</span>
            </h3>
            {e ? (
              <>
                {eGrupos
                  .filter(([t]) => t === "Tipo de pie y movilidad")
                  .map(([titulo, ls]) => (
                    <Bloque key={titulo} titulo={titulo} lines={ls} />
                  ))}
                <div style={{ marginTop: 14 }}>
                  <div className="tiny" style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>
                    Núcleo · 5 tests obligatorios + FPI-6
                  </div>
                  <table className="rev-nucleo" style={{ marginTop: 4 }}>
                    <thead>
                      <tr>
                        <th>Test</th>
                        <th>Izquierda</th>
                        <th>Derecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      <Fila t="FPI-6" i={fpiLabel(e.fpiIzq)} d={fpiLabel(e.fpiDcho)} />
                      <Fila t="Jack / Hubscher" i={e.jackIzq} d={e.jackDcho} />
                      <Fila t="Navicular drop" i={e.navDropIzq} d={e.navDropDcho} u=" mm" warn={(v) => Number(v) >= 10} />
                      <Fila t="Resistencia a la supinación" i={e.resistSupIzq} d={e.resistSupDcho} />
                      <Fila t="Lunge (knee-to-wall)" i={e.lungeIzq} d={e.lungeDcha} u=" cm" warn={(v) => Number(v) < 10} />
                      <Fila t="Single heel rise" i={e.singleHeelIzq} d={e.singleHeelDcho} warn={(v) => !v.startsWith("Normal")} />
                    </tbody>
                  </table>
                </div>
                {eGrupos
                  .filter(([t]) => t !== "Tipo de pie y movilidad")
                  .map(([titulo, ls]) => (
                    <Bloque key={titulo} titulo={titulo} lines={ls} />
                  ))}
              </>
            ) : (
              <div className="muted">La clínica no ha registrado la exploración.</div>
            )}
          </section>

          {/* --- Vídeos y fotos --- */}
          <section id="medios" className="card rev-sec">
            <h3>
              Vídeos, fotos y pruebas instrumentales{" "}
              <span className="tiny">
                · {cl.capturas}/{CAPTURA_VISUAL.length} capturas confirmadas
              </span>
            </h3>
            <div className="rev-facts" style={{ marginBottom: 6 }}>
              <div className="rev-fact">
                <div className="k">Vídeos de marcha</div>
                <div className="v">
                  {VIDEO_KINDS.filter(([kind]) => media.some((m) => m.kind === kind && m.confirmedAt)).length}/{VIDEO_KINDS.length}{" "}
                  <span className="tiny">descalzo</span>
                </div>
              </div>
              <div className="rev-fact">
                <div className="k">Fotos de los pies</div>
                <div className="v">
                  {FOTO_KINDS.filter(([kind]) => media.some((m) => m.kind === kind && m.confirmedAt)).length}/{FOTO_KINDS.length}{" "}
                  <span className="tiny">en carga</span>
                </div>
              </div>
              <div className="rev-fact">
                <div className="k">Baropodometría</div>
                <div className="v">{cl.baro ? "Hecha ✓" : "Pendiente"}</div>
                <div className="tiny">informe en Podisense</div>
              </div>
              <div className="rev-fact">
                <div className="k">Escaneo de espumas</div>
                <div className="v">{cl.escaneos ? "Hecho ✓" : "Pendiente"}</div>
                <div className="tiny">llega del escáner</div>
              </div>
            </div>
            {filesOk === 0 && (
              <div className="muted">
                Las capturas de este caso no tienen archivo reproducible aquí (datos de demo o subida no confirmada).
              </div>
            )}
            <MediaGallery media={media} />
          </section>

          {/* --- Historial --- */}
          <section id="historial" className="card rev-sec">
            <h3>Historial del caso</h3>
            <table>
              <tbody>
                {k.events.map((h) => (
                  <tr key={h.id}>
                    <td className="tiny" style={{ width: 110, whiteSpace: "nowrap" }}>
                      {fmtdt(h.at)}
                    </td>
                    <td>{h.text}</td>
                    <td className="tiny" style={{ whiteSpace: "nowrap" }}>
                      {h.actor}
                    </td>
                  </tr>
                ))}
                {k.incidents.map((i) => (
                  <tr key={i.id}>
                    <td className="tiny" style={{ whiteSpace: "nowrap" }}>
                      {fmtdt(i.createdAt)}
                    </td>
                    <td>
                      <span className={`pill ${i.closedAt ? "n" : "a"}`}>incidencia</span> {i.reason}
                      {i.resolution ? ` — ${i.resolution}` : ""}
                    </td>
                    <td className="tiny">{i.openedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12 }}>
              <Link href="/panel">← Volver a la mesa de valoración</Link>
            </div>
          </section>
        </div>

        <aside className="rev-side" id="salidas">
          <RxView
            kase={k}
            collegiateNum={collegiateNum}
            sintesisTexto={sintesis.claves.length ? sintesisComoTexto(sintesis) : undefined}
            plantillaSugerida={sintesis.plantilla}
          />
        </aside>
      </div>
    </>
  );
}

function Fact({ k, v }: { k: string; v?: string | null }) {
  if (!v) return null;
  return (
    <div className="rev-fact">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function Bloque({ titulo, lines }: { titulo: string; lines: [string, string][] }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div className="tiny" style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>
        {titulo}
      </div>
      <div className="rev-kv" style={{ marginTop: 4 }}>
        {lines.map(([l, v]) => (
          <div key={l}>
            <b>{l}:</b> {l.startsWith("Alza") ? <b>{v}</b> : v}
          </div>
        ))}
      </div>
    </div>
  );
}

function Fila({
  t,
  i,
  d,
  u = "",
  warn,
}: {
  t: string;
  i?: string;
  d?: string;
  u?: string;
  warn?: (v: string) => boolean;
}) {
  const cell = (v?: string) => {
    if (!v || !v.trim()) return <span className="tiny">—</span>;
    const w = warn ? warn(v) : false;
    return <span style={w ? { color: "var(--amber)", fontWeight: 600 } : undefined}>{v}{u}</span>;
  };
  return (
    <tr>
      <td>{t}</td>
      <td>{cell(i)}</td>
      <td>{cell(d)}</td>
    </tr>
  );
}
