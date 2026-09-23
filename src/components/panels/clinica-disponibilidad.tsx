// Pestaña «Disponibilidad» del panel de clínica: ajustes de la reserva online,
// horario semanal por agenda (clínica y profesionales), excepciones (cierres y
// aperturas) y vista previa de lo que verá el paciente.
import type { Clinic, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  WEEKDAY_LABEL,
  WEEKDAY_SHORT,
  addDays,
  dateColumnToLocal,
  dateKey,
  fmtMin,
  localToDateColumn,
  todayLocal,
} from "@/lib/agenda";
import { availabilityOf, loadClinicAgenda, resourceName } from "@/lib/agenda-db";
import {
  addExceptionAction,
  addRuleAction,
  delExceptionAction,
  delRuleAction,
  saveAgendaSettingsAction,
} from "@/app/panel/agenda-actions";

export async function ClinicaDisponibilidad({ clinic, user }: { clinic: Clinic; user: User }) {
  const isAdmin = user.role === "ADMIN_CLINICA";
  const today = todayLocal(clinic.timezone);
  const previewEnd = addDays(today, 13);
  const agenda = await loadClinicAgenda(prisma, clinic.id, today, previewEnd);
  const exceptions = await prisma.availabilityException.findMany({
    where: { clinicId: clinic.id, endsOn: { gte: localToDateColumn(today) } },
    orderBy: { startsOn: "asc" },
  });
  const preview = availabilityOf(agenda, today, previewEnd, "online");

  // Agendas: la de la clínica + cada profesional (el profesional solo ve/edita la suya)
  const agendas: { id: string | null; name: string; editable: boolean }[] = [
    { id: null, name: "Agenda de la clínica (sala / equipo)", editable: isAdmin },
    ...agenda.staff.map((s) => ({ id: s.id, name: s.name, editable: isAdmin || s.id === user.id })),
  ];
  const rulesOf = (id: string | null) =>
    agenda.rules.filter((r) => r.professionalId === id).sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);

  const fmtDia = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  return (
    <>
      <h3>Disponibilidad y reserva online</h3>
      <div className="muted">
        Lo que ve el paciente al reservar sale de aquí: horario semanal de cada agenda, menos cierres, más
        aperturas puntuales, menos las citas ya dadas. Hora local: {clinic.timezone}.
      </div>
      <div className="sp" />

      {/* --- Ajustes --- */}
      <div className="card">
        <b>Ajustes de la reserva</b>
        {isAdmin ? (
          <form action={saveAgendaSettingsAction}>
            <div className="grid g4">
              <div>
                <label>Duración de la cita</label>
                <select name="slotMinutes" defaultValue={String(clinic.slotMinutes)}>
                  {[15, 20, 30, 45, 60, 90].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Antelación mínima online</label>
                <select name="minNoticeHours" defaultValue={String(clinic.minNoticeHours)}>
                  {[0, 2, 4, 12, 24, 48, 72].map((h) => (
                    <option key={h} value={h}>
                      {h === 0 ? "Sin antelación" : `${h} h`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Reservar hasta</label>
                <select name="bookingHorizonDays" defaultValue={String(clinic.bookingHorizonDays)}>
                  {[7, 14, 30, 45, 60, 90, 180].map((d) => (
                    <option key={d} value={d}>
                      {d} días vista
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>&nbsp;</label>
                <label className="chk" style={{ margin: 0 }}>
                  <input type="checkbox" name="onlineBooking" defaultChecked={clinic.onlineBooking} /> Reserva online activa
                </label>
                <label className="chk">
                  <input type="checkbox" name="patientPicksPro" defaultChecked={clinic.patientPicksPro} /> El paciente puede elegir profesional
                </label>
              </div>
            </div>
            <div className="sp" />
            <button type="submit" className="pri">
              Guardar ajustes
            </button>
          </form>
        ) : (
          <div className="muted" style={{ marginTop: 6 }}>
            Cita de {clinic.slotMinutes} min · antelación mínima {clinic.minNoticeHours} h · reservas hasta{" "}
            {clinic.bookingHorizonDays} días vista · reserva online {clinic.onlineBooking ? "activa" : "desactivada"} ·{" "}
            {clinic.patientPicksPro ? "el paciente elige profesional" : "se asigna el primer profesional libre"}. Los cambia
            el administrador de la clínica.
          </div>
        )}
      </div>
      <div className="sp" />

      {/* --- Horario semanal --- */}
      <div className="row between">
        <h3>Horario semanal</h3>
      </div>
      <div className="sp" />
      <div className="rules">
        {agendas.map((a) => {
          const rules = rulesOf(a.id);
          return (
            <div className="card" key={a.id ?? "clinica"}>
              <b style={{ fontSize: 14 }}>{a.name}</b>
              <div style={{ marginTop: 8 }}>
                {rules.length === 0 && <div className="tiny">Sin horario: esta agenda no ofrece huecos.</div>}
                {rules.map((r) => (
                  <div className="rule-row" key={r.id}>
                    <span style={{ width: 76, fontWeight: 600 }}>{WEEKDAY_LABEL[r.weekday]}</span>
                    <span>
                      {fmtMin(r.startMin)}–{fmtMin(r.endMin)}
                    </span>
                    {a.id === null && r.capacity > 1 && <span className="pill n">{r.capacity} a la vez</span>}
                    {!r.online && <span className="pill a">solo clínica</span>}
                    {a.editable && (
                      <form action={delRuleAction} className="x">
                        <input type="hidden" name="ruleId" value={r.id} />
                        <button type="submit" title="Quitar franja">
                          ×
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="sp" />
      <div className="card">
        <b>Añadir franja al horario</b>
        <form action={addRuleAction}>
          <div className="grid g2">
            <div>
              <label>Agenda</label>
              <select name="agenda" defaultValue={isAdmin ? "clinica" : user.id}>
                {agendas
                  .filter((a) => a.editable)
                  .map((a) => (
                    <option key={a.id ?? "clinica"} value={a.id ?? "clinica"}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label>Días</label>
              <div className="wdays">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <label key={d} title={WEEKDAY_LABEL[d]}>
                    <input type="checkbox" name="weekday" value={d} defaultChecked={d <= 5} />
                    {WEEKDAY_SHORT[d]}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="grid g4">
            <div>
              <label>Desde</label>
              <input name="start" type="time" defaultValue="09:00" required step={300} />
            </div>
            <div>
              <label>Hasta</label>
              <input name="end" type="time" defaultValue="13:00" required step={300} />
            </div>
            <div>
              <label>Citas a la vez (solo agenda de la clínica)</label>
              <input name="capacity" type="number" min={1} max={10} defaultValue={1} />
            </div>
            <div>
              <label>Publicación</label>
              <select name="online" defaultValue="on">
                <option value="on">Reservable en la web</option>
                <option value="off">Solo la da la clínica</option>
              </select>
            </div>
          </div>
          <div className="sp" />
          <button type="submit" className="pri">
            Añadir franja
          </button>
          <div className="tiny" style={{ marginTop: 8 }}>
            Ejemplo: mañanas de lunes a viernes 09:00–13:00 y tardes 16:00–20:00 son dos franjas. Las franjas se
            trocean en citas de {clinic.slotMinutes} min.
          </div>
        </form>
      </div>
      <div className="sp" />

      {/* --- Excepciones --- */}
      <h3>Cierres y aperturas puntuales</h3>
      <div className="sp" />
      <div className="card">
        {exceptions.length === 0 && <div className="tiny">No hay cierres ni aperturas próximas.</div>}
        {exceptions.map((x) => {
          const editable = isAdmin || x.professionalId === user.id;
          const rango =
            dateKey(dateColumnToLocal(x.startsOn)) === dateKey(dateColumnToLocal(x.endsOn))
              ? fmtDia(x.startsOn)
              : `${fmtDia(x.startsOn)} – ${fmtDia(x.endsOn)}`;
          return (
            <div className="rule-row" key={x.id}>
              <span className={`pill ${x.kind === "CIERRE" ? "r" : "g"}`}>{x.kind === "CIERRE" ? "Cierre" : "Apertura"}</span>
              <span style={{ fontWeight: 600 }}>{rango}</span>
              <span>{x.startMin != null && x.endMin != null ? `${fmtMin(x.startMin)}–${fmtMin(x.endMin)}` : "todo el día"}</span>
              <span className="tiny">{x.professionalId === null ? (x.kind === "CIERRE" ? "toda la clínica" : "agenda de la clínica") : resourceName(agenda, x.professionalId)}</span>
              {x.note && <span className="tiny">· {x.note}</span>}
              {editable && (
                <form action={delExceptionAction} className="x">
                  <input type="hidden" name="exceptionId" value={x.id} />
                  <button type="submit" title="Quitar">
                    ×
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
      <div className="sp" />
      <div className="card">
        <b>Añadir cierre o apertura</b>
        <form action={addExceptionAction}>
          <div className="grid g4">
            <div>
              <label>Tipo</label>
              <select name="kind" defaultValue="CIERRE">
                <option value="CIERRE">Cierre (festivo, vacaciones, baja)</option>
                <option value="APERTURA">Apertura puntual (hueco extra)</option>
              </select>
            </div>
            <div>
              <label>Agenda</label>
              <select name="agenda" defaultValue={isAdmin ? "clinica" : user.id}>
                {isAdmin && <option value="clinica">Toda la clínica / agenda de la clínica</option>}
                {agendas
                  .filter((a) => a.editable && a.id !== null)
                  .map((a) => (
                    <option key={a.id!} value={a.id!}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label>Desde el día</label>
              <input name="from" type="date" required />
            </div>
            <div>
              <label>Hasta el día (opcional)</label>
              <input name="to" type="date" />
            </div>
          </div>
          <div className="grid g4">
            <div>
              <label>Hora inicio (vacío = todo el día)</label>
              <input name="start" type="time" step={300} />
            </div>
            <div>
              <label>Hora fin</label>
              <input name="end" type="time" step={300} />
            </div>
            <div>
              <label>Citas a la vez (aperturas de clínica)</label>
              <input name="capacity" type="number" min={1} max={10} defaultValue={1} />
            </div>
            <div>
              <label>Nota</label>
              <input name="note" placeholder="Ej.: Sant Narcís, vacaciones" />
            </div>
          </div>
          <div className="sp" />
          <button type="submit" className="pri">
            Guardar
          </button>
          <div className="tiny" style={{ marginTop: 8 }}>
            Un cierre de «toda la clínica» tapa todas las agendas; un cierre de un profesional, solo la suya. Las
            citas ya dadas no se anulan solas: revísalas en la agenda.
          </div>
        </form>
      </div>
      <div className="sp" />

      {/* --- Vista previa --- */}
      <h3>Lo que ve el paciente (próximos 14 días)</h3>
      <div className="sp" />
      <div className="card">
        {!clinic.onlineBooking && <div className="note a" style={{ marginBottom: 8 }}>La reserva online está desactivada: la web no muestra huecos.</div>}
        <div className="grid g4">
          {Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((d) => {
            const n = preview.get(dateKey(d))?.length ?? 0;
            return (
              <div key={dateKey(d)} className="kpi" style={{ padding: 10 }}>
                <div className="l">
                  {WEEKDAY_LABEL[(new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay() + 6) % 7 + 1].slice(0, 3)} {d.d}/{d.m}
                </div>
                <div className="v" style={{ fontSize: 18, color: n ? "var(--green)" : "var(--mut)" }}>
                  {n} {n === 1 ? "hueco" : "huecos"}
                </div>
              </div>
            );
          })}
        </div>
        <div className="tiny" style={{ marginTop: 8 }}>
          Cuenta los huecos publicados (antelación mínima {clinic.minNoticeHours} h y citas ya dadas descontadas).
        </div>
      </div>
    </>
  );
}
