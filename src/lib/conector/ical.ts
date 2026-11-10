// Lectura de calendarios iCal (RFC 5545) como tramos ocupados. Sirve para
// cualquier programa o calendario que publique su agenda como enlace iCal de
// solo lectura: Google Calendar, Outlook/Microsoft 365, Apple iCloud y muchos
// programas de gestión de clínicas.
//
// Cubre lo que esos calendarios exportan en la práctica: horas en UTC, con
// TZID (IANA o nombres de Windows de Outlook) o flotantes; días enteros;
// duración por DTEND o DURATION; repeticiones RRULE (diaria, semanal con
// BYDAY, mensual por día del mes o por «n-ésimo día de la semana», anual) con
// INTERVAL, COUNT y UNTIL; EXDATE; ocurrencias modificadas (RECURRENCE-ID);
// y descarta los anulados (STATUS:CANCELLED) y los marcados como libres
// (TRANSP:TRANSPARENT). Puro: sin red ni base de datos.
import { addDays, compareDates, isoWeekday, localParts, zonedToUtc, type LocalDate } from "../agenda";

export type Ocupado = { startsAt: Date; endsAt: Date; uid: string };

type Prop = { name: string; params: Record<string, string>; value: string };
type Evento = { props: Prop[] };

// Nombres de zona de Windows que usa Outlook → IANA (los habituales en España y Europa).
const WINDOWS_TZ: Record<string, string> = {
  "romance standard time": "Europe/Madrid",
  "w. europe standard time": "Europe/Berlin",
  "central european standard time": "Europe/Warsaw",
  "central europe standard time": "Europe/Budapest",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "canary standard time": "Atlantic/Canary",
  "utc": "UTC",
  "coordinated universal time": "UTC",
};

export function zonaValida(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zonaDe(tzid: string | undefined, porDefecto: string): string {
  if (!tzid) return porDefecto;
  const limpio = tzid.replace(/^"|"$/g, "").replace(/^\/[^/]+\/[^/]+\//, ""); // prefijos tipo /mozilla.org/20050126_1/
  if (zonaValida(limpio)) return limpio;
  const w = WINDOWS_TZ[limpio.toLowerCase()];
  return w ?? porDefecto;
}

// --- Lectura del texto ---

function lineas(texto: string): string[] {
  // Desplegado de líneas: las que empiezan por espacio o tabulador continúan la anterior.
  const crudas = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const l of crudas) {
    if ((l.startsWith(" ") || l.startsWith("\t")) && out.length) out[out.length - 1] += l.slice(1);
    else if (l.trim()) out.push(l);
  }
  return out;
}

function propiedad(linea: string): Prop | null {
  // NOMBRE;PARAM=VALOR;PARAM="VALOR:CON:DOS:PUNTOS":valor
  let i = 0;
  let enComillas = false;
  for (; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"') enComillas = !enComillas;
    else if (ch === ":" && !enComillas) break;
  }
  if (i >= linea.length) return null;
  const cabeza = linea.slice(0, i);
  const value = linea.slice(i + 1);
  const partes = cabeza.match(/("[^"]*"|[^;])+/g) ?? [];
  const name = (partes.shift() ?? "").toUpperCase();
  const params: Record<string, string> = {};
  for (const p of partes) {
    const j = p.indexOf("=");
    if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

function eventos(texto: string): Evento[] {
  const out: Evento[] = [];
  let actual: Evento | null = null;
  let profundidad = 0; // para ignorar VALARM dentro del VEVENT
  for (const l of lineas(texto)) {
    const u = l.toUpperCase();
    if (u === "BEGIN:VEVENT") {
      actual = { props: [] };
      profundidad = 0;
      continue;
    }
    if (u === "END:VEVENT") {
      if (actual) out.push(actual);
      actual = null;
      continue;
    }
    if (!actual) continue;
    if (u.startsWith("BEGIN:")) {
      profundidad++;
      continue;
    }
    if (u.startsWith("END:")) {
      profundidad--;
      continue;
    }
    if (profundidad > 0) continue;
    const p = propiedad(l);
    if (p) actual.props.push(p);
  }
  return out;
}

// --- Fechas ---

type Momento =
  | { tipo: "dia"; dia: LocalDate } // VALUE=DATE (día entero)
  | { tipo: "utc"; fecha: Date }
  | { tipo: "local"; dia: LocalDate; min: number; seg: number; tz: string };

function momento(p: Prop, tzPorDefecto: string): Momento | null {
  const v = p.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const dia = { y: +m[1], m: +m[2], d: +m[3] };
  if (m[4] === undefined || p.params.VALUE === "DATE") return { tipo: "dia", dia };
  const min = +m[4] * 60 + +m[5];
  const seg = m[6] ? +m[6] : 0;
  if (m[7]) return { tipo: "utc", fecha: new Date(Date.UTC(dia.y, dia.m - 1, dia.d, +m[4], +m[5], seg)) };
  return { tipo: "local", dia, min, seg, tz: zonaDe(p.params.TZID, tzPorDefecto) };
}

function aUtc(x: Momento, tzPorDefecto: string): Date {
  if (x.tipo === "utc") return x.fecha;
  if (x.tipo === "dia") return zonedToUtc(x.dia, 0, tzPorDefecto);
  return new Date(zonedToUtc(x.dia, x.min, x.tz).getTime() + x.seg * 1000);
}

// Duración ISO 8601 de iCal: P1D, PT1H30M, -PT15M, P2W…
function duracionMs(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const n = (x?: string) => (x ? +x : 0);
  const ms = ((n(m[2]) * 7 + n(m[3])) * 86400 + n(m[4]) * 3600 + n(m[5]) * 60 + n(m[6])) * 1000;
  return m[1] === "-" ? -ms : ms;
}

// --- Repeticiones ---

const DIAS: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

type Regla = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: Date;
  byday: { n: number | null; wd: number }[];
  bymonthday: number[];
};

function regla(v: string, tzPorDefecto: string): Regla | null {
  const r: Record<string, string> = {};
  for (const parte of v.split(";")) {
    const [k, val] = parte.split("=");
    if (k && val) r[k.toUpperCase()] = val.toUpperCase();
  }
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(r.FREQ)) return null;
  let until: Date | undefined;
  if (r.UNTIL) {
    const mm = momento({ name: "UNTIL", params: {}, value: r.UNTIL }, tzPorDefecto);
    // UNTIL de día entero incluye ese día completo
    until = mm ? (mm.tipo === "dia" ? zonedToUtc(addDays(mm.dia, 1), 0, tzPorDefecto) : aUtc(mm, tzPorDefecto)) : undefined;
  }
  return {
    freq: r.FREQ as Regla["freq"],
    interval: Math.max(1, +(r.INTERVAL ?? 1) || 1),
    count: r.COUNT ? Math.max(1, +r.COUNT) : undefined,
    until,
    byday: (r.BYDAY ?? "")
      .split(",")
      .filter(Boolean)
      .map((x) => {
        const mm = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(x);
        return mm ? { n: mm[1] ? +mm[1] : null, wd: DIAS[mm[2]] } : null;
      })
      .filter((x): x is { n: number | null; wd: number } => !!x),
    bymonthday: (r.BYMONTHDAY ?? "").split(",").filter(Boolean).map(Number),
  };
}

function diasDelMes(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Días (locales) de un mes que cumplen la regla mensual/anual.
function diasDeMes(y: number, m: number, r: Regla, inicio: LocalDate): LocalDate[] {
  const total = diasDelMes(y, m);
  if (r.bymonthday.length)
    return r.bymonthday
      .map((d) => (d < 0 ? total + 1 + d : d))
      .filter((d) => d >= 1 && d <= total)
      .map((d) => ({ y, m, d }));
  if (r.byday.length) {
    const out: LocalDate[] = [];
    for (const b of r.byday) {
      const coinciden: number[] = [];
      for (let d = 1; d <= total; d++) if (isoWeekday({ y, m, d }) === b.wd) coinciden.push(d);
      if (b.n === null) coinciden.forEach((d) => out.push({ y, m, d }));
      else {
        const d = b.n > 0 ? coinciden[b.n - 1] : coinciden[coinciden.length + b.n];
        if (d) out.push({ y, m, d });
      }
    }
    return out;
  }
  return inicio.d <= total ? [{ y, m, d: inicio.d }] : [];
}

// Fechas de inicio (día local del evento) que genera la regla, en orden.
function* fechasDeRegla(inicio: LocalDate, r: Regla, hasta: LocalDate): Generator<LocalDate> {
  const ordenar = (xs: LocalDate[]) => xs.sort((a, b) => compareDates(a, b));
  let pasos = 0;
  if (r.freq === "DAILY") {
    for (let d = inicio; compareDates(d, hasta) <= 0 && pasos < 5000; d = addDays(d, r.interval), pasos++) yield d;
    return;
  }
  if (r.freq === "WEEKLY") {
    const dias = r.byday.length ? r.byday.map((b) => b.wd) : [isoWeekday(inicio)];
    let lunes = addDays(inicio, 1 - isoWeekday(inicio));
    for (; compareDates(lunes, hasta) <= 0 && pasos < 3000; lunes = addDays(lunes, 7 * r.interval), pasos++)
      for (const d of ordenar(dias.map((wd) => addDays(lunes, wd - 1)))) if (compareDates(d, inicio) >= 0) yield d;
    return;
  }
  if (r.freq === "MONTHLY") {
    for (let i = 0; pasos < 600; i += r.interval, pasos++) {
      const y = inicio.y + Math.floor((inicio.m - 1 + i) / 12);
      const m = ((inicio.m - 1 + i) % 12) + 1;
      if (compareDates({ y, m, d: 1 }, hasta) > 0) return;
      for (const d of ordenar(diasDeMes(y, m, r, inicio))) if (compareDates(d, inicio) >= 0) yield d;
    }
    return;
  }
  // YEARLY: mismo mes, mismo día (o los BYDAY/BYMONTHDAY de ese mes)
  for (let y = inicio.y; y <= hasta.y && pasos < 200; y += r.interval, pasos++)
    for (const d of ordenar(diasDeMes(y, inicio.m, r, inicio))) if (compareDates(d, inicio) >= 0) yield d;
}

// --- Principal ---

export function ocupadoDeIcal(
  texto: string,
  opts: { tz: string; desde: Date; hasta: Date; ignorarUid?: (uid: string) => boolean }
): { ocupado: Ocupado[]; descartados: number } {
  const { tz, desde, hasta } = opts;
  const lista = eventos(texto);
  const ocupado: Ocupado[] = [];
  let descartados = 0;
  const hastaLocal = localParts(hasta, tz);

  // Ocurrencias modificadas: UID → instantes de la ocurrencia original que sustituyen.
  const sustituidas = new Map<string, Set<number>>();
  for (const e of lista) {
    const rid = e.props.find((p) => p.name === "RECURRENCE-ID");
    const uid = e.props.find((p) => p.name === "UID")?.value ?? "";
    if (!rid || !uid) continue;
    const m = momento(rid, tz);
    if (!m) continue;
    const set = sustituidas.get(uid) ?? new Set<number>();
    set.add(aUtc(m, tz).getTime());
    sustituidas.set(uid, set);
  }

  for (const e of lista) {
    const get = (n: string) => e.props.find((p) => p.name === n);
    const uid = get("UID")?.value ?? "";
    if (opts.ignorarUid?.(uid)) continue;
    if ((get("STATUS")?.value ?? "").toUpperCase() === "CANCELLED") continue;
    if ((get("TRANSP")?.value ?? "").toUpperCase() === "TRANSPARENT") continue;
    const dtstart = get("DTSTART");
    const ini = dtstart ? momento(dtstart, tz) : null;
    if (!ini) {
      descartados++;
      continue;
    }
    // Duración: DTEND, DURATION o, si no hay, día entero / instante.
    const dtend = get("DTEND");
    const fin = dtend ? momento(dtend, tz) : null;
    const dur = get("DURATION") ? duracionMs(get("DURATION")!.value) : null;
    const inicioUtc = aUtc(ini, tz);
    let ms: number;
    if (fin) ms = (fin.tipo === "dia" ? zonedToUtc(fin.dia, 0, ini.tipo === "local" ? ini.tz : tz) : aUtc(fin, tz)).getTime() - inicioUtc.getTime();
    else if (dur !== null) ms = dur;
    else ms = ini.tipo === "dia" ? 86_400_000 : 0;
    if (!(ms > 0)) continue;

    const rrule = get("RRULE");
    const esSustitucion = !!get("RECURRENCE-ID");
    if (!rrule || esSustitucion) {
      const s = inicioUtc;
      const f = new Date(s.getTime() + ms);
      if (s < hasta && f > desde) ocupado.push({ startsAt: s, endsAt: f, uid });
      continue;
    }

    const r = regla(rrule.value, tz);
    if (!r) {
      descartados++;
      continue;
    }
    const excluidas = new Set<number>(sustituidas.get(uid) ?? []);
    for (const p of e.props.filter((x) => x.name === "EXDATE"))
      for (const v of p.value.split(",")) {
        const m = momento({ ...p, value: v }, tz);
        if (m) excluidas.add(aUtc(m, ini.tipo === "local" ? ini.tz : tz).getTime());
      }

    // Se repite la hora de reloj del evento en su zona (respeta los cambios de hora).
    const zonaEv = ini.tipo === "local" ? ini.tz : tz;
    const base = ini.tipo === "utc" ? localParts(ini.fecha, zonaEv) : null;
    const diaIni = ini.tipo === "utc" ? { y: base!.y, m: base!.m, d: base!.d } : ini.dia;
    const minIni = ini.tipo === "dia" ? 0 : ini.tipo === "utc" ? base!.minutes : ini.min;
    const segIni = ini.tipo === "local" ? ini.seg : ini.tipo === "utc" ? base!.seconds : 0;
    let n = 0;
    for (const d of fechasDeRegla(diaIni, r, hastaLocal)) {
      const s = new Date(zonedToUtc(d, minIni, zonaEv).getTime() + segIni * 1000);
      if (r.until && s > r.until) break;
      n++;
      if (r.count && n > r.count) break;
      if (excluidas.has(s.getTime())) continue;
      const f = new Date(s.getTime() + ms);
      if (s >= hasta) break;
      if (f > desde) ocupado.push({ startsAt: s, endsAt: f, uid });
    }
  }
  return { ocupado, descartados };
}
