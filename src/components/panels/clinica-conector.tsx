// Tarjeta «Programa de gestión de la clínica» (Docfav) de la pestaña
// Disponibilidad: conectar con la clave de API, elegir la clínica, enlazar cada
// agenda de Ortosend con la de su profesional en Docfav, elegir el servicio y
// ver el estado de la última lectura.
import type { Clinic, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { clienteDe, explicarError, KIND_DOCFAV } from "@/lib/conector";
import type { DfClinic, DfService } from "@/lib/conector/docfav";
import {
  conectarDocfavAction,
  desconectarDocfavAction,
  elegirClinicaDocfavAction,
  guardarConectorAction,
  sincronizarConectorAction,
} from "@/app/panel/conector-actions";

const hace = (d: Date | null) => {
  if (!d) return "nunca";
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  return d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
};

export async function ClinicaConector({ clinic, user }: { clinic: Clinic; user: User }) {
  const isAdmin = user.role === "ADMIN_CLINICA";
  const c = await prisma.calendarConnector.findUnique({
    where: { clinicId_kind: { clinicId: clinic.id, kind: KIND_DOCFAV } },
    include: { links: true },
  });
  const pendientes = c
    ? await prisma.appointment.count({ where: { clinicId: clinic.id, externalState: "error", status: { in: ["RESERVADA", "CONFIRMADA"] } } })
    : 0;

  // Profesionales de la clínica: personal no ve la configuración, solo el estado.
  if (!isAdmin) {
    return (
      <div className="card" id="conector">
        <b>Programa de gestión de la clínica</b>
        <div className="muted" style={{ marginTop: 6 }}>
          {c?.externalClinicId
            ? `Conectado con Docfav (${c.externalClinicName}). Las horas ocupadas en Docfav no se ofrecen en Ortosend y las citas de Ortosend se apuntan en Docfav. Última lectura: ${hace(c.lastSyncAt)}.`
            : "Sin conectar. El administrador de la clínica puede conectar Docfav desde aquí."}
        </div>
        {c?.externalClinicId && (
          <form action={sincronizarConectorAction} style={{ marginTop: 10 }}>
            <button type="submit">Leer Docfav ahora</button>
          </form>
        )}
      </div>
    );
  }

  // Datos en vivo de Docfav para los selectores (solo si ya hay clínica elegida).
  let clinicas: DfClinic[] = [];
  let opciones: { id: string; label: string }[] = [];
  let servicios: DfService[] = [];
  let errorVivo: string | null = null;
  if (c) {
    try {
      const api = clienteDe(c);
      if (!c.externalClinicId) clinicas = await api.clinics();
      else {
        const [cals, staff, places, svcs] = await Promise.all([
          api.staffCalendars(c.externalClinicId),
          api.staff(c.externalClinicId),
          api.places(c.externalClinicId),
          api.services(c.externalClinicId),
        ]);
        opciones = cals
          .filter((x) => x.active)
          .map((x) => ({
            id: x.id,
            label: `${staff.find((s) => s.id === x.staffId)?.fullname ?? "Profesional"} · ${places.find((p) => p.id === x.placeId)?.name ?? "—"}`,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, "es"));
        servicios = svcs.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name, "es"));
      }
    } catch (e) {
      errorVivo = explicarError(e);
    }
  }
  const equipo = await prisma.user.findMany({
    where: { clinicId: clinic.id, active: true, role: { in: ["PROFESIONAL", "ADMIN_CLINICA"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const agendas = [{ id: null as string | null, name: "Agenda de la clínica (sala / equipo)" }, ...equipo];
  const enlazada = (pid: string | null) => c?.links.find((l) => l.professionalId === pid)?.externalCalendarId ?? "";
  const porNombre = servicios.find(
    (s) => s.name.localeCompare(c?.serviceName ?? "Ortosend", "es", { sensitivity: "base" }) === 0
  );

  return (
    <div className="card" id="conector">
      <div className="row between">
        <b>Programa de gestión de la clínica: Docfav</b>
        {c?.externalClinicId && <span className="pill g">Conectado</span>}
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        Con Docfav conectado, Ortosend no ofrece las horas que ya están ocupadas en Docfav (citas, bloqueos y, si
        quieres, fuera del horario de cada profesional) y apunta allí cada cita de Ortosend con la ficha del paciente,
        creada con los datos de su cuenta si no existe. Docfav no envía recordatorios de esas citas: los manda Ortosend.
      </div>

      {!c && (
        <form action={conectarDocfavAction} style={{ marginTop: 12 }}>
          <label>Clave de API de Docfav</label>
          <input name="apiKey" type="password" autoComplete="off" placeholder="df_pk_…" required />
          <div className="tiny" style={{ marginTop: 6 }}>
            En Docfav: Mi cuenta → API Keys → Crear. Permisos: Appointments (read y write), Clients (read y write),
            Staff, Staff Calendars, Calendars, Schedules, Services, Clinics y User (read). Se guarda cifrada.
          </div>
          <div className="sp" />
          <button type="submit" className="pri">
            Conectar
          </button>
        </form>
      )}

      {c && (
        <div className="tiny" style={{ marginTop: 10 }}>
          Clave {c.apiKeyHint} · Última lectura: {hace(c.lastSyncAt)}
          {pendientes > 0 && <> · <span style={{ color: "var(--red)" }}>{pendientes} cita{pendientes === 1 ? "" : "s"} sin apuntar en Docfav (ver Agenda)</span></>}
        </div>
      )}
      {c?.lastError && (
        <div className="note a" style={{ marginTop: 8 }}>
          {c.lastError}
        </div>
      )}
      {errorVivo && (
        <div className="note r" style={{ marginTop: 8 }}>
          No se pudo consultar Docfav: {errorVivo}
        </div>
      )}

      {c && !c.externalClinicId && clinicas.length > 0 && (
        <form action={elegirClinicaDocfavAction} style={{ marginTop: 12 }}>
          <label>¿Qué clínica de Docfav es esta?</label>
          <select name="externalClinicId" required defaultValue="">
            <option value="" disabled>
              Elige…
            </option>
            {clinicas.map((x) => (
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
        <form action={guardarConectorAction} style={{ marginTop: 12 }}>
          <b style={{ fontSize: 14 }}>Clínica de Docfav: {c.externalClinicName}</b>
          <div className="muted" style={{ marginTop: 4 }}>
            Enlaza cada agenda de Ortosend con la agenda de su profesional en Docfav. Sus citas en cualquier sitio
            (centro, domicilio…) ocupan su agenda; las de Ortosend se apuntan en la agenda elegida.
          </div>
          {agendas.map((a) => (
            <div className="rule-row" key={a.id ?? "clinica"}>
              <span style={{ flex: 1 }}>{a.name}</span>
              <select name={`link_${a.id ?? "clinica"}`} defaultValue={enlazada(a.id)} style={{ maxWidth: 340 }}>
                <option value="">Sin enlazar</option>
                {opciones.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="grid g2" style={{ marginTop: 6 }}>
            <div>
              <label>Servicio de Docfav para las citas de Ortosend</label>
              <select name="serviceId" defaultValue={c.serviceId && servicios.some((s) => s.id === c.serviceId) && c.serviceId !== porNombre?.id ? c.serviceId : ""}>
                <option value="">
                  {porNombre ? `Automático: «${porNombre.name}»` : `Automático: el que se llame «${c.serviceName}» (no existe todavía)`}
                </option>
                {servicios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.minutes} min)
                  </option>
                ))}
              </select>
              <input type="hidden" name="serviceName" value={c.serviceName} />
              {!porNombre && (
                <div className="tiny" style={{ marginTop: 4, color: "var(--amber)" }}>
                  Crea en Docfav un servicio activo llamado «{c.serviceName}», de {clinic.slotMinutes} min, asignado a los
                  profesionales enlazados, o elige aquí otro servicio.
                </div>
              )}
            </div>
            <div>
              <label>&nbsp;</label>
              <label className="chk" style={{ margin: 0 }}>
                <input type="checkbox" name="pushAppointments" defaultChecked={c.pushAppointments} /> Apuntar en Docfav las
                citas de Ortosend
              </label>
              <label className="chk">
                <input type="checkbox" name="respectHours" defaultChecked={c.respectHours} /> No ofrecer horas fuera del
                horario de trabajo que tiene cada profesional en Docfav
              </label>
            </div>
          </div>
          <div className="sp" />
          <div className="row">
            <button type="submit" className="pri">
              Guardar y leer Docfav
            </button>
          </div>
        </form>
      )}

      {c && (
        <div className="row" style={{ marginTop: 12 }}>
          {c.externalClinicId && (
            <form action={sincronizarConectorAction}>
              <button type="submit">Leer Docfav ahora</button>
            </form>
          )}
          <details>
            <summary className="tiny" style={{ cursor: "pointer" }}>
              Cambiar la clave o desconectar
            </summary>
            <form action={conectarDocfavAction} className="row" style={{ marginTop: 8 }}>
              <input name="apiKey" type="password" autoComplete="off" placeholder="Nueva clave df_pk_…" style={{ maxWidth: 280 }} required />
              <button type="submit">Cambiar clave</button>
            </form>
            <form action={desconectarDocfavAction} style={{ marginTop: 8 }}>
              <button type="submit" className="dang">
                Desconectar Docfav
              </button>
            </form>
          </details>
        </div>
      )}
    </div>
  );
}
