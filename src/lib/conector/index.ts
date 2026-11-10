// Conectores entre la agenda de Ortosend y los programas de agenda de la
// clínica. Una clínica puede tener varios a la vez (uno por programa): por
// ejemplo Docfav para unos profesionales y el calendario de Google de otro.
// Lo específico de cada programa está en su adaptador (proveedor-*.ts, ver
// registro.ts); aquí va lo común:
// 1. Lectura de la ocupación → tabla ExternalBusy, que el motor de
//    disponibilidad resta (lectura perezosa cada pocos minutos y en el cron).
// 2. Comprobación en tiempo real del hueco justo antes de reservar (si el
//    programa lo permite).
// 3. Copia de las citas de Ortosend en el programa (si lo permite): ficha del
//    paciente con los datos de su cuenta, cita con el servicio elegido, y
//    anulación o «no se presentó» cuando cambia en Ortosend. Idempotente: se
//    puede llamar tantas veces como haga falta y el cron reintenta lo pendiente.
import type { CalendarConnector, ConnectorLink, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { addDays, localToDateColumn, todayLocal, APPOINTMENT_KIND_LABEL } from "../agenda";
import { titularDe } from "../cases";
import { normalizeEmail, normalizePhone } from "../contacto";
import { descifrar } from "../secretos";
import { proveedorDe } from "./registro";
import { sinAcentos } from "./proveedor-docfav";
import type { Enlace, Proveedor, ProveedorApi } from "./tipos";

type Db = Prisma.TransactionClient | typeof prisma;
export type ConectorConEnlaces = CalendarConnector & { links: ConnectorLink[] };

export const FRESCURA_MIN = 5; // antigüedad máxima de la ocupación leída antes de volver a leer
const DIAS_MINIMOS = 60; // rango mínimo que se lee hacia delante
const ESPERA_LECTURA_MS = 8_000; // lo que una página espera a una lectura antes de seguir con lo que hay

// Conector listo para usarse: activo y, si es de API, con la cuenta elegida.
const LISTO = { active: true, OR: [{ kind: "ICAL" }, { externalClinicId: { not: null } }] } satisfies Prisma.CalendarConnectorWhereInput;

export async function conectoresDe(db: Db, clinicId: string): Promise<ConectorConEnlaces[]> {
  return db.calendarConnector.findMany({ where: { clinicId, ...LISTO }, include: { links: true }, orderBy: { createdAt: "asc" } });
}

export function claveDe(c: CalendarConnector): string | null {
  return c.apiKeyEnc ? descifrar(c.apiKeyEnc) : null;
}

function enlacesDe(c: ConectorConEnlaces): Enlace[] {
  return c.links.map((l) => {
    let secreto: string | null = null;
    try {
      secreto = l.secretEnc ? descifrar(l.secretEnc) : null;
    } catch {
      secreto = null;
    }
    return { ...l, secreto };
  });
}

// Mensaje entendible para la clínica a partir de un error del programa.
export function explicarError(e: unknown, kind?: string): string {
  const p = kind ? proveedorDe(kind) : null;
  if (p) return p.explicarError(e);
  return e instanceof Error ? e.message : String(e);
}

function api(p: Proveedor | null): ProveedorApi | null {
  return p && p.modo === "api" ? p : null;
}

// ---------- 1. Lectura de la ocupación ----------

// Ids en el programa de las citas que son copia de citas de Ortosend.
async function idsPropios(db: Db, clinicId: string) {
  const rows = await db.appointment.findMany({ where: { clinicId, externalId: { not: null } }, select: { externalId: true } });
  return new Set(rows.map((r) => r.externalId!));
}

export async function leerOcupacion(connectorId: string): Promise<{ ok: boolean; tramos: number; error?: string }> {
  const c = await prisma.calendarConnector.findUnique({ where: { id: connectorId }, include: { links: true, clinic: true } });
  const prov = c ? proveedorDe(c.kind) : null;
  if (!c || !c.active || !prov || (prov.modo === "api" && !c.externalClinicId))
    return { ok: false, tramos: 0, error: "Conector sin configurar" };
  const tz = c.clinic.timezone;
  const desde = todayLocal(tz);
  const hasta = addDays(desde, Math.max(c.clinic.bookingHorizonDays, DIAS_MINIMOS));
  try {
    const enlaces = enlacesDe(c);
    const r = await prov.leer({
      clave: claveDe(c),
      cuenta: c.externalClinicId,
      enlaces,
      tz,
      desde,
      hasta,
      ownIds: await idsPropios(prisma, c.clinicId),
      respectHours: c.respectHours,
    });
    // Los enlaces que fallaron conservan su ocupación anterior (mejor eso que
    // ofrecer horas que pueden estar ocupadas).
    const fallidos = new Set(r.enlacesFallidos ?? []);
    const conservar = enlaces.filter((e) => fallidos.has(e.id)).map((e) => e.professionalId);
    const conservarNull = conservar.includes(null);
    const conservarIds = conservar.filter((x): x is string => x !== null);
    const tramos = r.tramos.filter((t) => !conservar.includes(t.professionalId));
    await prisma.$transaction([
      prisma.externalBusy.deleteMany({
        where: {
          connectorId: c.id,
          ...(conservar.length
            ? { NOT: { OR: [...(conservarIds.length ? [{ professionalId: { in: conservarIds } }] : []), ...(conservarNull ? [{ professionalId: null }] : [])] } }
            : {}),
        },
      }),
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
          syncedFrom: localToDateColumn(desde),
          syncedTo: localToDateColumn(hasta),
          lastError: r.avisos.length ? r.avisos.join(" · ").slice(0, 1000) : null,
        },
      }),
    ]);
    return { ok: true, tramos: tramos.length };
  } catch (e) {
    const error = prov.explicarError(e);
    await prisma.calendarConnector.update({ where: { id: c.id }, data: { syncingAt: null, lastError: error } });
    return { ok: false, tramos: 0, error };
  }
}

// Lectura perezosa: si la última tiene más de FRESCURA_MIN minutos, se vuelve a
// leer (una sola a la vez por conector). La página espera como mucho unos
// segundos; si el programa tarda más, sigue con la ocupación que ya había.
export async function asegurarOcupacionFresca(clinicId: string) {
  const lista = await prisma.calendarConnector.findMany({ where: { clinicId, ...LISTO }, select: { id: true, lastSyncAt: true } });
  const ahora = Date.now();
  const pendientes: Promise<unknown>[] = [];
  for (const c of lista) {
    if (c.lastSyncAt && ahora - c.lastSyncAt.getTime() < FRESCURA_MIN * 60_000) continue;
    const reclamada = await prisma.calendarConnector.updateMany({
      where: { id: c.id, OR: [{ syncingAt: null }, { syncingAt: { lt: new Date(ahora - 2 * 60_000) } }] },
      data: { syncingAt: new Date(ahora) },
    });
    if (reclamada.count) pendientes.push(leerOcupacion(c.id));
  }
  if (pendientes.length) await Promise.race([Promise.all(pendientes), new Promise((r) => setTimeout(r, ESPERA_LECTURA_MS))]);
}

// ---------- 2. Comprobación al reservar ----------

// true: libre en todos los programas que la comprueban en tiempo real (o la
// agenda no está enlazada, o no se pudo comprobar: no se bloquea la reserva por
// una caída del programa; si de verdad estaba ocupado, la copia fallará y la
// clínica lo verá en su agenda).
export async function huecoLibreFuera(
  tx: Db,
  clinicId: string,
  slot: { professionalId: string | null; startsAt: Date; endsAt: Date }
): Promise<boolean> {
  const lista = await conectoresDe(tx, clinicId);
  let propios: Set<string> | null = null;
  for (const c of lista) {
    const prov = api(proveedorDe(c.kind));
    if (!prov?.comprobar || !c.externalClinicId) continue;
    const enlace = enlacesDe(c).find((l) => l.professionalId === slot.professionalId);
    if (!enlace) continue;
    try {
      propios ??= await idsPropios(tx, clinicId);
      const libre = await prov.comprobar(claveDe(c)!, c.externalClinicId, enlace, slot.startsAt, slot.endsAt, propios, c.respectHours);
      if (!libre) return false;
    } catch {
      // sin respuesta del programa: no se bloquea
    }
  }
  return true;
}

// ---------- 3. Copia de las citas en el programa ----------

async function servicioDe(c: CalendarConnector, prov: ProveedorApi): Promise<string | null> {
  if (!prov.servicios) return null;
  if (c.serviceId) return c.serviceId;
  const lista = await prov.servicios(claveDe(c)!, c.externalClinicId!);
  const s = lista.find((x) => x.active && sinAcentos(x.name) === sinAcentos(c.serviceName));
  if (!s) throw new Error(`Falta en ${prov.nombre} un servicio activo llamado «${c.serviceName}» (créalo o elige otro en Disponibilidad)`);
  await prisma.calendarConnector.update({ where: { id: c.id }, data: { serviceId: s.id } });
  return s.id;
}

// Datos del paciente para su ficha en el programa: los de su cuenta de Ortosend
// (menores: nombre del menor y contacto de su tutor).
async function pacienteParaPrograma(c: CalendarConnector, patientId: string) {
  const ref = await prisma.patientExternalRef.findUnique({ where: { patientId_connectorId: { patientId, connectorId: c.id } } });
  const p = await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, include: { owner: true } });
  const t = titularDe(p);
  // Sin apellidos guardados aparte: primera palabra nombre, resto apellidos.
  const [nombre, apellidos] = p.lastName
    ? [p.name.trim(), p.lastName.trim()]
    : [p.name.trim().split(/\s+/)[0] ?? p.name.trim(), p.name.trim().split(/\s+/).slice(1).join(" ")];
  return {
    nombre,
    apellidos,
    telefono: normalizePhone(t.phone) || null,
    email: normalizeEmail(t.email) || null,
    fichaConocida: ref?.externalId ?? null,
  };
}

const ACTIVAS = ["RESERVADA", "CONFIRMADA"];

// Deja la copia de la cita en el programa como debe estar según Ortosend.
export async function sincronizarCita(appointmentId: string, opts: { forzar?: boolean } = {}): Promise<void> {
  const a = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { case: { select: { number: true, patientId: true } }, clinic: { select: { timezone: true } } },
  });
  if (!a) return;

  // Copia hecha: reflejar anulación o «no se presentó» en el programa donde está.
  if (a.externalId) {
    const estado = a.status === "CANCELADA" ? "cancelada" : a.status === "NO_PRESENTADO" ? "no_presentado" : null;
    if (!estado || a.externalState === estado) return;
    const c = a.externalConnectorId ? await prisma.calendarConnector.findUnique({ where: { id: a.externalConnectorId } }) : null;
    const prov = c ? api(proveedorDe(c.kind)) : null;
    if (!c || !prov?.cambiarEstado || !c.externalClinicId) return;
    try {
      await prov.cambiarEstado(claveDe(c)!, c.externalClinicId, a.externalId, estado);
      await prisma.appointment.update({ where: { id: a.id }, data: { externalState: estado, externalError: null, externalAt: new Date() } });
    } catch (e) {
      await prisma.appointment.update({ where: { id: a.id }, data: { externalError: prov.explicarError(e) } });
    }
    return;
  }
  if (!ACTIVAS.includes(a.status) || a.endsAt < new Date()) return;

  // Programa que apunta citas y tiene enlazada esta agenda.
  const lista = await conectoresDe(prisma, a.clinicId);
  const destino = lista
    .map((c) => ({ c, prov: api(proveedorDe(c.kind)), enlace: enlacesDe(c).find((l) => l.professionalId === a.professionalId) }))
    .find((x) => x.prov?.apuntar && x.c.pushAppointments && x.enlace && x.c.externalClinicId);
  if (!destino) {
    // Solo marca «sin enlace» si la clínica tiene algún programa que apunte citas.
    const algunoApunta = lista.some((c) => api(proveedorDe(c.kind))?.apuntar && c.pushAppointments);
    if (algunoApunta && a.externalState !== "sin_enlace")
      await prisma.appointment.update({ where: { id: a.id }, data: { externalState: "sin_enlace", externalError: null } });
    return;
  }
  const { c, enlace } = destino;
  const prov = destino.prov!;

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
    const clave = claveDe(c)!;
    const paciente = await pacienteParaPrograma(c, a.case.patientId);
    const cita = (servicioId: string | null) =>
      prov.apuntar!(clave, c.externalClinicId!, {
        enlace: enlace!,
        servicioId,
        desde: a.startsAt,
        hasta: a.endsAt,
        timezone: a.clinic.timezone,
        nota: `Ortosend · caso #${a.case.number} · ${APPOINTMENT_KIND_LABEL[a.kind] ?? a.kind}`,
        paciente,
        forzar: opts.forzar === true,
      });
    let creada: { id: string; fichaId: string | null };
    try {
      creada = await cita(await servicioDe(c, prov));
    } catch (e) {
      // Servicio guardado que ya no vale: se busca otra vez por nombre una vez.
      if (!prov.esErrorDeServicio?.(e) || !c.serviceId) throw e;
      await prisma.calendarConnector.update({ where: { id: c.id }, data: { serviceId: null } });
      creada = await cita(await servicioDe({ ...c, serviceId: null }, prov));
    }
    if (creada.fichaId && creada.fichaId !== paciente.fichaConocida)
      await prisma.patientExternalRef.upsert({
        where: { patientId_connectorId: { patientId: a.case.patientId, connectorId: c.id } },
        create: { patientId: a.case.patientId, connectorId: c.id, externalId: creada.fichaId },
        update: { externalId: creada.fichaId },
      });
    await prisma.appointment.update({
      where: { id: a.id },
      data: { externalId: creada.id, externalConnectorId: c.id, externalState: "creada", externalError: null, externalAt: new Date() },
    });
    // Si una lectura de la ocupación la cazó antes de guardar su id, se quita.
    await prisma.externalBusy.deleteMany({ where: { connectorId: c.id, externalId: creada.id } });
  } catch (e) {
    await prisma.appointment.update({
      where: { id: a.id },
      data: { externalState: "error", externalError: prov.explicarError(e), externalAt: null },
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

// Cron: relee la ocupación de todos los conectores y reintenta las copias
// pendientes o con error.
export async function mantenimientoConectores() {
  const conectores = await prisma.calendarConnector.findMany({ where: LISTO, select: { id: true, clinicId: true, kind: true } });
  let lecturas = 0;
  let copias = 0;
  const clinicasQueApuntan = new Set<string>();
  for (const c of conectores) {
    if ((await leerOcupacion(c.id)).ok) lecturas++;
    if (api(proveedorDe(c.kind))?.apuntar) clinicasQueApuntan.add(c.clinicId);
  }
  for (const clinicId of clinicasQueApuntan) {
    const pendientes = await prisma.appointment.findMany({
      where: {
        clinicId,
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
