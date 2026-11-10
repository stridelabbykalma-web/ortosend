// Cliente de la API de Docfav (https://www.docfav.com/api-connector/v1).
// La clave va en la cabecera X-Api-Key y la genera la clínica en Docfav:
// Mi cuenta → API Keys. Límite: 1.000 peticiones por hora y clave.
//
// Diferencias con la documentación pública, comprobadas contra la API real
// (noviembre de 2026):
// - Crear una cita EXIGE un paciente (client), aunque la documentación diga
//   que puede omitirse.
// - El estado inicial «pending» no existe: los válidos son confirmed,
//   unconfirmed y cancelled.
// - Solo valen servicios activos (el catálogo devuelve también los inactivos).
// - En available-slots, «from»/«to» llevan la marca Z pero son hora local; los
//   buenos son from_utc/to_utc (aquí no se usa ese endpoint).
//
// Los tests sustituyen el cliente con usarDocfav().

const API = "https://www.docfav.com/api-connector/v1";
const TIMEOUT_MS = 10_000;

export class DocfavError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message);
    this.name = "DocfavError";
  }
}

export type DfClinic = { id: string; name: string };
export type DfStaff = { id: string; fullname: string; active: boolean };
export type DfPlace = { id: string; name: string; active: boolean };
export type DfStaffCalendar = { id: string; staffId: string; placeId: string; active: boolean };
export type DfService = { id: string; name: string; active: boolean; minutes: number };
export type DfClient = { id: string; firstname: string; lastname: string; phone: string | null; email: string | null };
export type DfSpan = { id?: string; from: string; to: string; behaviour?: string | null };
export type DfOccupied = {
  staffId: string;
  staffCalendarId: string;
  workingHours: { date: string; from: string; to: string }[];
  appointments: DfSpan[];
  reservations: DfSpan[]; // reservas de tiempo y de grupo
  absences: unknown[]; // day_offs y time_offs (formato sin documentar: se interpreta con cuidado)
};
export type DfConflict = { id?: string; type?: string; from?: string; to?: string };

export interface Docfav {
  me(): Promise<{ id: string; email: string | null }>;
  clinics(): Promise<DfClinic[]>;
  staff(clinicId: string): Promise<DfStaff[]>;
  places(clinicId: string): Promise<DfPlace[]>;
  staffCalendars(clinicId: string): Promise<DfStaffCalendar[]>;
  services(clinicId: string): Promise<DfService[]>;
  occupied(clinicId: string, placeId: string, startDate: string, endDate: string): Promise<DfOccupied[]>;
  checkAvailability(
    clinicId: string,
    placeId: string,
    staffCalendarId: string,
    from: Date,
    to: Date
  ): Promise<{ available: boolean; conflicts: DfConflict[] }>;
  searchClients(clinicId: string, keyword: string): Promise<DfClient[]>;
  createClient(
    clinicId: string,
    c: { firstname: string; lastname: string; phone?: string | null; email?: string | null }
  ): Promise<DfClient>;
  createAppointment(
    clinicId: string,
    a: {
      clientId: string;
      serviceId: string;
      staffCalendarId: string;
      from: Date;
      to: Date;
      note: string;
      timezone: string;
      force?: boolean;
    }
  ): Promise<{ id: string }>;
  setBehaviour(clinicId: string, appointmentId: string, behaviour: "confirmed" | "unconfirmed" | "cancelled" | "no_show"): Promise<void>;
  deleteAppointment(clinicId: string, appointmentId: string): Promise<void>;
}

type Json = Record<string, unknown>;

function primerError(errors: unknown): { code: string; message: string } | null {
  if (!errors) return null;
  if (Array.isArray(errors)) {
    if (!errors.length) return null;
    const e = errors[0] as Json;
    return { code: String(e.code ?? "error"), message: String(e.message ?? e.code ?? "error") };
  }
  if (typeof errors === "object") {
    const e = errors as Json;
    if (!Object.keys(e).length) return null;
    return { code: String(e.code ?? "error"), message: String(e.message ?? e.code ?? "error") };
  }
  return { code: "error", message: String(errors) };
}

const s = (v: unknown) => (v == null ? "" : String(v));
const sOrNull = (v: unknown) => (v == null || v === "" ? null : String(v));
const lista = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

export class DocfavApi implements Docfav {
  constructor(private apiKey: string) {}

  private async call(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "X-Api-Key": this.apiKey,
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      throw new DocfavError(`No se pudo conectar con Docfav (${e instanceof Error ? e.message : "red"})`, "network", 0);
    }
    let json: Json = {};
    try {
      json = (await res.json()) as Json;
    } catch {
      // respuesta sin cuerpo JSON
    }
    const err = primerError(json.errors);
    if (!res.ok || err) {
      const code = err?.code ?? `http_${res.status}`;
      throw new DocfavError(err?.message ?? `Docfav respondió ${res.status}`, code, res.status);
    }
    return json.data;
  }

  async me() {
    const d = (await this.call("GET", "/me")) as Json;
    return { id: s(d?.id), email: sOrNull(d?.email) };
  }

  async clinics() {
    return lista(await this.call("GET", "/backofficeclinics")).map((c) => ({ id: s(c.id), name: s(c.name).trim() }));
  }

  async staff(clinicId: string) {
    return lista(await this.call("GET", `/backofficeclinics/${clinicId}/staff`)).map((x) => ({
      id: s(x.id),
      fullname: s(x.fullname).replace(/\s+/g, " ").trim(),
      active: x.is_active !== false,
    }));
  }

  async places(clinicId: string) {
    return lista(await this.call("GET", `/backofficeclinics/${clinicId}/calendars`)).map((x) => ({
      id: s(x.id),
      name: s(x.name).trim(),
      active: x.is_active !== false,
    }));
  }

  async staffCalendars(clinicId: string) {
    return lista(await this.call("GET", `/backofficeclinics/${clinicId}/staffcalendars`)).map((x) => ({
      id: s(x.id),
      staffId: s(x.back_office_staff_id),
      placeId: s(x.calendar_id),
      active: x.is_active !== false,
    }));
  }

  async services(clinicId: string) {
    const out: DfService[] = [];
    for (let offset = 0; offset < 2000; offset += 100) {
      const page = lista(
        await this.call("GET", `/backofficeclinics/${clinicId}/services`, { query: { limit: "100", offset: String(offset) } })
      );
      for (const x of page)
        out.push({ id: s(x.id), name: s(x.name).trim(), active: x.is_active === true, minutes: Math.round(Number(x.duration ?? 0) / 60) });
      if (page.length < 100) break;
    }
    return out;
  }

  async occupied(clinicId: string, placeId: string, startDate: string, endDate: string) {
    const data = lista(
      await this.call("GET", `/backofficeclinics/${clinicId}/calendars/${placeId}/occupied`, {
        query: { start_date: startDate, end_date: endDate },
      })
    );
    const span = (x: Json): DfSpan => ({ id: sOrNull(x.id) ?? undefined, from: s(x.from), to: s(x.to), behaviour: sOrNull(x.behaviour) });
    return data.map((p) => ({
      staffId: s(p.staff_id),
      staffCalendarId: s(p.staff_calendar_id),
      workingHours: lista(p.working_hours).map((w) => ({ date: s(w.date), from: s(w.from), to: s(w.to) })),
      appointments: lista(p.appointments).map(span),
      reservations: [...lista(p.time_reservations), ...lista(p.group_reservations)].map(span),
      absences: [...lista(p.day_offs), ...lista(p.time_offs)],
    }));
  }

  async checkAvailability(clinicId: string, placeId: string, staffCalendarId: string, from: Date, to: Date) {
    const d = (await this.call("GET", `/backofficeclinics/${clinicId}/calendars/${placeId}/check-availability`, {
      query: { from: from.toISOString().replace(/\.\d{3}Z$/, "Z"), to: to.toISOString().replace(/\.\d{3}Z$/, "Z"), staff_calendar_id: staffCalendarId },
    })) as Json;
    return {
      available: d?.available === true,
      conflicts: lista(d?.conflicts).map((c) => ({ id: sOrNull(c.id) ?? undefined, type: s(c.type), from: s(c.from), to: s(c.to) })),
    };
  }

  async searchClients(clinicId: string, keyword: string) {
    const d = (await this.call("GET", `/backofficeclinics/${clinicId}/clients/autocomplete`, {
      query: { keyword, limit: "20" },
    })) as Json;
    const rows = Array.isArray(d) ? (d as Json[]) : lista(d?.items);
    return rows.map(aCliente);
  }

  async createClient(clinicId: string, c: { firstname: string; lastname: string; phone?: string | null; email?: string | null }) {
    const d = (await this.call("POST", `/backofficeclinics/${clinicId}/clients`, {
      body: {
        firstname: c.firstname,
        lastname: c.lastname,
        ...(c.phone ? { phone: c.phone } : {}),
        ...(c.email ? { email: c.email } : {}),
      },
    })) as Json;
    return aCliente(d);
  }

  async createAppointment(
    clinicId: string,
    a: { clientId: string; serviceId: string; staffCalendarId: string; from: Date; to: Date; note: string; timezone: string; force?: boolean }
  ) {
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
    const d = lista(
      await this.call("POST", `/backofficeclinics/${clinicId}/appointments`, {
        body: {
          client: a.clientId,
          timezone: a.timezone,
          send_reminder: false, // los avisos al paciente los manda Ortosend
          behaviour: "confirmed",
          force: a.force === true,
          appointments: [
            { service: a.serviceId, back_office_staff_calendar: a.staffCalendarId, from: iso(a.from), to: iso(a.to), note: a.note },
          ],
        },
      })
    );
    if (!d[0]?.id) throw new DocfavError("Docfav no devolvió la cita creada", "sin_id", 200);
    return { id: s(d[0].id) };
  }

  async setBehaviour(clinicId: string, appointmentId: string, behaviour: "confirmed" | "unconfirmed" | "cancelled" | "no_show") {
    await this.call("PUT", `/backofficeclinics/${clinicId}/appointments/${appointmentId}/behaviour`, { body: { behaviour } });
  }

  async deleteAppointment(clinicId: string, appointmentId: string) {
    await this.call("DELETE", `/backofficeclinics/${clinicId}/appointments/${appointmentId}`);
  }
}

function aCliente(x: Json): DfClient {
  return {
    id: s(x.id),
    firstname: s(x.firstname ?? x.name).trim(),
    lastname: s(x.lastname ?? x.surname).trim(),
    phone: sOrNull(x.phone ?? x.telephone),
    email: sOrNull(x.email),
  };
}

// --- Inyección para los tests ---
let fabrica: ((apiKey: string) => Docfav) | null = null;
export function usarDocfav(f: ((apiKey: string) => Docfav) | null) {
  fabrica = f;
}
export function docfav(apiKey: string): Docfav {
  return fabrica ? fabrica(apiKey) : new DocfavApi(apiKey);
}
