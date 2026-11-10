// Docfav en memoria para los tests del conector (se inyecta con usarDocfav).
import { DocfavError, type Docfav, type DfClient, type DfConflict, type DfOccupied } from "@/lib/conector/docfav";

export class FakeDocfav implements Docfav {
  clinica = { id: "dfc-1", name: "Centre Kalma" };
  sitios = [
    { id: "lugar-centro", name: "Centre Kalma", active: true },
    { id: "lugar-casa", name: "A domicilio", active: true },
  ];
  personal = [{ id: "staff-abraham", fullname: "Abraham Ramirez", active: true }];
  agendas = [
    { id: "sc-abraham-centro", staffId: "staff-abraham", placeId: "lugar-centro", active: true },
    { id: "sc-abraham-casa", staffId: "staff-abraham", placeId: "lugar-casa", active: true },
  ];
  servicios = [
    { id: "srv-ortosend", name: "Ortosend", active: true, minutes: 45 },
    { id: "srv-viejo", name: "Ortosend antiguo", active: false, minutes: 45 },
  ];
  clientes: DfClient[] = [];
  citas: { id: string; clientId: string; serviceId: string; staffCalendarId: string; from: Date; to: Date; note: string; behaviour: string }[] = [];
  // Ocupación «ajena» que devuelve occupied (por sitio)
  ocupado: Record<string, DfOccupied[]> = {};
  // Conflictos que devuelve la comprobación en tiempo real
  conflictos: DfConflict[] = [];
  llamadas: string[] = [];
  private n = 0;

  async me() {
    return { id: "user-1", email: "clinica@test.com" };
  }
  async clinics() {
    return [this.clinica];
  }
  async staff() {
    return this.personal;
  }
  async places() {
    return this.sitios;
  }
  async staffCalendars() {
    return this.agendas;
  }
  async services() {
    return this.servicios;
  }
  async occupied(_c: string, placeId: string, start: string, end: string) {
    this.llamadas.push(`occupied ${placeId} ${start} ${end}`);
    return this.ocupado[placeId] ?? [];
  }
  async checkAvailability(_c: string, _p: string, staffCalendarId: string, from: Date, to: Date) {
    this.llamadas.push(`check ${staffCalendarId} ${from.toISOString()}`);
    const propias = this.citas
      .filter((x) => x.behaviour !== "cancelled" && x.staffCalendarId === staffCalendarId && x.from < to && x.to > from)
      .map((x) => ({ id: x.id, type: "appointment", from: x.from.toISOString(), to: x.to.toISOString() }));
    const conflicts = [...this.conflictos, ...propias];
    return { available: conflicts.length === 0, conflicts };
  }
  async searchClients(_c: string, keyword: string) {
    this.llamadas.push(`search ${keyword}`);
    const k = keyword.toLowerCase();
    return this.clientes.filter((x) => (x.phone ?? "").replace(/\D/g, "").includes(k.replace(/\D/g, "") || "#") || (x.email ?? "") === k);
  }
  async createClient(_c: string, d: { firstname: string; lastname: string; phone?: string | null; email?: string | null }) {
    if (d.email && this.clientes.some((x) => x.email === d.email))
      throw new DocfavError("A client with this email already exists", "CLIENT_EMAIL_EXISTS", 409);
    const c = { id: `cli-${++this.n}`, firstname: d.firstname, lastname: d.lastname, phone: d.phone ?? null, email: d.email ?? null };
    this.clientes.push(c);
    this.llamadas.push(`createClient ${d.firstname} ${d.lastname} ${d.phone ?? ""} ${d.email ?? ""}`);
    return c;
  }
  async createAppointment(
    _c: string,
    a: { clientId: string; serviceId: string; staffCalendarId: string; from: Date; to: Date; note: string; timezone: string; force?: boolean }
  ) {
    if (!this.servicios.some((s) => s.id === a.serviceId && s.active)) throw new DocfavError("service_not_found", "service_not_found", 400);
    const id = `cita-${++this.n}`;
    this.citas.push({ id, clientId: a.clientId, serviceId: a.serviceId, staffCalendarId: a.staffCalendarId, from: a.from, to: a.to, note: a.note, behaviour: "confirmed" });
    this.llamadas.push(`createAppointment ${a.staffCalendarId} ${a.from.toISOString()}`);
    return { id };
  }
  async setBehaviour(_c: string, id: string, behaviour: "confirmed" | "unconfirmed" | "cancelled" | "no_show") {
    const x = this.citas.find((c) => c.id === id);
    if (!x) throw new DocfavError("not found", "not_found", 404);
    x.behaviour = behaviour;
    this.llamadas.push(`behaviour ${id} ${behaviour}`);
  }
  async deleteAppointment(_c: string, id: string) {
    this.citas = this.citas.filter((c) => c.id !== id);
  }
}
