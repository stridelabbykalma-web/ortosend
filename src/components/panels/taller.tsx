import Link from "next/link";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { releaseStale } from "@/lib/cases";
import { Kpi } from "@/components/ui";
import { fmtd, fmtdt } from "@/lib/format";
import { DELIVERY_PROMISE } from "@/lib/states";
import { PHASES, TALLER_STATES, fabPhaseLabel, siguienteLote, slaDe, type Sla } from "@/lib/taller";
import {
  closeIncidentAction,
  deliveredAction,
  lotDoneAction,
  nextTallerAction,
  setLotAction,
  updateShipmentAction,
} from "@/app/panel/taller-actions";

type CaseRow = Prisma.CaseGetPayload<{
  include: { patient: true; clinic: true; payment: true; shipment: true; incidents: true };
}>;

const TABS: [string, string][] = [
  ["tablero", "Tablero"],
  ["lotes", "Lotes CNC"],
  ["envios", "Envíos"],
  ["incidencias", "Incidencias"],
  ["entregados", "Entregados"],
];

const SLA_ORDER: Record<Sla["nivel"], number> = { fuera: 0, ajustado: 1, ok: 2 };

function rehacerAbierto(c: CaseRow) {
  return c.incidents.some((i) => i.type === "REHACER_DEFECTO" && !i.closedAt);
}

function destino(c: CaseRow) {
  return c.delivery === "CLINICA" ? `Recogida en ${c.clinic.name}` : "Domicilio";
}

function SlaChip({ sla }: { sla: Sla | null }) {
  if (!sla) return <span className="tiny">Sin fecha de pago</span>;
  const cls = sla.nivel === "fuera" ? "r" : sla.nivel === "ajustado" ? "a" : "g";
  return <span className={`pill ${cls}`}>{sla.texto}</span>;
}

export async function PanelTaller({ user, tab }: { user: User; tab?: string }) {
  await releaseStale();
  const t = tab && TABS.some(([k]) => k === tab) ? tab : "tablero";

  const [active, openIncidents, closedIncidents, delivered] = await Promise.all([
    prisma.case.findMany({
      where: { state: { in: TALLER_STATES } },
      include: { patient: true, clinic: true, payment: true, shipment: true, incidents: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.incident.findMany({
      where: { closedAt: null, type: { in: ["CAPTURA_INVALIDA", "REHACER_DEFECTO"] } },
      include: { case: { include: { patient: true, clinic: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.incident.findMany({
      where: { closedAt: { not: null } },
      include: { case: { include: { patient: true } } },
      orderBy: { closedAt: "desc" },
      take: 10,
    }),
    prisma.case.findMany({
      where: { state: { in: ["ENTREGADO", "CERRADO"] } },
      include: { patient: true, clinic: true, payment: true, shipment: true, incidents: true },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  const openIds = [...new Set(active.map((c) => c.openBy).filter((x): x is string => !!x))];
  const openUsers = new Map(
    (await prisma.user.findMany({ where: { id: { in: openIds } }, select: { id: true, name: true } })).map((u) => [
      u.id,
      u.name.split(" ")[0],
    ])
  );

  const slaOf = new Map(active.map((c) => [c.id, slaDe(c)]));
  const produccion = active.filter((c) => c.state !== "ENVIADO");
  const enviados = active.filter((c) => c.state === "ENVIADO");
  const fueraPlazo = produccion.filter((c) => slaOf.get(c.id)?.nivel === "fuera").length;
  const moldesCnc = active.filter((c) => c.state === "FABRICACION" && c.fabPhase === "MECANIZADO");
  const mineOpen = active.find((c) => c.openBy === user.id);

  const ordenar = (cs: CaseRow[]) =>
    [...cs].sort((a, b) => {
      const ra = rehacerAbierto(a) ? -1 : 0;
      const rb = rehacerAbierto(b) ? -1 : 0;
      if (ra !== rb) return ra - rb;
      const sa = slaOf.get(a.id);
      const sb = slaOf.get(b.id);
      const oa = sa ? SLA_ORDER[sa.nivel] : 3;
      const ob = sb ? SLA_ORDER[sb.nivel] : 3;
      if (oa !== ob) return oa - ob;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

  let body: React.ReactNode = null;

  // ---------- Tablero ----------
  if (t === "tablero") {
    body = (
      <>
        {mineOpen ? (
          <div className="note a row between">
            <span>
              Tienes el caso <b>#{mineOpen.number}</b> ({mineOpen.patient.name}) abierto en{" "}
              {PHASES.find(([s]) => s === mineOpen.state)?.[1].toLowerCase()}.
            </span>
            <Link href={`/caso/${mineOpen.id}`} className="btn pri">
              Continuar
            </Link>
          </div>
        ) : (
          <div className="row">
            <form action={nextTallerAction}>
              <button type="submit" className="pri" disabled={produccion.length === 0}>
                Siguiente caso (el más antiguo pendiente)
              </button>
            </form>
            <span className="tiny">O tira de una fase concreta desde su columna.</span>
          </div>
        )}
        <div className="sp" />
        <div className="cols">
          {PHASES.map(([state, label]) => {
            const cs = ordenar(active.filter((c) => c.state === state));
            const enCola = cs.filter((c) => !c.openBy).length;
            return (
              <div className="col" key={state}>
                <div className="row between" style={{ padding: "2px 4px 8px" }}>
                  <h4 style={{ padding: 0 }}>
                    {label} · {cs.length}
                  </h4>
                  {state !== "ENVIADO" && enCola > 0 && !mineOpen && (
                    <form action={nextTallerAction}>
                      <input type="hidden" name="state" value={state} />
                      <button type="submit" className="mini" title={`Abrir el siguiente en ${label.toLowerCase()}`}>
                        Siguiente ▸
                      </button>
                    </form>
                  )}
                </div>
                {cs.length === 0 && (
                  <div className="tiny" style={{ padding: 4 }}>
                    Nada pendiente
                  </div>
                )}
                {cs.map((c) => {
                  const sla = slaOf.get(c.id) ?? null;
                  const rehacer = rehacerAbierto(c);
                  let detalle: string;
                  if (c.state === "FABRICACION")
                    detalle = `${fabPhaseLabel(c.fabPhase)}${c.lot ? ` · ${c.lot}` : " · sin lote"}`;
                  else if (c.state === "ENVIADO")
                    detalle = `${c.shipment?.carrier ?? "—"} · ${c.shipment?.tracking ?? "—"}`;
                  else if (c.openBy) detalle = `Abierto: ${openUsers.get(c.openBy) ?? "—"}`;
                  else detalle = "En cola";
                  return (
                    <Link href={`/caso/${c.id}`} className={`tcard sla-${sla?.nivel ?? "none"}`} key={c.id}>
                      <div className="row between" style={{ gap: 6 }}>
                        <b>#{c.number}</b>
                        <SlaChip sla={sla} />
                      </div>
                      <div style={{ marginTop: 2 }}>{c.patient.name}</div>
                      <div className="tiny">
                        {c.clinic.town} · {c.delivery === "CLINICA" ? "recogida en clínica" : "domicilio"}
                      </div>
                      <div className="tiny">{detalle}</div>
                      {rehacer && (
                        <span className="pill r" style={{ marginTop: 4 }}>
                          Rehacer · prioridad
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="sp" />
        <div className="tiny">
          El semáforo cuenta días laborables desde el pago (compromiso: entrega en {DELIVERY_PROMISE}):
          verde hasta el día 3, ámbar días 4-5, rojo si se pasa. Los «rehacer» van siempre primero.
          Un caso abierto queda asociado a quien lo abre hasta terminar la fase, soltarlo o 45 min sin actividad.
        </div>
      </>
    );
  }

  // ---------- Lotes CNC ----------
  if (t === "lotes") {
    const porLote = new Map<string, CaseRow[]>();
    for (const c of ordenar(moldesCnc)) {
      const k = c.lot?.trim() || "";
      porLote.set(k, [...(porLote.get(k) ?? []), c]);
    }
    const sinLote = porLote.get("") ?? [];
    porLote.delete("");
    const sugerido = siguienteLote(active.map((c) => c.lot));
    const enConfeccion = ordenar(active.filter((c) => c.state === "FABRICACION" && c.fabPhase === "CONFECCION"));
    const enDiseno = active.filter((c) => c.state === "DISENO").length;
    body = (
      <>
        <div className="row between">
          <h3>Moldes pendientes de mecanizar · {moldesCnc.length}</h3>
          <span className="tiny">
            {enDiseno} en diseño (aún sin molde) · siguiente lote sugerido: <b>{sugerido}</b>
          </span>
        </div>
        <div className="sp" />
        {moldesCnc.length === 0 && <div className="card muted">No hay moldes esperando tanda de CNC.</div>}
        <div className="grid g2">
          {[...porLote.entries()].map(([lote, cs]) => (
            <div className="card" key={lote}>
              <div className="row between">
                <b style={{ fontFamily: "var(--font-sora)" }}>
                  Lote {lote} · {cs.length} molde{cs.length === 1 ? "" : "s"}
                </b>
                <form action={lotDoneAction}>
                  <input type="hidden" name="lot" value={lote} />
                  <button type="submit" className="pri">
                    Tanda mecanizada → confección
                  </button>
                </form>
              </div>
              <table style={{ marginTop: 8 }}>
                <tbody>
                  {cs.map((c) => (
                    <tr key={c.id}>
                      <td style={{ width: 60 }}>
                        <Link href={`/caso/${c.id}`}>#{c.number}</Link>
                      </td>
                      <td>{c.patient.name}</td>
                      <td className="tiny">{c.clinic.town}</td>
                      <td style={{ textAlign: "right" }}>
                        <SlaChip sla={slaOf.get(c.id) ?? null} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {sinLote.length > 0 && (
            <div className="card" style={{ background: "var(--amber-l)", borderColor: "#ecd2ad" }}>
              <b style={{ fontFamily: "var(--font-sora)" }}>Sin lote · {sinLote.length}</b>
              <div className="tiny">Asigna cada molde a una tanda para aprovechar material y preparación de máquina.</div>
              <table style={{ marginTop: 8 }}>
                <tbody>
                  {sinLote.map((c) => (
                    <tr key={c.id}>
                      <td style={{ width: 60 }}>
                        <Link href={`/caso/${c.id}`}>#{c.number}</Link>
                      </td>
                      <td>{c.patient.name}</td>
                      <td>
                        <form action={setLotAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <input type="hidden" name="caseId" value={c.id} />
                          <input name="lot" defaultValue={sugerido} style={{ maxWidth: 90, padding: "5px 8px" }} />
                          <button type="submit" className="mini">
                            Asignar
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="sp" />
        <h3>En confección a mano · {enConfeccion.length}</h3>
        <div className="sp" />
        <div className="card">
          {enConfeccion.length === 0 ? (
            <div className="muted">Nada en confección.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Paciente</th>
                  <th>Lote</th>
                  <th>Plazo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {enConfeccion.map((c) => (
                  <tr key={c.id}>
                    <td>#{c.number}</td>
                    <td>
                      {c.patient.name}
                      {rehacerAbierto(c) && (
                        <>
                          {" "}
                          <span className="pill r">Rehacer</span>
                        </>
                      )}
                    </td>
                    <td>{c.lot ?? "—"}</td>
                    <td>
                      <SlaChip sla={slaOf.get(c.id) ?? null} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/caso/${c.id}`} className="btn">
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </>
    );
  }

  // ---------- Envíos ----------
  if (t === "envios") {
    body = (
      <>
        <h3>En tránsito · {enviados.length}</h3>
        <div className="sp" />
        <div className="card">
          {enviados.length === 0 ? (
            <div className="muted">No hay envíos en curso.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Paciente</th>
                  <th>Destino</th>
                  <th>Transportista · seguimiento</th>
                  <th>Enviado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {enviados.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/caso/${c.id}`}>#{c.number}</Link>
                    </td>
                    <td>{c.patient.name}</td>
                    <td className="muted">{destino(c)}</td>
                    <td>
                      <form action={updateShipmentAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <input type="hidden" name="caseId" value={c.id} />
                        <input type="hidden" name="back" value="panel" />
                        <input name="carrier" defaultValue={c.shipment?.carrier ?? ""} placeholder="Transportista" style={{ maxWidth: 130, padding: "5px 8px" }} />
                        <input name="tracking" defaultValue={c.shipment?.tracking ?? ""} placeholder="Nº seguimiento" style={{ maxWidth: 150, padding: "5px 8px" }} />
                        <button type="submit" className="mini">
                          Guardar
                        </button>
                      </form>
                    </td>
                    <td className="tiny">{fmtdt(c.shipment?.shippedAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      <form action={deliveredAction}>
                        <input type="hidden" name="caseId" value={c.id} />
                        <input type="hidden" name="back" value="panel" />
                        <button type="submit" className="pri">
                          Entregado
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="sp" />
        <div className="tiny">
          Al confirmar la entrega el paciente recibe el aviso por WhatsApp, empieza la adaptación (seguimiento día 20)
          y queda programada la revisión anual. En producción la confirmación llegará del webhook del transportista.
        </div>
      </>
    );
  }

  // ---------- Incidencias ----------
  if (t === "incidencias") {
    const tipo = (x: string) =>
      x === "CAPTURA_INVALIDA" ? "Captura inválida" : x === "REHACER_DEFECTO" ? "Rehacer por defecto" : x;
    body = (
      <>
        <h3>Abiertas · {openIncidents.length}</h3>
        <div className="sp" />
        <div className="card">
          {openIncidents.length === 0 ? (
            <div className="muted">Sin incidencias abiertas.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Caso</th>
                  <th>Tipo</th>
                  <th>Motivo</th>
                  <th>Resolución</th>
                </tr>
              </thead>
              <tbody>
                {openIncidents.map((i) => (
                  <tr key={i.id}>
                    <td className="tiny">{fmtd(i.createdAt)}</td>
                    <td>
                      <Link href={`/caso/${i.case.id}`}>#{i.case.number}</Link>
                      <div className="tiny">{i.case.patient.name}</div>
                    </td>
                    <td>
                      <span className={`pill ${i.type === "CAPTURA_INVALIDA" ? "a" : "r"}`}>{tipo(i.type)}</span>
                    </td>
                    <td>
                      {i.reason}
                      <div className="tiny">
                        {i.openedBy} · {i.case.clinic.name}
                      </div>
                    </td>
                    <td>
                      {i.type === "REHACER_DEFECTO" && i.case.state === "FABRICACION" ? (
                        <span className="tiny">Se cierra sola al superar calidad</span>
                      ) : (
                        <form action={closeIncidentAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <input type="hidden" name="incidentId" value={i.id} />
                          <input name="resolution" placeholder="Cómo se ha resuelto" style={{ minWidth: 160, padding: "5px 8px" }} />
                          <button type="submit" className="mini">
                            Cerrar
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {closedIncidents.length > 0 && (
          <>
            <div className="sp" />
            <h3>Cerradas recientemente</h3>
            <div className="sp" />
            <div className="card">
              <table>
                <tbody>
                  {closedIncidents.map((i) => (
                    <tr key={i.id}>
                      <td className="tiny" style={{ width: 90 }}>
                        {fmtd(i.closedAt)}
                      </td>
                      <td>
                        <Link href={`/caso/${i.case.id}`}>#{i.case.number}</Link> · {i.case.patient.name}
                      </td>
                      <td className="muted">
                        {tipo(i.type)}: {i.reason}
                      </td>
                      <td className="tiny">{i.resolution}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </>
    );
  }

  // ---------- Entregados ----------
  if (t === "entregados") {
    body = (
      <>
        <h3>Entregados recientemente · {delivered.length}</h3>
        <div className="sp" />
        <div className="card">
          {delivered.length === 0 ? (
            <div className="muted">Todavía no hay entregas.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Entregado</th>
                  <th>Caso</th>
                  <th>Paciente</th>
                  <th>Clínica</th>
                  <th>Lote CNC</th>
                  <th>Material</th>
                  <th>Seguimiento</th>
                </tr>
              </thead>
              <tbody>
                {delivered.map((c) => (
                  <tr key={c.id}>
                    <td className="tiny">{fmtd(c.shipment?.deliveredAt)}</td>
                    <td>
                      <Link href={`/caso/${c.id}`}>#{c.number}</Link>
                    </td>
                    <td>{c.patient.name}</td>
                    <td className="muted">{c.clinic.name}</td>
                    <td>{c.lot ?? "—"}</td>
                    <td>{c.material ?? "—"}</td>
                    <td className="tiny">{c.shipment?.tracking ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="sp" />
        <div className="tiny">
          Trazabilidad del par: lote de mecanizado y lote de material quedan ligados al caso para
          reposiciones, ajustes post-entrega y la revisión anual. El CAD sigue archivado en el caso.
        </div>
      </>
    );
  }

  return (
    <>
      <div className="row between">
        <h2>Taller · Producción</h2>
        <span className="tiny">{user.name}</span>
      </div>
      <div className="grid g4" style={{ margin: "14px 0" }}>
        <Kpi v={produccion.length} l="En producción" />
        <Kpi v={moldesCnc.length} l="Moldes por mecanizar" />
        <Kpi v={<span style={{ color: fueraPlazo ? "var(--red)" : undefined }}>{fueraPlazo}</span>} l="Fuera de plazo" />
        <Kpi v={enviados.length} l="En tránsito" />
        <Kpi v={<span style={{ color: openIncidents.length ? "var(--amber)" : undefined }}>{openIncidents.length}</span>} l="Incidencias abiertas" />
      </div>
      <div className="tabs">
        {TABS.map(([k, label]) => {
          const n =
            k === "lotes" ? moldesCnc.length : k === "envios" ? enviados.length : k === "incidencias" ? openIncidents.length : 0;
          return (
            <Link key={k} href={`/panel?tab=${k}`} className={t === k ? "on" : ""}>
              {label}
              {n > 0 && <span className="tabn">{n}</span>}
            </Link>
          );
        })}
      </div>
      {body}
    </>
  );
}
