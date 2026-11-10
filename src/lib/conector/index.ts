// Conector entre la agenda de Ortosend y el programa de gestión de la clínica
// (de momento Docfav). Tres piezas:
// 1. Lectura de la ocupación → tabla ExternalBusy, que el motor de
//    disponibilidad resta (lectura perezosa cada pocos minutos y en el cron).
// 2. Comprobación en tiempo real del hueco justo antes de reservar.
// 3. Copia de las citas de Ortosend en el programa: alta del paciente con los
//    datos de su cuenta si no existe, cita con el servicio «Ortosend», y
//    anulación o «no se presentó» cuando cambia en Ortosend. Idempotente: se
//    puede llamar tantas veces como haga falta y el cron reintenta lo pendiente.
import type { CalendarConnector, ConnectorLink, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { addDays, dateKey, localToDateColumn, todayLocal, APPOINTMENT_KIND_LABEL, type LocalDate } from "../agenda";
import { titularDe } from "../cases";
import { normalizeEmail, normalizePhone } from "../contacto";
import { aE164 } from "../manychat";
import { descifrar } from "../secretos";
import { docfav, DocfavError, type Docfav } from "./docfav";
import { conflictoBloquea, tramosOcupados } from "./ocupacion";

type Db = Prisma.TransactionClient | typeof prisma;
export type ConectorConEnlaces = CalendarConnector & { links: ConnectorLink[] };

export const KIND_DOCFAV = "DOCFAV";
export const FRESCURA_MIN = 5; // antigüedad máxima de la ocupación leída antes de volver a leer
const DIAS_MINIMOS = 60; // rango mínimo que se lee hacia delante
const TRAMO_DIAS = 31; // días por petición de ocupación
const ESPERA_LECTURA_MS = 8_000; // lo que una página espera a una lectura antes de seguir con lo que hay

export async function conectorDe(db: Db, clinicId: string): Promise<ConectorConEnlaces | null> {
  return db.calendarConnector.findFirst({ where: { clinicId, kind: KIND_DOCFAV, active: true }, include: { links: true } });
}

export function clienteDe(c: CalendarConnector): Docfav {
  return docfav(descifrar(c.apiKeyEnc));
}

// Mensaje entendible para la clínica a partir de un error del programa.
export function explicarError(e: unknown): string {
  if (e instanceof DocfavError) {
    if (e.code === "network") return "Docfav no responde ahora mismo";
    if (e.status === 401 || e.status === 403) return "Docfav rechaza la clave de API (revisa que siga activa y con permisos)";
    if (e.status === 429 || e.code === "RATE_LIMIT_EXCEEDED") return "Se ha superado el límite de consultas a Docfav; se reintentará";
    if (e.code === "service_not_found") return "El servicio elegido no existe o está inactivo en Docfav";
    if (/client/i.test(e.code)) return `Docfav no acepta la ficha del paciente (${e.message})`;
    return `Docfav: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

// ---------- 1. Lectura de la ocupación ----------

// Ids en el programa de las citas que son copia de citas de Ortosend.
async function idsPropios(db: Db, clinicId: string) {
  const rows = await db.appointment.findMany({ where: { clinicId, externalId: { not: null } }, select: { externalId: true } });
  return new Set(rows.map((r) => r.externalId!));
}

export async function leerOcupacion(connectorId: string): Promise<{ ok: boolean; tramos: number; error?: string }> {
  const c = await prisma.calendarConnector.findUnique({ where: { id: connectorId }, include: { links: true, clinic: true } });
  if (!c || !c.active || !c.externalClinicId) return { ok: false, tramos: 0, error: "Conector sin configurar" };
  const tz = c.clinic.timezone;
  const from = todayLocal(tz);
  const to = addDays(from, Math.max(c.clinic.bookingHorizonDays, DIAS_MINIMOS));
  try {
    const api = clienteDe(c);
    let tramos: ReturnType<typeof tramosOcupados>["tramos"] = [];
    let raras = 0;
    if (c.links.length) {
      const sitios = (await api.places(c.externalClinicId)).filter((p) => p.active);
      const rangos: [LocalDate, LocalDate][] = [];
      for (let d = from; dateKey(d) <= dateKey(to); d = addDays(d, TRAMO_DIAS)) {
        const fin = addDays(d, TRAMO_DIAS - 1);
        rangos.push([d, dateKey(fin) < dateKey(to) ? fin : to]);
      }
      const partes = await Promise.all(
        sitios.flatMap((p) => rangos.map(([a, b]) => api.occupied(c.externalClinicId!, p.id, dateKey(a), dateKey(b))))
      );
      const r = tramosOcupados({
        occupied: partes.flat(),
        links: c.links,
        ownIds: await idsPropios(prisma, c.clinicId),
        tz,
        from,
        to,
        respectHours: c.respectHours,
      });
      tramos = r.tramos;
      raras = r.ausenciasSinEntender;
    }
    await prisma.$transaction([
      prisma.externalBusy.deleteMany({ where: { connectorId: c.id } }),
      prisma.externalBusy.createMany({
        data: tramos.map((t) => ({
          connectorId: c.id,
          clinicId: c.clinicId,
          professionalId: t.professionalId,
          startsAt: t.startsAt,
          endsAt: t.endsAt,
          kind: t.kind,
          externalId: t.externalId ?? null,
        })),
      }),
      prisma.calendarConnector.update({
        where: { id: c.id },
        data: {
          lastSyncAt: new Date(),
          syncingAt: null,
          syncedFrom: localToDateColumn(from),
          syncedTo: localToDateColumn(to),
          lastError: raras ? `${raras} ausencias de Docfav con un formato desconocido no se han tenido en cuenta` : null,
        },
      }),
    ]);
    return { ok: true, tramos: tramos.length };
  } catch (e) {
    const error = explicarError(e);
    await prisma.calendarConnector.update({ where: { id: c.id }, data: { syncingAt: null, lastError: error } });
    return { ok: false, tramos: 0, error };
  }
}

// Lectura perezosa: si la última tiene más de FRESCURA_MIN minutos, se vuelve a
// leer (una sola a la vez por clínica). La página espera como mucho unos
// segundos; si Docfav tarda más, sigue con la ocupación que ya había.
export async function asegurarOcupacionFresca(clinicId: string) {
  const c = await prisma.calendarConnector.findFirst({
    where: { clinicId, kind: KIND_DOCFAV, active: true, externalClinicId: { not: null } },
    select: { id: true, lastSyncAt: true },
  });
  if (!c) return;
  const ahora = Date.now();
  if (c.lastSyncAt && ahora - c.lastSyncAt.getTime() < FRESCURA_MIN * 60_000) return;
  const reclamada = await prisma.calendarConnector.updateMany({
    where: { id: c.id, OR: [{ syncingAt: null }, { syncingAt: { lt: new Date(ahora - 2 * 60_000) } }] },
    data: { syncingAt: new Date(ahora) },
  });
  if (reclamada.count === 0) return;
  await Promise.race([leerOcupacion(c.id), new Promise((r) => setTimeout(r, ESPERA_LECTURA_MS))]);
}

// ---------- 2. Comprobación al reservar ----------

// true: libre en el programa (o la agenda no está enlazada, o no se pudo
// comprobar: no se bloquea la reserva por una caída del programa; si de verdad
// estaba ocupado, la copia fallará y la clínica lo verá en su agenda).
export async function huecoLibreFuera(
  tx: Db,
  clinicId: string,
  slot: { professionalId: string | null; startsAt: Date; endsAt: Date }
): Promise<boolean> {
  const c = await conectorDe(tx, clinicId);
  if (!c || !c.externalClinicId) return true;
  const link = c.links.find((l) => l.professionalId === slot.professionalId);
  if (!link) return true;
  try {
    const r = await clienteDe(c).checkAvailability(c.externalClinicId, link.externalPlaceId, link.externalCalendarId, slot.startsAt, slot.endsAt);
    if (r.available) return true;
    const propios = await idsPropios(tx, clinicId);
    return !r.conflicts.some((x) => conflictoBloquea(x, propios, c.respectHours));
  } catch {
    return true;
  }
}

// ---------- 3. Copia de las citas en el programa ----------

const sinAcentos = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
const primeraPalabra = (t: string) => sinAcentos(t).split(/\s+/)[0] ?? "";

async function servicioDe(c: CalendarConnector, api: Docfav): Promise<string> {
  if (c.serviceId) return c.serviceId;
  const lista = await api.services(c.externalClinicId!);
  const s = lista.find((x) => x.active && sinAcentos(x.name) === sinAcentos(c.serviceName));
  if (!s) throw new Error(`Falta en Docfav un servicio activo llamado «${c.serviceName}» (créalo o elige otro en Disponibilidad)`);
  await prisma.calendarConnector.update({ where: { id: c.id }, data: { serviceId: s.id } });
  return s.id;
}

// Ficha del paciente en el programa: la guardada, una existente con el mismo
// móvil o email y el mismo nombre, o una nueva con los datos de su cuenta de
// Ortosend (menores: nombre del menor y contacto de su tutor).
export async function fichaDelPaciente(c: CalendarConnector, api: Docfav, patientId: string): Promise<string> {
  const ref = await prisma.patientExternalRef.findUnique({ where: { patientId_connectorId: { patientId, connectorId: c.id } } });
  if (ref) return ref.externalId;
  const p = await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, include: { owner: true } });
  const t = titularDe(p);
  const phone = normalizePhone(t.phone);
  const email = normalizeEmail(t.email);
  // Sin apellidos guardados aparte: primera palabra nombre, resto apellidos.
  const [firstname, lastname] = p.lastName
    ? [p.name.trim(), p.lastName.trim()]
    : [p.name.trim().split(/\s+/)[0] ?? p.name.trim(), p.name.trim().split(/\s+/).slice(1).join(" ")];

  const clinica = c.externalClinicId!;
  const candidatos = [
    ...(phone ? await api.searchClients(clinica, phone.replace(/^\+/, "")) : []),
    ...(email ? await api.searchClients(clinica, email) : []),
  ];
  const mismo = candidatos.find(
    (x) =>
      primeraPalabra(x.firstname) === primeraPalabra(firstname) &&
      ((phone && x.phone && normalizePhone(x.phone) === phone) || (email && x.email && normalizeEmail(x.email) === email))
  );
  let id = mismo?.id;
  if (!id) {
    const datos = { firstname, lastname, phone: phone ? aE164(phone) : null, email: email || null };
    try {
      id = (await api.createClient(clinica, datos)).id;
    } catch (e) {
      // El email ya es de otra ficha (p. ej. el del padre en la de su hijo): sin email.
      if (e instanceof DocfavError && (e.code === "CLIENT_EMAIL_EXISTS" || e.status === 409))
        id = (await api.createClient(clinica, { ...datos, email: null })).id;
      else throw e;
    }
  }
  await prisma.patientExternalRef.upsert({
    where: { patientId_connectorId: { patientId, connectorId: c.id } },
    create: { patientId, connectorId: c.id, externalId: id },
    update: { externalId: id },
  });
  return id;
}

const ACTIVAS = ["RESERVADA", "CONFIRMADA"];

// Deja la copia de la cita en el programa como debe estar según Ortosend.
export async function sincronizarCita(appointmentId: string, opts: { forzar?: boolean } = {}): Promise<void> {
  const a = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { case: { select: { number: true, patientId: true } }, clinic: { select: { timezone: true } } },
  });
  if (!a) return;
  const c = await conectorDe(prisma, a.clinicId);
  if (!c || !c.externalClinicId || !c.pushAppointments) return;
  const activa = ACTIVAS.includes(a.status);

  // Copia hecha: reflejar anulación o «no se presentó».
  if (a.externalId) {
    const objetivo = a.status === "CANCELADA" ? "cancelled" : a.status === "NO_PRESENTADO" ? "no_show" : null;
    const estado = objetivo === "cancelled" ? "cancelada" : objetivo === "no_show" ? "no_presentado" : null;
    if (!objetivo || a.externalState === estado) return;
    try {
      await clienteDe(c).setBehaviour(c.externalClinicId, a.externalId, objetivo);
      await prisma.appointment.update({ where: { id: a.id }, data: { externalState: estado, externalError: null, externalAt: new Date() } });
    } catch (e) {
      await prisma.appointment.update({ where: { id: a.id }, data: { externalError: explicarError(e) } });
    }
    return;
  }
  if (!activa || a.endsAt < new Date()) return;

  const link = c.links.find((l) => l.professionalId === a.professionalId);
  if (!link) {
    if (a.externalState !== "sin_enlace")
      await prisma.appointment.update({ where: { id: a.id }, data: { externalState: "sin_enlace", externalError: null } });
    return;
  }
  // Reserva del envío: evita dos copias si se llama a la vez (acción y cron).
  const ahora = new Date();
  const reservada = await prisma.appointment.updateMany({
    where: {
      id: a.id,
      externalId: null,
      OR: [{ externalState: null }, { externalState: { not: "enviando" } }, { externalAt: { lt: new Date(ahora.getTime() - 5 * 60_000) } }],
    },
    data: { externalState: "enviando", externalAt: ahora },
  });
  if (reservada.count === 0) return;
  try {
    const api = clienteDe(c);
    const servicio = await servicioDe(c, api);
    const cliente = await fichaDelPaciente(c, api, a.case.patientId);
    const crear = (serviceId: string) =>
      api.createAppointment(c.externalClinicId!, {
        clientId: cliente,
        serviceId,
        staffCalendarId: link.externalCalendarId,
        from: a.startsAt,
        to: a.endsAt,
        timezone: a.clinic.timezone,
        note: `Ortosend · caso #${a.case.number} · ${APPOINTMENT_KIND_LABEL[a.kind] ?? a.kind}`,
        force: opts.forzar === true,
      });
    let creada: { id: string };
    try {
      creada = await crear(servicio);
    } catch (e) {
      // Servicio guardado que ya no vale: se busca otra vez por nombre una vez.
      if (!(e instanceof DocfavError && e.code === "service_not_found") || !c.serviceId) throw e;
      await prisma.calendarConnector.update({ where: { id: c.id }, data: { serviceId: null } });
      creada = await crear(await servicioDe({ ...c, serviceId: null }, api));
    }
    await prisma.appointment.update({
      where: { id: a.id },
      data: { externalId: creada.id, externalState: "creada", externalError: null, externalAt: new Date() },
    });
    // Si una lectura de la ocupación la cazó antes de guardar su id, se quita.
    await prisma.externalBusy.deleteMany({ where: { connectorId: c.id, externalId: creada.id } });
  } catch (e) {
    await prisma.appointment.update({
      where: { id: a.id },
      data: { externalState: "error", externalError: explicarError(e), externalAt: null },
    });
  }
}

// Todas las citas de un caso que necesiten algo en el programa (tras reservar,
// cambiar, anular o marcar «no vino»). Nunca lanza: la reserva ya está hecha.
export async function sincronizarCaso(caseId: string) {
  try {
    const citas = await prisma.appointment.findMany({ where: { caseId }, orderBy: { createdAt: "asc" }, select: { id: true } });
    for (const x of citas) await sincronizarCita(x.id);
  } catch (e) {
    console.error("[conector] sincronizarCaso", caseId, e);
  }
}

// Cron: relee la ocupación de todas las clínicas conectadas y reintenta las
// copias pendientes o con error.
export async function mantenimientoConectores() {
  const conectores = await prisma.calendarConnector.findMany({
    where: { active: true, kind: KIND_DOCFAV, externalClinicId: { not: null } },
    select: { id: true, clinicId: true },
  });
  let lecturas = 0;
  let copias = 0;
  for (const c of conectores) {
    if ((await leerOcupacion(c.id)).ok) lecturas++;
    const pendientes = await prisma.appointment.findMany({
      where: {
        clinicId: c.clinicId,
        OR: [
          { status: { in: ["RESERVADA", "CONFIRMADA"] }, externalId: null, endsAt: { gt: new Date() } },
          { status: "CANCELADA", externalId: { not: null }, NOT: { externalState: "cancelada" } },
          { status: "NO_PRESENTADO", externalId: { not: null }, NOT: { externalState: "no_presentado" } },
        ],
      },
      select: { id: true },
      take: 50,
    });
    for (const p of pendientes) {
      await sincronizarCita(p.id);
      copias++;
    }
  }
  return { lecturas, copias };
}
