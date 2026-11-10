// Traducción de la ocupación de Docfav a tramos ocupados de Ortosend (puro,
// sin base de datos). Cada agenda de Ortosend enlazada a un profesional de
// Docfav recibe como ocupado:
// - sus citas en CUALQUIER sitio (centro, domicilio…), salvo las anuladas y las
//   que son copia de citas de Ortosend;
// - sus reservas de tiempo y de grupo;
// - sus ausencias (días libres y franjas libres);
// - con «respetar horario», todo lo que queda fuera de su horario de trabajo EN
//   LA AGENDA ENLAZADA (el sitio donde se apuntan las citas de Ortosend: su
//   horario a domicilio no abre horas en el centro). Si esa agenda no tiene
//   ningún horario en el rango, se entiende que no lo usa y no se bloquea nada
//   por ese motivo.
import { addDays, compareDates, dateKey, parseDateKey, zonedToUtc, type LocalDate } from "../agenda";
import type { DfOccupied } from "./docfav";

export type Tramo = {
  professionalId: string | null;
  startsAt: Date;
  endsAt: Date;
  kind: "cita" | "bloqueo" | "ausencia" | "fuera_horario";
  externalId?: string | null;
};

export type EnlaceLike = { professionalId: string | null; externalStaffId: string; externalCalendarId: string };

const MIN_DIA = 24 * 60;

function hhmm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  return m ? Math.min(+m[1] * 60 + +m[2], MIN_DIA) : null;
}

// Instante de Docfav: con zona (Z o ±hh:mm) es UTC; sin zona, hora local.
function instante(v: string, tz: string): Date | null {
  const t = v.trim();
  if (!t.includes("T")) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const d = new Date(t);
    return isNaN(+d) ? null : d;
  }
  const day = parseDateKey(t.slice(0, 10));
  const min = hhmm(t.slice(11));
  return day && min !== null ? zonedToUtc(day, min, tz) : null;
}

// Día entero local → [00:00, 24:00) en UTC.
function diaEntero(day: LocalDate, tz: string): [Date, Date] {
  return [zonedToUtc(day, 0, tz), zonedToUtc(addDays(day, 1), 0, tz)];
}

// Ausencias: el formato no está documentado, así que se aceptan las formas
// razonables y se descarta lo que no se entienda (se cuenta para avisar).
export function ausenciaATramos(x: unknown, tz: string): [Date, Date][] | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  const from = str("from") || str("start") || str("start_date") || str("date_from");
  const to = str("to") || str("end") || str("end_date") || str("date_to");
  const date = str("date") || str("day");
  // Instantes completos
  const a = from ? instante(from, tz) : null;
  const b = to ? instante(to, tz) : null;
  if (a && b && b > a) return [[a, b]];
  // Rango de días
  const d1 = parseDateKey(from.slice(0, 10));
  const d2 = parseDateKey(to.slice(0, 10));
  if (d1 && d2 && !from.includes(":")) {
    const out: [Date, Date][] = [];
    for (let d = d1; compareDates(d, d2) <= 0; d = addDays(d, 1)) out.push(diaEntero(d, tz));
    return out;
  }
  // Un día, con o sin horas
  const dd = parseDateKey(date.slice(0, 10));
  if (dd) {
    const m1 = from ? hhmm(from) : null;
    const m2 = to ? hhmm(to) : null;
    if (m1 !== null && m2 !== null && m2 > m1) return [[zonedToUtc(dd, m1, tz), zonedToUtc(dd, m2, tz)]];
    return [diaEntero(dd, tz)];
  }
  return null;
}

export function tramosOcupados(input: {
  occupied: DfOccupied[];
  links: EnlaceLike[];
  ownIds: Set<string>; // ids en Docfav de citas que son copia de citas de Ortosend
  tz: string;
  from: LocalDate;
  to: LocalDate; // inclusive
  respectHours: boolean;
}): { tramos: Tramo[]; ausenciasSinEntender: number } {
  const { occupied, links, ownIds, tz, from, to, respectHours } = input;
  const tramos: Tramo[] = [];
  let ausenciasSinEntender = 0;

  for (const link of links) {
    const suyos = occupied.filter((o) => o.staffId === link.externalStaffId);
    const pid = link.professionalId;
    const vistos = new Set<string>();

    for (const o of suyos) {
      for (const a of o.appointments) {
        if (a.behaviour === "cancelled") continue;
        if (a.id && (ownIds.has(a.id) || vistos.has(a.id))) continue;
        if (a.id) vistos.add(a.id);
        const s = instante(a.from, tz);
        const e = instante(a.to, tz);
        if (s && e && e > s) tramos.push({ professionalId: pid, startsAt: s, endsAt: e, kind: "cita", externalId: a.id ?? null });
      }
      for (const r of o.reservations) {
        if (r.id && vistos.has(r.id)) continue;
        if (r.id) vistos.add(r.id);
        const s = instante(r.from, tz);
        const e = instante(r.to, tz);
        if (s && e && e > s) tramos.push({ professionalId: pid, startsAt: s, endsAt: e, kind: "bloqueo", externalId: r.id ?? null });
      }
      for (const x of o.absences) {
        const rs = ausenciaATramos(x, tz);
        if (!rs) {
          ausenciasSinEntender++;
          continue;
        }
        for (const [s, e] of rs) tramos.push({ professionalId: pid, startsAt: s, endsAt: e, kind: "ausencia" });
      }
    }

    if (!respectHours) continue;
    // Horario de trabajo de la agenda enlazada, por día local.
    const porDia = new Map<string, [number, number][]>();
    for (const o of suyos.filter((x) => x.staffCalendarId === link.externalCalendarId))
      for (const w of o.workingHours) {
        const a = hhmm(w.from);
        const b = hhmm(w.to);
        if (a === null || b === null || b <= a) continue;
        porDia.set(w.date, [...(porDia.get(w.date) ?? []), [a, b]]);
      }
    if (porDia.size === 0) continue; // sin horario configurado en Docfav: no se usa
    for (let d = from; compareDates(d, to) <= 0; d = addDays(d, 1)) {
      const ventanas = (porDia.get(dateKey(d)) ?? []).sort((x, y) => x[0] - y[0]);
      let cursor = 0;
      const huecos: [number, number][] = [];
      for (const [a, b] of ventanas) {
        if (a > cursor) huecos.push([cursor, a]);
        cursor = Math.max(cursor, b);
      }
      if (cursor < MIN_DIA) huecos.push([cursor, MIN_DIA]);
      for (const [a, b] of huecos)
        tramos.push({
          professionalId: pid,
          startsAt: zonedToUtc(d, a, tz),
          endsAt: b === MIN_DIA ? zonedToUtc(addDays(d, 1), 0, tz) : zonedToUtc(d, b, tz),
          kind: "fuera_horario",
        });
    }
  }
  return { tramos, ausenciasSinEntender };
}

// ¿Bloquea este conflicto de la comprobación en tiempo real? Las copias de
// citas de Ortosend no; el horario solo si la clínica pide respetarlo; lo
// desconocido, por prudencia, sí.
export function conflictoBloquea(c: { id?: string; type?: string }, ownIds: Set<string>, respectHours: boolean) {
  if (c.id && ownIds.has(c.id)) return false;
  const t = (c.type ?? "").toLowerCase();
  if (/work|hour|schedule|horario/.test(t)) return respectHours;
  return true;
}
