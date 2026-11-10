// Tarjeta «Programas de agenda de la clínica» de la pestaña Disponibilidad.
// Una sección por programa registrado (src/lib/conector/registro.ts):
// - con API (Docfav…): clave, cuenta, enlace de cada agenda con la de su
//   profesional, servicio y opciones;
// - calendario iCal (Google, Outlook, Apple u otro programa): enlace privado
//   del calendario de cada agenda (solo lectura).
import type { CalendarConnector, Clinic, ConnectorLink, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { claveDe } from "@/lib/conector";
import { PROVEEDORES } from "@/lib/conector/registro";
import { descifrar } from "@/lib/secretos";
import type { AgendaExterna, Cuenta, ProveedorApi, ProveedorIcal, Servicio } from "@/lib/conector/tipos";
import {
  conectarApiAction,
  desconectarAction,
  elegirCuentaAction,
  guardarConectorApiAction,
  guardarIcalAction,
  sincronizarConectorAction,
} from "@/app/panel/conector-actions";

type Conector = CalendarConnector & { links: ConnectorLink[] };
type Agenda = { id: string | null; name: string };

const hace = (d: Date | null) => {
  if (!d) return "nunca";
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  return d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
};

function Estado({ c }: { c: Conector }) {
  return (
    <>
      <div className="tiny" style={{ marginTop: 8 }}>
        {c.apiKeyHint && <>Clave {c.apiKeyHint} · </>}Última lectura: {hace(c.lastSyncAt)}
      </div>
      {c.lastError && (
        <div className="note a" style={{ marginTop: 6 }}>
          {c.lastError}
        </div>
      )}
    </>
  );
}

function Acciones({ c, nombre }: { c: Conector; nombre: string }) {
  return (
    <div className="row" style={{ marginTop: 10 }}>
      <form action={sincronizarConectorAction}>
        <input type="hidden" name="connectorId" value={c.id} />
        <button type="submit">Leer {nombre} ahora</button>
      </form>
      <form action={desconectarAction}>
        <input type="hidden" name="connectorId" value={c.id} />
        <button type="submit" className="dang">
          Desconectar
        </button>
      </form>
    </div>
  );
}

async function SeccionApi({ prov, c, clinic, agendas }: { prov: ProveedorApi; c: Conector | undefined; clinic: Clinic; agendas: Agenda[] }) {
  let cuentas: Cuenta[] = [];
  let opciones: AgendaExterna[] = [];
  let servicios: Servicio[] = [];
  let errorVivo: string | null = null;
  if (c?.apiKeyEnc) {
    try {
      const clave = claveDe(c)!;
      if (!c.externalClinicId) cuentas = await prov.cuentas(clave);
      else
        [opciones, servicios] = await Promise.all([
          prov.agendas(clave, c.externalClinicId),
          prov.servicios ? prov.servicios(clave, c.externalClinicId).then((s) => s.filter((x) => x.active)) : Promise.resolve([] as Servicio[]),
        ]);
    } catch (e) {
      errorVivo = prov.explicarError(e);
    }
  }
  const pendientes = c
    ? await prisma.appointment.count({ where: { externalConnectorId: c.id, externalState: "error", status: { in: ["RESERVADA", "CONFIRMADA"] } } })
    : 0;
  const enlazada = (pid: string | null) => c?.links.find((l) => l.professionalId === pid)?.externalCalendarId ?? "";
  const porNombre = servicios.find((s) => s.name.localeCompare(c?.serviceName ?? "Ortosend", "es", { sensitivity: "base" }) === 0);
  servicios.sort((a, b) => a.name.localeCompare(b.name, "es"));

  return (
    <details className="card" open={!!c} style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer" }}>
        <b>{prov.nombre}</b> {c?.externalClinicId ? <span className="pill g">Conectado</span> : <span className="tiny">· lee la agenda y apunta las citas</span>}
      </summary>
      {!c && (
        <form action={conectarApiAction} style={{ marginTop: 10 }}>
          <input type="hidden" name="kind" value={prov.kind} />
          <label>Clave de API de {prov.nombre}</label>
          <input name="apiKey" type="password" autoComplete="off" required />
          <div className="tiny" style={{ marginTop: 6 }}>
            {prov.ayuda} Se guarda cifrada.
          </div>
          <div className="sp" />
          <button type="submit" className="pri">
            Conectar
          </button>
        </form>
      )}
      {c && <Estado c={c} />}
      {pendientes > 0 && (
        <div className="tiny" style={{ color: "var(--red)", marginTop: 4 }}>
          {pendientes} cita{pendientes === 1 ? "" : "s"} sin apuntar en {prov.nombre} (ver Agenda)
        </div>
      )}
      {errorVivo && (
        <div className="note r" style={{ marginTop: 8 }}>
          No se pudo consultar {prov.nombre}: {errorVivo}
        </div>
      )}

      {c && !c.externalClinicId && cuentas.length > 0 && (
        <form action={elegirCuentaAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="kind" value={prov.kind} />
          <label>¿Qué clínica de {prov.nombre} es esta?</label>
          <select name="externalClinicId" required defaultValue="">
            <option value="" disabled>
              Elige…
            </option>
            {cuentas.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <div className="sp" />
          <button type="submit" className="pri">
            Elegir
          </button>
        </form>
      )}

      {c?.externalClinicId && !errorVivo && (
        <form action={guardarConectorApiAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="kind" value={prov.kind} />
          <b style={{ fontSize: 14 }}>
            Clínica de {prov.nombre}: {c.externalClinicName}
          </b>
          <div className="muted" style={{ marginTop: 4 }}>
            Enlaza cada agenda de Ortosend con la agenda de su profesional en {prov.nombre} (la del centro). Sus citas en cualquier
            sitio ocupan su agenda; las de Ortosend se apuntan en la agenda elegida.
          </div>
          {agendas.map((a) => (
            <div className="rule-row" key={a.id ?? "clinica"}>
              <span style={{ flex: 1 }}>{a.name}</span>
              <select name={`link_${a.id ?? "clinica"}`} defaultValue={enlazada(a.id)} style={{ maxWidth: 340 }}>
                <option value="">Sin enlazar</option>
                {opciones.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="grid g2" style={{ marginTop: 6 }}>
            {prov.servicios ? (
              <div>
                <label>Servicio de {prov.nombre} para las citas de Ortosend</label>
                <select
                  name="serviceId"
                  defaultValue={c.serviceId && servicios.some((s) => s.id === c.serviceId) && c.serviceId !== porNombre?.id ? c.serviceId : ""}
                >
                  <option value="">{porNombre ? `Automático: «${porNombre.name}»` : `Automático: el que se llame «${c.serviceName}» (no existe todavía)`}</option>
                  {servicios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.minutes} min)
                    </option>
                  ))}
                </select>
                <input type="hidden" name="serviceName" value={c.serviceName} />
                {!porNombre && (
                  <div className="tiny" style={{ marginTop: 4, color: "var(--amber)" }}>
                    Crea en {prov.nombre} un servicio activo llamado «{c.serviceName}», de {clinic.slotMinutes} min y a 0 €, asignado a los
                    profesionales enlazados, o elige aquí otro.
                  </div>
                )}
              </div>
            ) : (
              <div />
            )}
            <div>
              <label>&nbsp;</label>
              {prov.apuntar && (
                <label className="chk" style={{ margin: 0 }}>
                  <input type="checkbox" name="pushAppointments" defaultChecked={c.pushAppointments} /> Apuntar en {prov.nombre} las citas de
                  Ortosend
                </label>
              )}
              <label className="chk">
                <input type="checkbox" name="respectHours" defaultChecked={c.respectHours} /> No ofrecer horas fuera del horario de trabajo
                que tiene cada profesional en {prov.nombre}
              </label>
            </div>
          </div>
          <div className="sp" />
          <button type="submit" className="pri">
            Guardar y leer {prov.nombre}
          </button>
        </form>
      )}

      {c && (
        <>
          <Acciones c={c} nombre={prov.nombre} />
          <details style={{ marginTop: 8 }}>
            <summary className="tiny" style={{ cursor: "pointer" }}>
              Cambiar la clave
            </summary>
            <form action={conectarApiAction} className="row" style={{ marginTop: 8 }}>
              <input type="hidden" name="kind" value={prov.kind} />
              <input name="apiKey" type="password" autoComplete="off" placeholder="Nueva clave" style={{ maxWidth: 280 }} required />
              <button type="submit">Cambiar clave</button>
            </form>
          </details>
        </>
      )}
    </details>
  );
}

function SeccionIcal({ prov, c, agendas }: { prov: ProveedorIcal; c: Conector | undefined; agendas: Agenda[] }) {
  const guardado = (pid: string | null) => {
    const l = c?.links.find((x) => x.professionalId === pid);
    if (!l?.secretEnc) return null;
    try {
      const u = new URL(descifrar(l.secretEnc));
      return `${u.hostname}/…${u.pathname.slice(-6)}`;
    } catch {
      return "enlace guardado";
    }
  };
  return (
    <details className="card" open={!!c?.links.length} style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer" }}>
        <b>{prov.nombre}</b>{" "}
        {c?.links.length ? <span className="pill g">{c.links.length} calendario{c.links.length === 1 ? "" : "s"}</span> : <span className="tiny">· solo lectura</span>}
      </summary>
      <div className="muted" style={{ marginTop: 8 }}>
        Para clínicas cuyo programa no se conecta por API. Lo ocupado en el calendario de cada profesional deja de ofrecerse en
        Ortosend. No apunta las citas de Ortosend allí: para verlas en ese calendario, suscríbelo al enlace iCal de Ortosend (pestaña
        Agenda).
      </div>
      <div className="tiny" style={{ marginTop: 6 }}>
        {prov.ayuda}
      </div>
      {c && <Estado c={c} />}
      <form action={guardarIcalAction} style={{ marginTop: 10 }}>
        {agendas.map((a) => {
          const g = guardado(a.id);
          const k = a.id ?? "clinica";
          return (
            <div className="rule-row" key={k} style={{ flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 180px" }}>{a.name}</span>
              <input
                name={`ical_${k}`}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder={g ? `Guardado: ${g} (pega otro para cambiarlo)` : "https://… o webcal://… (enlace iCal privado)"}
                style={{ flex: "2 1 280px" }}
              />
              {g && (
                <label className="chk" style={{ margin: 0 }}>
                  <input type="checkbox" name={`quitar_${k}`} /> Quitar
                </label>
              )}
            </div>
          );
        })}
        <div className="sp" />
        <button type="submit" className="pri">
          Guardar y leer calendarios
        </button>
      </form>
      {c && <Acciones c={c} nombre="los calendarios" />}
    </details>
  );
}

export async function ClinicaConector({ clinic, user }: { clinic: Clinic; user: User }) {
  const isAdmin = user.role === "ADMIN_CLINICA";
  const conectores = await prisma.calendarConnector.findMany({ where: { clinicId: clinic.id }, include: { links: true } });
  const de = (kind: string) => conectores.find((c) => c.kind === kind);

  if (!isAdmin) {
    return (
      <div className="card" id="conector">
        <b>Programas de agenda de la clínica</b>
        {conectores.length === 0 && <div className="muted" style={{ marginTop: 6 }}>Ninguno conectado. Lo configura el administrador de la clínica.</div>}
        {conectores.map((c) => {
          const p = PROVEEDORES.find((x) => x.kind === c.kind);
          return (
            <div key={c.id} style={{ marginTop: 8 }}>
              <div className="muted">
                {p?.nombre ?? c.kind}: {c.links.length} agenda{c.links.length === 1 ? "" : "s"} enlazada{c.links.length === 1 ? "" : "s"} · última
                lectura {hace(c.lastSyncAt)}
              </div>
              <form action={sincronizarConectorAction} style={{ marginTop: 6 }}>
                <input type="hidden" name="connectorId" value={c.id} />
                <button type="submit">Leer ahora</button>
              </form>
            </div>
          );
        })}
      </div>
    );
  }

  const equipo = await prisma.user.findMany({
    where: { clinicId: clinic.id, active: true, role: { in: ["PROFESIONAL", "ADMIN_CLINICA"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const agendas: Agenda[] = [{ id: null, name: "Agenda de la clínica (sala / equipo)" }, ...equipo];

  return (
    <div className="card" id="conector">
      <b>Programas de agenda de la clínica</b>
      <div className="muted" style={{ marginTop: 6 }}>
        Conecta el programa con el que la clínica lleva su agenda para no dar en Ortosend horas que ya están ocupadas allí. Con los
        programas que tienen API, Ortosend además apunta allí sus citas con la ficha del paciente.
      </div>
      {PROVEEDORES.map((p) =>
        p.modo === "api" ? (
          <SeccionApi key={p.kind} prov={p} c={de(p.kind)} clinic={clinic} agendas={agendas} />
        ) : (
          <SeccionIcal key={p.kind} prov={p} c={de(p.kind)} agendas={agendas} />
        )
      )}
    </div>
  );
}
