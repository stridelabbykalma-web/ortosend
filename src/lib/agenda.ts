// Motor de disponibilidad (puro, sin base de datos ni dependencias).
//
// Una clínica tiene varias AGENDAS (recursos): la de la propia clínica
// (sala/equipo, con capacidad) y una por profesional. Cada agenda tiene un
// horario semanal (AvailabilityRule) y excepciones por fechas
// (AvailabilityException: cierres y aperturas). La disponibilidad de un día es,
// por agenda: ventanas del horario semanal → menos cierres → más aperturas →
// troceadas en citas de `slotMinutes` → quitando las que ya estén ocupadas
// (citas activas solapadas ≥ capacidad). Todo se calcula en la hora local de
// la clínica (`timezone`) y se devuelve en UTC.

export type LocalDate = { y: number; m: number; d: number }; // m: 1-12

export type RuleLike = {
  professionalId: string | null;
  weekday: number; // ISO 1 (lunes) … 7 (domingo)
  startMin: number;
  endMin: number;
  capacity: number;
  online: boolean;
};

export type ExceptionLike = {
  professionalId: string | null; // null = toda la clínica
  kind: "CIERRE" | "APERTURA";
  startsOn: Date; // @db.Date → medianoche UTC del día
  endsOn: Date;
  startMin: number | null;
  endMin: number | null;
  capacity: number;
  online: boolean;
};

export type AppointmentLike = {
  professionalId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
};

export type ClinicAgendaSettings = {
  timezone: string;
  slotMinutes: number;
  minNoticeHours: number;
  bookingHorizonDays: number;
  onlineBooking: boolean;
};

export type SlotOption = {
  startsAt: Date;
  endsAt: Date;
  professionalId: string | null; // null = agenda de la clínica
};

export type AvailabilityInput = {
  clinic: ClinicAgendaSettings;
  rules: RuleLike[];
  exceptions: ExceptionLike[];
  appointments: AppointmentLike[];
  from: LocalDate;
  to: LocalDate; // inclusive
  // online: solo franjas `online`, con antelación mínima y horizonte (web y panel del cliente).
  // staff: todo el horario, sin antelación mínima ni horizonte (panel de clínica).
  mode: "online" | "staff";
  // undefined = todas las agendas · null = solo la de la clínica · id = solo ese profesional
  professionalId?: string | null;
  now?: Date;
};

export const ACTIVE_APPOINTMENT_STATUSES = ["RESERVADA", "CONFIRMADA"] as const;
export const CLINIC_RESOURCE = "clinica";

export function resourceKey(professionalId: string | null | undefined) {
  return professionalId ?? CLINIC_RESOURCE;
}

// ---------- Zona horaria con Intl (sin librerías) ----------

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

// Fecha y minutos de reloj local de un instante UTC.
export function localParts(utc: Date, tz: string): LocalDate & { minutes: number; seconds: number; weekday: number } {
  const p: Record<string, string> = {};
  for (const part of dtf(tz).formatToParts(utc)) p[part.type] = part.value;
  const y = +p.year;
  const m = +p.month;
  const d = +p.day;
  const minutes = (+p.hour % 24) * 60 + +p.minute;
  return { y, m, d, minutes, seconds: +p.second, weekday: isoWeekday({ y, m, d }) };
}

function offsetMinutes(utc: Date, tz: string) {
  const p = localParts(utc, tz);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, 0, p.minutes, p.seconds);
  return Math.round((asIfUtc - utc.getTime()) / 60000);
}

// Instante UTC de «este día local a estos minutos» en la zona dada
// (correcto también en los cambios de hora).
export function zonedToUtc(date: LocalDate, minutes: number, tz: string): Date {
  const naive = Date.UTC(date.y, date.m - 1, date.d) + minutes * 60000;
  const off1 = offsetMinutes(new Date(naive), tz);
  let utc = naive - off1 * 60000;
  const off2 = offsetMinutes(new Date(utc), tz);
  if (off2 !== off1) utc = naive - off2 * 60000;
  return new Date(utc);
}

export function todayLocal(tz: string, now = new Date()): LocalDate {
  const p = localParts(now, tz);
  return { y: p.y, m: p.m, d: p.d };
}

// ---------- Utilidades de fechas locales ----------

export function isoWeekday(d: LocalDate) {
  const wd = new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function compareDates(a: LocalDate, b: LocalDate) {
  return Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d);
}

export function dateKey(d: LocalDate) {
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

export function parseDateKey(s: string | null | undefined): LocalDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const d = { y: +m[1], m: +m[2], d: +m[3] };
  if (d.m < 1 || d.m > 12 || d.d < 1 || d.d > 31) return null;
  return d;
}

// Columna @db.Date: Prisma la devuelve como medianoche UTC de ese día.
export function dateColumnToLocal(d: Date): LocalDate {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
export function localToDateColumn(d: LocalDate): Date {
  return new Date(Date.UTC(d.y, d.m - 1, d.d));
}

// Lunes de la semana de un día.
export function startOfWeek(d: LocalDate): LocalDate {
  return addDays(d, 1 - isoWeekday(d));
}

export function fmtMin(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function parseHHMM(s: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

export const APPOINTMENT_KIND_LABEL: Record<string, string> = {
  ESTUDIO: "Estudio de la pisada",
  REPETICION: "Repetir prueba",
  REVISION: "Revisión",
  AJUSTE: "Ajuste de plantillas",
};
export const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  RESERVADA: "Reservada",
  CONFIRMADA: "Confirmada",
  COMPLETADA: "Realizada",
  CANCELADA: "Cancelada",
  NO_PRESENTADO: "No se presentó",
};

export const WEEKDAY_LABEL = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const WEEKDAY_SHORT = ["", "L", "M", "X", "J", "V", "S", "D"];

// ---------- Ventanas ----------

type Window = { startMin: number; endMin: number; capacity: number; online: boolean };

function subtractWindow(windows: Window[], s: number, e: number): Window[] {
  const out: Window[] = [];
  for (const w of windows) {
    if (e <= w.startMin || s >= w.endMin) {
      out.push(w);
      continue;
    }
    if (s > w.startMin) out.push({ ...w, endMin: s });
    if (e < w.endMin) out.push({ ...w, startMin: e });
  }
  return out;
}

function exceptionCoversDay(x: ExceptionLike, day: LocalDate) {
  return compareDates(dateColumnToLocal(x.startsOn), day) <= 0 && compareDates(dateColumnToLocal(x.endsOn), day) >= 0;
}

// Ventanas de una agenda en un día: horario semanal → cierres → aperturas.
export function windowsForDay(
  resource: string | null,
  day: LocalDate,
  rules: RuleLike[],
  exceptions: ExceptionLike[]
): Window[] {
  const wd = isoWeekday(day);
  let windows: Window[] = rules
    .filter((r) => r.professionalId === resource && r.weekday === wd)
    .map((r) => ({ startMin: r.startMin, endMin: r.endMin, capacity: r.capacity, online: r.online }));
  const todays = exceptions.filter((x) => exceptionCoversDay(x, day));
  // Cierres: los de toda la clínica afectan a todas las agendas; los de un
  // profesional, solo a la suya.
  for (const x of todays) {
    if (x.kind !== "CIERRE") continue;
    if (x.professionalId !== null && x.professionalId !== resource) continue;
    if (x.startMin == null || x.endMin == null) windows = [];
    else windows = subtractWindow(windows, x.startMin, x.endMin);
  }
  // Aperturas: solo sobre la agenda a la que pertenecen (null = agenda de la clínica).
  for (const x of todays) {
    if (x.kind !== "APERTURA" || x.professionalId !== resource) continue;
    if (x.startMin == null || x.endMin == null) continue;
    windows.push({ startMin: x.startMin, endMin: x.endMin, capacity: x.capacity, online: x.online });
  }
  return windows.sort((a, b) => a.startMin - b.startMin);
}

// Agendas presentes en la configuración (con horario o alguna apertura).
export function resourcesOf(rules: RuleLike[], exceptions: ExceptionLike[]): (string | null)[] {
  const set = new Set<string | null>();
  for (const r of rules) set.add(r.professionalId);
  for (const x of exceptions) if (x.kind === "APERTURA") set.add(x.professionalId);
  return [...set];
}

function overlaps(a: { startsAt: Date; endsAt: Date }, s: Date, e: Date) {
  return a.startsAt < e && a.endsAt > s;
}

export function isActiveAppointment(a: { status: string }) {
  return (ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(a.status);
}

// ---------- Cálculo principal ----------

// Devuelve los huecos por día (clave YYYY-MM-DD en hora local de la clínica),
// ordenados por hora; un mismo horario puede aparecer varias veces si lo
// ofrecen varias agendas (el llamador agrupa si el paciente no elige profesional).
export function computeAvailability(input: AvailabilityInput): Map<string, SlotOption[]> {
  const { clinic, rules, exceptions, appointments, mode } = input;
  const now = input.now ?? new Date();
  const tz = clinic.timezone;
  const out = new Map<string, SlotOption[]>();
  if (mode === "online" && !clinic.onlineBooking) return out;

  const earliest = mode === "online" ? new Date(now.getTime() + clinic.minNoticeHours * 3600 * 1000) : now;
  const horizonEnd = mode === "online" ? addDays(todayLocal(tz, now), clinic.bookingHorizonDays) : null;

  const resources = resourcesOf(rules, exceptions).filter((r) =>
    input.professionalId === undefined ? true : r === input.professionalId
  );
  const active = appointments.filter(isActiveAppointment);

  for (let day = input.from; compareDates(day, input.to) <= 0; day = addDays(day, 1)) {
    if (horizonEnd && compareDates(day, horizonEnd) > 0) break;
    const key = dateKey(day);
    const slots: SlotOption[] = [];
    for (const resource of resources) {
      const windows = windowsForDay(resource, day, rules, exceptions).filter((w) => mode === "staff" || w.online);
      const busy = active.filter((a) => a.professionalId === resource);
      for (const w of windows) {
        for (let t = w.startMin; t + clinic.slotMinutes <= w.endMin; t += clinic.slotMinutes) {
          const startsAt = zonedToUtc(day, t, tz);
          const endsAt = new Date(startsAt.getTime() + clinic.slotMinutes * 60000);
          if (startsAt < earliest) continue;
          const taken = busy.filter((a) => overlaps(a, startsAt, endsAt)).length;
          if (taken >= w.capacity) continue;
          slots.push({ startsAt, endsAt, professionalId: resource });
        }
      }
    }
    if (slots.length) out.set(key, slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()));
  }
  return out;
}

// ¿Está libre este instante concreto en una agenda? Se usa para la reserva,
// recalculando con los datos frescos dentro de la transacción.
export function findSlot(
  input: Omit<AvailabilityInput, "from" | "to">,
  startsAt: Date
): SlotOption | null {
  const day = localParts(startsAt, input.clinic.timezone);
  const map = computeAvailability({ ...input, from: day, to: day });
  const slots = map.get(dateKey(day)) ?? [];
  const same = slots.filter((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!same.length) return null;
  // Sin preferencia de profesional: primero una agenda personal, luego la de la clínica.
  return same.find((s) => s.professionalId !== null) ?? same[0];
}

// Hueco fuera de horario (solo personal de clínica, con «forzar»): basta con
// que la agenda elegida no tenga otra cita solapada.
export function isFreeIgnoringSchedule(
  appointments: AppointmentLike[],
  professionalId: string | null,
  startsAt: Date,
  endsAt: Date
) {
  return !appointments.some(
    (a) => isActiveAppointment(a) && a.professionalId === professionalId && overlaps(a, startsAt, endsAt)
  );
}
