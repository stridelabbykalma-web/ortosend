// Agenda sobre la base de datos: carga de horarios, cálculo de huecos y
// reserva atómica (sin dobles reservas), cancelación y sincronización de
// Case.appointmentAt. La lógica pura está en ./agenda.ts.
import type { Appointment, AppointmentKind, Prisma } from "@prisma/client";
import { prisma } from "./db";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  addDays,
  computeAvailability,
  findSlot,
  isFreeIgnoringSchedule,
  localParts,
  localToDateColumn,
  resourcesOf,
  type AvailabilityInput,
  type LocalDate,
  type SlotOption,
} from "./agenda";

type Db = Prisma.TransactionClient | typeof prisma;

export class AgendaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgendaError";
  }
}

export type ClinicAgenda = Awaited<ReturnType<typeof loadClinicAgenda>>;

// Todo lo necesario para calcular la disponibilidad de una clínica en un rango
// de días locales (inclusive).
export async function loadClinicAgenda(db: Db, clinicId: string, from: LocalDate, to: LocalDate) {
  const clinic = await db.clinic.findUnique({ where: { id: clinicId } });
  if (!clinic) throw new AgendaError("Clínica no encontrada");
  // Margen de un día a cada lado por el desfase entre UTC y la hora local.
  const startUtc = localToDateColumn(addDays(from, -1));
  const endUtc = localToDateColumn(addDays(to, 2));
  const [rules, exceptions, appointments, staff] = await Promise.all([
    db.availabilityRule.findMany({ where: { clinicId } }),
    db.availabilityException.findMany({
      where: { clinicId, startsOn: { lte: localToDateColumn(to) }, endsOn: { gte: localToDateColumn(from) } },
    }),
    db.appointment.findMany({
      where: { clinicId, status: { in: [...ACTIVE_APPOINTMENT_STATUSES] }, startsAt: { lt: endUtc }, endsAt: { gt: startUtc } },
    }),
    db.user.findMany({
      where: { clinicId, active: true, role: { in: ["PROFESIONAL", "ADMIN_CLINICA"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  // Reglas de profesionales que ya no están en la clínica no cuentan.
  const staffIds = new Set(staff.map((s) => s.id));
  const validRules = rules.filter((r) => r.professionalId === null || staffIds.has(r.professionalId));
  const validExceptions = exceptions.filter((x) => x.professionalId === null || staffIds.has(x.professionalId));
  return { clinic, rules: validRules, exceptions: validExceptions, appointments, staff };
}

// Nombre legible de una agenda.
export function resourceName(agenda: { staff: { id: string; name: string }[] }, professionalId: string | null) {
  if (professionalId === null) return "Agenda de la clínica";
  return agenda.staff.find((s) => s.id === professionalId)?.name ?? "Profesional";
}

// Agendas con horario configurado, con nombre, para selectores.
export function agendaResources(agenda: ClinicAgenda) {
  return resourcesOf(agenda.rules, agenda.exceptions).map((id) => ({ id, name: resourceName(agenda, id) }));
}

export function availabilityOf(
  agenda: ClinicAgenda,
  from: LocalDate,
  to: LocalDate,
  mode: AvailabilityInput["mode"],
  professionalId?: string | null,
  now?: Date
) {
  return computeAvailability({
    clinic: agenda.clinic,
    rules: agenda.rules,
    exceptions: agenda.exceptions,
    appointments: agenda.appointments,
    from,
    to,
    mode,
    professionalId,
    now,
  });
}

export type BookInput = {
  clinicId: string;
  caseId: string;
  startsAt: Date;
  // undefined = cualquier agenda · null = agenda de la clínica · id = ese profesional
  professionalId?: string | null;
  kind: AppointmentKind;
  source: "web" | "clinica" | "cliente";
  bookedBy?: string | null;
  notes?: string | null;
  mode: AvailabilityInput["mode"];
  // Solo personal de clínica: dar la cita aunque esté fuera del horario publicado.
  force?: boolean;
  // Cita que se sustituye (reprogramación): se cancela en la misma transacción.
  replaceAppointmentId?: string | null;
};

// Reserva atómica. Un bloqueo consultivo por clínica serializa las reservas
// concurrentes: la segunda espera, recalcula con la cita ya insertada y falla
// con «NO_DISPONIBLE» si el hueco se ha agotado.
export async function bookAppointment(tx: Prisma.TransactionClient, input: BookInput): Promise<Appointment> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"agenda:" + input.clinicId}))`;

  if (input.replaceAppointmentId) {
    const prev = await tx.appointment.findUnique({ where: { id: input.replaceAppointmentId } });
    if (!prev || prev.caseId !== input.caseId) throw new AgendaError("La cita a cambiar no existe");
    if (isActive(prev))
      await tx.appointment.update({
        where: { id: prev.id },
        data: { status: "CANCELADA", cancelledAt: new Date(), cancelledBy: input.bookedBy ?? null, cancelReason: "Reprogramada" },
      });
  }

  const tz = (await tx.clinic.findUnique({ where: { id: input.clinicId }, select: { timezone: true } }))?.timezone;
  if (!tz) throw new AgendaError("Clínica no encontrada");
  const day = localParts(input.startsAt, tz);
  const agenda = await loadClinicAgenda(tx, input.clinicId, day, day);
  if (input.startsAt.getTime() % 60000 !== 0) throw new AgendaError("Hora no válida");

  let slot: SlotOption | null = findSlot(
    {
      clinic: agenda.clinic,
      rules: agenda.rules,
      exceptions: agenda.exceptions,
      appointments: agenda.appointments,
      mode: input.mode,
      professionalId: input.professionalId,
    },
    input.startsAt
  );
  if (!slot && input.force && input.mode === "staff") {
    const professionalId = input.professionalId ?? null;
    const endsAt = new Date(input.startsAt.getTime() + agenda.clinic.slotMinutes * 60000);
    if (professionalId && !agenda.staff.some((s) => s.id === professionalId)) throw new AgendaError("Profesional no válido");
    if (!isFreeIgnoringSchedule(agenda.appointments, professionalId, input.startsAt, endsAt))
      throw new AgendaError("Esa agenda ya tiene una cita a esa hora");
    slot = { startsAt: input.startsAt, endsAt, professionalId };
  }
  if (!slot) throw new AgendaError("NO_DISPONIBLE");

  const appt = await tx.appointment.create({
    data: {
      clinicId: input.clinicId,
      caseId: input.caseId,
      professionalId: slot.professionalId,
      kind: input.kind,
      status: "RESERVADA",
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      source: input.source,
      bookedBy: input.bookedBy ?? null,
      notes: input.notes ?? null,
    },
  });
  await syncCaseAppointment(tx, input.caseId);
  return appt;
}

export function isActive(a: { status: string }) {
  return (ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(a.status);
}

export async function cancelAppointment(
  db: Db,
  appointmentId: string,
  by: string | null,
  reason: string | null,
  status: "CANCELADA" | "NO_PRESENTADO" = "CANCELADA"
) {
  const prev = await db.appointment.findUnique({ where: { id: appointmentId } });
  if (!prev || !isActive(prev)) throw new AgendaError("La cita ya no está activa");
  const appt = await db.appointment.update({
    where: { id: appointmentId },
    data: { status, cancelledAt: new Date(), cancelledBy: by, cancelReason: reason },
  });
  await syncCaseAppointment(db, prev.caseId);
  return appt;
}

// Case.appointmentAt = próxima cita activa (o la última activa pasada, para
// que la agenda del día siga mostrando la hora), o null si no hay ninguna.
export async function syncCaseAppointment(db: Db, caseId: string) {
  const next = await db.appointment.findFirst({
    where: { caseId, status: { in: [...ACTIVE_APPOINTMENT_STATUSES] } },
    orderBy: { startsAt: "asc" },
  });
  await db.case.update({ where: { id: caseId }, data: { appointmentAt: next?.startsAt ?? null } });
  return next;
}

// Cita vigente de un caso (activa, la más próxima).
export async function activeAppointmentOf(db: Db, caseId: string) {
  return db.appointment.findFirst({
    where: { caseId, status: { in: [...ACTIVE_APPOINTMENT_STATUSES] } },
    orderBy: { startsAt: "asc" },
    include: { professional: { select: { id: true, name: true } }, clinic: true },
  });
}

// Al empezar el estudio en clínica, la cita del día queda como COMPLETADA
// (el paciente vino). Si no hay cita, no pasa nada (Flujo B sin cita).
export async function completeTodaysAppointment(db: Db, caseId: string) {
  const now = new Date();
  const dayStart = new Date(now.getTime() - 12 * 3600 * 1000);
  const dayEnd = new Date(now.getTime() + 12 * 3600 * 1000);
  const appt = await db.appointment.findFirst({
    where: { caseId, status: { in: [...ACTIVE_APPOINTMENT_STATUSES] }, startsAt: { gte: dayStart, lte: dayEnd } },
    orderBy: { startsAt: "asc" },
  });
  if (!appt) return null;
  await db.appointment.update({ where: { id: appt.id }, data: { status: "COMPLETADA" } });
  await syncCaseAppointment(db, caseId);
  return appt;
}
