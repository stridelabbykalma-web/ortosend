// Adaptador de Docfav (API REST con clave por clínica). Lee la ocupación de
// todos los sitios del profesional, comprueba el hueco en tiempo real y apunta
// las citas de Ortosend con la ficha del paciente (buscada o creada).
import { addDays, dateKey, type LocalDate } from "../agenda";
import { normalizeEmail, normalizePhone } from "../contacto";
import { aE164 } from "../manychat";
import { docfav, DocfavError } from "./docfav";
import { conflictoBloquea, tramosOcupados } from "./ocupacion";
import type { ProveedorApi } from "./tipos";

const TRAMO_DIAS = 31; // días por petición de ocupación

const sinAcentos = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
const primeraPalabra = (t: string) => sinAcentos(t).split(/\s+/)[0] ?? "";

export const DOCFAV: ProveedorApi = {
  kind: "DOCFAV",
  modo: "api",
  nombre: "Docfav",
  corto: "Docfav",
  ayuda:
    "En Docfav: Mi cuenta → API Keys → Crear. Permisos: Appointments (read y write), Clients (read y write), Staff, Staff Calendars, Calendars, Schedules, Services, Clinics y User (read).",
  formatoClave: /^df_pk_[A-Za-z0-9_-]{16,}$/,

  async cuentas(clave) {
    const api = docfav(clave);
    await api.me();
    return api.clinics();
  },

  async agendas(clave, cuenta) {
    const api = docfav(clave);
    const [cals, staff, places] = await Promise.all([api.staffCalendars(cuenta), api.staff(cuenta), api.places(cuenta)]);
    return cals
      .filter((x) => x.active)
      .map((x) => ({
        id: x.id,
        staffId: x.staffId,
        placeId: x.placeId,
        nombre: `${staff.find((s) => s.id === x.staffId)?.fullname ?? "Profesional"} · ${places.find((p) => p.id === x.placeId)?.name ?? "—"}`,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  },

  async servicios(clave, cuenta) {
    return docfav(clave).services(cuenta);
  },

  async leer(ctx) {
    if (!ctx.enlaces.length || !ctx.clave || !ctx.cuenta) return { tramos: [], avisos: [] };
    const api = docfav(ctx.clave);
    const sitios = (await api.places(ctx.cuenta)).filter((p) => p.active);
    const rangos: [LocalDate, LocalDate][] = [];
    for (let d = ctx.desde; dateKey(d) <= dateKey(ctx.hasta); d = addDays(d, TRAMO_DIAS)) {
      const fin = addDays(d, TRAMO_DIAS - 1);
      rangos.push([d, dateKey(fin) < dateKey(ctx.hasta) ? fin : ctx.hasta]);
    }
    const partes = await Promise.all(sitios.flatMap((p) => rangos.map(([a, b]) => api.occupied(ctx.cuenta!, p.id, dateKey(a), dateKey(b)))));
    const r = tramosOcupados({
      occupied: partes.flat(),
      links: ctx.enlaces,
      ownIds: ctx.ownIds,
      tz: ctx.tz,
      from: ctx.desde,
      to: ctx.hasta,
      respectHours: ctx.respectHours,
    });
    return {
      tramos: r.tramos,
      avisos: r.ausenciasSinEntender ? [`${r.ausenciasSinEntender} ausencias de Docfav con un formato desconocido no se han tenido en cuenta`] : [],
    };
  },

  async comprobar(clave, cuenta, enlace, desde, hasta, ownIds, respectHours) {
    const r = await docfav(clave).checkAvailability(cuenta, enlace.externalPlaceId, enlace.externalCalendarId, desde, hasta);
    if (r.available) return true;
    return !r.conflicts.some((x) => conflictoBloquea(x, ownIds, respectHours));
  },

  async apuntar(clave, cuenta, cita) {
    if (!cita.servicioId) throw new Error("Falta el servicio de Docfav para las citas de Ortosend");
    const api = docfav(clave);
    const p = cita.paciente;
    let ficha = p.fichaConocida;
    if (!ficha) {
      // Ficha existente con el mismo móvil o email y el mismo nombre; si no, nueva.
      const phone = p.telefono ? normalizePhone(p.telefono) : "";
      const email = p.email ? normalizeEmail(p.email) : "";
      const candidatos = [
        ...(phone ? await api.searchClients(cuenta, phone.replace(/^\+/, "")) : []),
        ...(email ? await api.searchClients(cuenta, email) : []),
      ];
      ficha =
        candidatos.find(
          (x) =>
            primeraPalabra(x.firstname) === primeraPalabra(p.nombre) &&
            ((phone && x.phone && normalizePhone(x.phone) === phone) || (email && x.email && normalizeEmail(x.email) === email))
        )?.id ?? null;
      if (!ficha) {
        const datos = { firstname: p.nombre, lastname: p.apellidos, phone: phone ? aE164(phone) : null, email: email || null };
        try {
          ficha = (await api.createClient(cuenta, datos)).id;
        } catch (e) {
          // El email ya es de otra ficha (p. ej. el del padre en la de su hijo): sin email.
          if (e instanceof DocfavError && (e.code === "CLIENT_EMAIL_EXISTS" || e.status === 409))
            ficha = (await api.createClient(cuenta, { ...datos, email: null })).id;
          else throw e;
        }
      }
    }
    const creada = await api.createAppointment(cuenta, {
      clientId: ficha,
      serviceId: cita.servicioId,
      staffCalendarId: cita.enlace.externalCalendarId,
      from: cita.desde,
      to: cita.hasta,
      timezone: cita.timezone,
      note: cita.nota,
      force: cita.forzar,
    });
    return { id: creada.id, fichaId: ficha };
  },

  async cambiarEstado(clave, cuenta, externalId, estado) {
    await docfav(clave).setBehaviour(cuenta, externalId, estado === "cancelada" ? "cancelled" : "no_show");
  },

  esErrorDeServicio(e) {
    return e instanceof DocfavError && e.code === "service_not_found";
  },

  explicarError(e) {
    if (e instanceof DocfavError) {
      if (e.code === "network") return "Docfav no responde ahora mismo";
      if (e.status === 401 || e.status === 403) return "Docfav rechaza la clave de API (revisa que siga activa y con permisos)";
      if (e.status === 429 || e.code === "RATE_LIMIT_EXCEEDED") return "Se ha superado el límite de consultas a Docfav; se reintentará";
      if (e.code === "service_not_found") return "El servicio elegido no existe o está inactivo en Docfav";
      if (/client/i.test(e.code)) return `Docfav no acepta la ficha del paciente (${e.message})`;
      return `Docfav: ${e.message}`;
    }
    return e instanceof Error ? e.message : String(e);
  },
};

export { sinAcentos };
