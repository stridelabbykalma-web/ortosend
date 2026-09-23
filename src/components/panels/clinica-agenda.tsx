// Pestaña «Agenda» del panel de clínica: semana con las citas de todas las
// agendas (o de un profesional), casos pendientes de cita, dar/cambiar/anular
// citas y enlaces de suscripción iCal.
import Link from "next/link";
import type { Clinic, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { StatePill } from "@/components/ui";
import { fmtdt } from "@/lib/format";
import {
  APPOINTMENT_KIND_LABEL,
  APPOINTMENT_STATUS_LABEL,
  addDays,
  dateKey,
  localParts,
  parseDateKey,
  startOfWeek,
  todayLocal,
  zonedToUtc,
  fmtMin,
} from "@/lib/agenda";
import { availabilityOf, loadClinicAgenda } from "@/lib/agenda-db";
import { cancelarCitaClinicaAction, darCitaAction, icalTokenAction } from "@/app/panel/agenda-actions";
import { invitePatientAction } from "@/app/panel/clinica-actions";
import { InvitacionesPendientes } from "./clinica";
import { EDAD_MAYORIA_SALUD } from "@/lib/edad";
import { Calendario } from "@/components/reserva/calendario";

const DIA_LARGO = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export async function ClinicaAgenda({
  clinic,
  user,
  semana,
  pro,
  caso,
  anuladas,
}: {
  clinic: Clinic;
  user: User;
  semana?: string;
  pro?: string;
  caso?: string;
  anuladas?: string;
}) {
  const showOff = anuladas === "1";
  const tz = clinic.timezone;
  const today = todayLocal(tz);
  const monday = startOfWeek(parseDateKey(semana) ?? today);
  const sunday = addDays(monday, 6);
  const back = `/panel?tab=agenda&semana=${dateKey(monday)}${pro ? `&pro=${pro}` : ""}`;

  const agenda = await loadClinicAgenda(prisma, clinic.id, monday, sunday);
  const proFilter = !pro ? undefined : pro === "clinica" ? null : pro;
  const free = availabilityOf(agenda, monday, sunday, "staff", proFilter);

  const weekStart = zonedToUtc(monday, 0, tz);
  const weekEnd = zonedToUtc(addDays(sunday, 1), 0, tz);
  const [appointments, pendientes, casosParaCita] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        clinicId: clinic.id,
        startsAt: { gte: weekStart, lt: weekEnd },
        ...(proFilter === undefined ? {} : { professionalId: proFilter }),
      },
      include: { case: { include: { patient: true } }, professional: { select: { id: true, name: true } } },
      orderBy: { startsAt: "asc" },
    }),
    // Casos que deberían tener cita y no la tienen
    prisma.case.findMany({
      where: { clinicId: clinic.id, appointmentAt: null, state: { in: ["CITA_RESERVADA", "DEVUELTO_CLINICA"] } },
      include: { patient: true },
      orderBy: { createdAt: "asc" },
    }),
    // Casos a los que la clínica puede dar cita (estudio, repetición, revisión o ajuste)
    prisma.case.findMany({
      where: {
        clinicId: clinic.id,
        state: { in: ["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA", "ENTREGADO", "CERRADO"] },
      },
      include: { patient: true },
      orderBy: { number: "desc" },
      take: 200,
    }),
  ]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const byDay = new Map<string, typeof appointments>();
  // Las anuladas y los «no vino» se ocultan por defecto para no ensuciar la semana.
  const nOff = appointments.filter((a) => a.status === "CANCELADA" || a.status === "NO_PRESENTADO").length;
  for (const a of appointments) {
    if (!showOff && (a.status === "CANCELADA" || a.status === "NO_PRESENTADO")) continue;
    const k = dateKey(localParts(a.startsAt, tz));
    byDay.set(k, [...(byDay.get(k) ?? []), a]);
  }
  const hora = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const now = new Date();

  const casoSel = caso ? casosParaCita.find((c) => c.id === caso) : undefined;
  const kindDefault = casoSel
    ? casoSel.state === "DEVUELTO_CLINICA"
      ? "REPETICION"
      : ["ENTREGADO", "CERRADO"].includes(casoSel.state)
        ? "REVISION"
        : "ESTUDIO"
    : "ESTUDIO";

  const icalUrl = (token: string) => `/api/ical/${token}`;

  return (
    <>
      <div className="row between">
        <h3>
          Semana del {monday.d} al {sunday.d} de{" "}
          {new Date(Date.UTC(sunday.y, sunday.m - 1, sunday.d)).toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })}
        </h3>
        <div className="row">
          <Link className="btn" href={`/panel?tab=agenda&semana=${dateKey(addDays(monday, -7))}${pro ? `&pro=${pro}` : ""}`}>
            ‹ Anterior
          </Link>
          <Link className="btn" href={`/panel?tab=agenda${pro ? `&pro=${pro}` : ""}`}>
            Hoy
          </Link>
          <Link className="btn" href={`/panel?tab=agenda&semana=${dateKey(addDays(monday, 7))}${pro ? `&pro=${pro}` : ""}`}>
            Siguiente ›
          </Link>
        </div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className="tiny">Ver:</span>
        <Link className={`pill ${!pro ? "" : "n"}`} href={`/panel?tab=agenda&semana=${dateKey(monday)}`}>
          Todas las agendas
        </Link>
        <Link className={`pill ${pro === "clinica" ? "" : "n"}`} href={`/panel?tab=agenda&semana=${dateKey(monday)}&pro=clinica`}>
          Agenda de la clínica
        </Link>
        {agenda.staff.map((s) => (
          <Link key={s.id} className={`pill ${pro === s.id ? "" : "n"}`} href={`/panel?tab=agenda&semana=${dateKey(monday)}&pro=${s.id}`}>
            {s.name.split("(")[0].trim()}
          </Link>
        ))}
      </div>
      <div className="sp" />

      <div className="week">
        {days.map((d, i) => {
          const k = dateKey(d);
          const list = byDay.get(k) ?? [];
          const libres = free.get(k)?.length ?? 0;
          return (
            <div key={k} className={`week-day ${k === dateKey(today) ? "today" : ""}`}>
              <h4>
                {DIA_LARGO[i + 1]} {d.d}
              </h4>
              {list.length === 0 && <div className="tiny">Sin citas</div>}
              {list.map((a) => {
                const off = a.status === "CANCELADA" || a.status === "NO_PRESENTADO";
                const cls = off ? "off" : a.status === "COMPLETADA" ? "done" : a.kind !== "ESTUDIO" ? "rep" : "";
                return (
                  <details key={a.id} className={`appt ${cls}`}>
                    <summary style={{ cursor: "pointer", listStyle: "none" }}>
                      <span className="t">{hora.format(a.startsAt)}</span> {a.case.patient.name}
                      <div className="who">
                        {APPOINTMENT_KIND_LABEL[a.kind]} · {a.professional?.name.split("(")[0].trim() ?? "Clínica"}
                        {a.status !== "RESERVADA" && <> · {APPOINTMENT_STATUS_LABEL[a.status]}</>}
                      </div>
                    </summary>
                    <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                      <div className="tiny">
                        Caso #{a.case.number} · <StatePill state={a.case.state} />
                      </div>
                      {a.notes && <div className="tiny">{a.notes}</div>}
                      <Link href={`/caso/${a.case.id}`} className="btn" style={{ fontSize: 12, padding: "5px 10px" }}>
                        Abrir caso
                      </Link>
                      {!off && a.status !== "COMPLETADA" && (
                        <>
                          <Link
                            href={`/panel?tab=agenda&semana=${dateKey(monday)}&caso=${a.case.id}#darcita`}
                            className="btn"
                            style={{ fontSize: 12, padding: "5px 10px" }}
                          >
                            Cambiar hora
                          </Link>
                          <form action={cancelarCitaClinicaAction} className="row" style={{ gap: 6 }}>
                            <input type="hidden" name="appointmentId" value={a.id} />
                            <input type="hidden" name="back" value={back} />
                            <input name="reason" placeholder="Motivo (opcional)" style={{ fontSize: 12, padding: "5px 8px" }} />
                            <button type="submit" className="dang" style={{ fontSize: 12, padding: "5px 10px" }}>
                              Anular
                            </button>
                            {a.startsAt < now && (
                              <button type="submit" name="status" value="NO_PRESENTADO" className="warn" style={{ fontSize: 12, padding: "5px 10px" }}>
                                No vino
                              </button>
                            )}
                          </form>
                        </>
                      )}
                    </div>
                  </details>
                );
              })}
              <div className="free">{libres ? `${libres} hueco${libres === 1 ? "" : "s"} libre${libres === 1 ? "" : "s"}` : "Sin huecos libres"}</div>
            </div>
          );
        })}
      </div>
      <div className="tiny" style={{ marginTop: 6 }}>
        Los huecos libres son los del horario configurado en «Disponibilidad» (incluidos los no publicados en la web).
        {nOff > 0 && (
          <>
            {" "}
            ·{" "}
            <Link href={`${back}${showOff ? "" : "&anuladas=1"}`}>
              {showOff ? "Ocultar anuladas" : `Mostrar ${nOff} anulada${nOff === 1 ? "" : "s"} / no presentado`}
            </Link>
          </>
        )}
      </div>
      <div className="sp" />

      {pendientes.length > 0 && (
        <>
          <div className="card">
            <b>Pendientes de cita</b>
            <div className="muted" style={{ marginBottom: 8 }}>
              Casos sin hora asignada: pacientes que anularon su cita o casos devueltos para repetir una prueba.
            </div>
            <table>
              <tbody>
                {pendientes.map((c) => (
                  <tr key={c.id}>
                    <td>#{c.number}</td>
                    <td>{c.patient.name}</td>
                    <td>
                      <StatePill state={c.state} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/panel?tab=agenda&semana=${dateKey(monday)}&caso=${c.id}#darcita`} className="btn">
                        Dar cita
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sp" />
        </>
      )}

      <div className="card" id="darcita">
        <b>{casoSel ? `Dar cita a ${casoSel.patient.name} (caso #${casoSel.number})` : "Dar cita a un paciente"}</b>
        <form action={darCitaAction}>
          <input type="hidden" name="back" value={back} />
          {!casoSel && (
            <>
              <label>Caso</label>
              <select name="caseId" required defaultValue="">
                <option value="" disabled>
                  Elige el caso…
                </option>
                {casosParaCita.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.number} · {c.patient.name} · {c.state.replace(/_/g, " ").toLowerCase()}
                    {c.appointmentAt ? ` · cita ${fmtdt(c.appointmentAt)}` : ""}
                  </option>
                ))}
              </select>
            </>
          )}
          {casoSel && <input type="hidden" name="caseId" value={casoSel.id} />}
          <div className="grid g2">
            <div>
              <label>Tipo de cita</label>
              <select name="kind" defaultValue={kindDefault}>
                {Object.entries(APPOINTMENT_KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Nota interna (opcional)</label>
              <input name="notes" placeholder="Ej.: viene con su hijo, traer calzado deportivo" />
            </div>
          </div>
          {casoSel?.appointmentAt && (
            <label className="chk" style={{ marginTop: 10 }}>
              <input type="checkbox" name="replace" defaultChecked /> Sustituir su cita actual ({fmtdt(casoSel.appointmentAt)})
            </label>
          )}
          <label>Hora del calendario (horario configurado)</label>
          <Calendario clinicId={clinic.id} mode="staff" />
          <details style={{ marginTop: 12 }}>
            <summary className="tiny" style={{ cursor: "pointer" }}>
              O escribir una hora a mano (también fuera de horario)
            </summary>
            <div className="grid g3" style={{ marginTop: 8 }}>
              <div>
                <label>Fecha</label>
                <input name="date" type="date" />
              </div>
              <div>
                <label>Hora</label>
                <input name="time" type="time" step={300} />
              </div>
              <div>
                <label>Agenda</label>
                <select name="professionalId" defaultValue={user.role === "ADMIN_CLINICA" ? "" : user.id}>
                  <option value="">La primera libre</option>
                  <option value="clinica">Agenda de la clínica</option>
                  {agenda.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="chk">
              <input type="checkbox" name="force" /> Fuera de horario: dar la cita aunque no esté en el horario
              configurado (solo se comprueba que la agenda esté libre). Si escribes fecha y hora, se usan en
              lugar del calendario.
            </label>
          </details>
          <div className="sp" />
          <button type="submit" className="pri">
            {casoSel?.appointmentAt ? "Cambiar la cita" : "Dar la cita"}
          </button>
          {casoSel && (
            <Link href={back} className="btn" style={{ marginLeft: 8 }}>
              Cancelar
            </Link>
          )}
        </form>
        <div className="tiny" style={{ marginTop: 8 }}>
          El paciente recibe el aviso por WhatsApp (solo fecha, hora y dirección). Duración de la cita:{" "}
          {clinic.slotMinutes} min ({fmtMin(clinic.slotMinutes)} h).
        </div>
      </div>
      <div className="sp" />

      <InvitacionesPendientes clinicId={clinic.id} />
      <div className="sp" />
      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Invitar a un paciente (Flujo B — paciente en clínica)</summary>
        <div className="tiny" style={{ margin: "6px 0 10px" }}>
          Solo los datos esenciales. El paciente recibe el enlace al momento (WhatsApp y email), crea
          su cuenta, acepta los consentimientos y en ese instante se abre el estudio en tu agenda. Si
          no tiene el móvil a mano, abre el enlace desde este dispositivo: la sesión de la clínica se
          mantiene.
        </div>
        <form action={invitePatientAction}>
          <label>Nombre y apellidos del paciente</label>
          <input name="name" required />
          <div className="grid g2">
            <div>
              <label>Móvil</label>
              <input name="phone" type="tel" />
            </div>
            <div>
              <label>Email</label>
              <input name="email" type="email" />
            </div>
          </div>
          <label>Fecha de nacimiento</label>
          <input name="birth" type="date" />
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer" }}>El paciente es menor de {EDAD_MAYORIA_SALUD} años</summary>
            <div className="tiny" style={{ margin: "6px 0" }}>
              La invitación y la cuenta son para su padre, madre o tutor; el móvil y el email de arriba
              son los del menor (recibirá el aviso para gestionar su cuenta al cumplir {EDAD_MAYORIA_SALUD}
              años). Déjalos vacíos si no tiene.
            </div>
            <label>Nombre y apellidos del tutor</label>
            <input name="tutorNombre" />
            <div className="grid g2">
              <div>
                <label>Móvil del tutor (recibirá la invitación)</label>
                <input name="tutorMovil" type="tel" />
              </div>
              <div>
                <label>Email del tutor</label>
                <input name="tutorEmail" type="email" />
              </div>
            </div>
          </details>
          <div className="sp" />
          <button type="submit" className="pri">
            Enviar invitación
          </button>
        </form>
      </details>
      <div className="sp" />

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Ver esta agenda en Outlook, Google Calendar o Apple Calendar</summary>
        <div className="muted" style={{ marginTop: 8 }}>
          Suscripción privada de solo lectura (se actualiza sola cada media hora). Contiene fecha, hora, tipo de cita y
          nombre del paciente; nunca contenido clínico. Quien tenga el enlace puede ver la agenda: si se filtra,
          genera uno nuevo y el anterior deja de funcionar.
        </div>
        <div className="grid g2" style={{ marginTop: 10 }}>
          <div>
            <b style={{ fontSize: 13 }}>Mis citas</b>
            {user.calendarToken ? (
              <div className="tiny" style={{ wordBreak: "break-all", margin: "4px 0" }}>
                <code>{icalUrl(user.calendarToken)}</code>
              </div>
            ) : (
              <div className="tiny">Aún no has generado tu enlace.</div>
            )}
            <form action={icalTokenAction}>
              <input type="hidden" name="scope" value="mia" />
              <button type="submit">{user.calendarToken ? "Renovar enlace" : "Generar enlace"}</button>
            </form>
          </div>
          {user.role === "ADMIN_CLINICA" && (
            <div>
              <b style={{ fontSize: 13 }}>Toda la clínica</b>
              {clinic.calendarToken ? (
                <div className="tiny" style={{ wordBreak: "break-all", margin: "4px 0" }}>
                  <code>{icalUrl(clinic.calendarToken)}</code>
                </div>
              ) : (
                <div className="tiny">Aún no se ha generado el enlace de la clínica.</div>
              )}
              <form action={icalTokenAction}>
                <input type="hidden" name="scope" value="clinica" />
                <button type="submit">{clinic.calendarToken ? "Renovar enlace" : "Generar enlace"}</button>
              </form>
            </div>
          )}
        </div>
        <div className="tiny" style={{ marginTop: 8 }}>
          Copia la dirección completa (con el dominio de la web) en «Añadir calendario desde URL» de tu aplicación.
        </div>
      </details>
    </>
  );
}
