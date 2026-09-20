"use server";

// Agenda del panel de clínica: dar/cancelar/reprogramar citas, horario semanal,
// excepciones (cierres y aperturas), ajustes de reserva online y feed iCal.
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import type { AppointmentKind, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { notify, pushEvent } from "@/lib/cases";
import { activeAppointmentOf, bookAppointment, cancelAppointment } from "@/lib/agenda-db";
import { agendaErrorMessage, parseSlot, type SlotOk } from "@/lib/reserva-form";
import { localToDateColumn, parseDateKey, parseHHMM, zonedToUtc } from "@/lib/agenda";
import { fmtdt } from "@/lib/format";

const KINDS: AppointmentKind[] = ["ESTUDIO", "REPETICION", "REVISION", "AJUSTE"];

function fail(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=` + encodeURIComponent(msg));
}
function ok(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}ok=` + encodeURIComponent(msg));
}

async function requireClinicStaff(): Promise<User & { clinicId: string }> {
  const u = await requireRole("PROFESIONAL", "ADMIN_CLINICA");
  if (!u.clinicId) throw new Error("Usuario sin clínica asignada");
  return u as User & { clinicId: string };
}

// Agenda que puede tocar cada uno: el administrador todas; el profesional solo la suya.
// Devuelve el professionalId normalizado (null = agenda de la clínica).
function agendaScope(u: User, raw: string | null | undefined, back: string): string | null {
  const v = (raw ?? "").trim();
  const target = v === "" || v === "clinica" ? null : v;
  if (u.role !== "ADMIN_CLINICA" && target !== u.id) fail(back, "Solo puedes editar tu propia agenda");
  return target;
}

// --- Citas ---

// Dar cita a un caso de la clínica (desde la agenda). El personal ve todo el
// horario (modo staff) y puede forzar una hora fuera de horario.
export async function darCitaAction(formData: FormData) {
  const u = await requireClinicStaff();
  const back = String(formData.get("back") ?? "/panel?tab=agenda");
  const caseId = String(formData.get("caseId") ?? "");
  const kase = await prisma.case.findUnique({ where: { id: caseId }, include: { patient: { include: { owner: true } }, clinic: true } });
  if (!kase || kase.clinicId !== u.clinicId) fail(back, "Caso no accesible");
  const kindRaw = String(formData.get("kind") ?? "ESTUDIO") as AppointmentKind;
  const kind = KINDS.includes(kindRaw) ? kindRaw : "ESTUDIO";

  // Hora: del calendario (startsAt ISO) o escrita a mano (fecha + hora local) con «forzar».
  let startsAt: Date | null = null;
  let professionalId: string | null | undefined;
  const force = formData.get("force") === "on";
  const manualDate = parseDateKey(String(formData.get("date") ?? ""));
  const manualTime = parseHHMM(String(formData.get("time") ?? ""));
  if (manualDate && manualTime !== null) {
    startsAt = zonedToUtc(manualDate, manualTime, kase!.clinic.timezone);
    const p = String(formData.get("professionalId") ?? "");
    professionalId = p === "" ? undefined : p === "clinica" ? null : p;
  } else {
    const slot = parseSlot(formData);
    if (!slot.ok) fail(back, slot.error);
    startsAt = (slot as SlotOk).startsAt;
    professionalId = (slot as SlotOk).professionalId;
  }
  if (!startsAt || startsAt < new Date()) fail(back, "La hora debe ser futura");
  if (force && professionalId === undefined) professionalId = null;

  const actual = await activeAppointmentOf(prisma, caseId);
  const replace = formData.get("replace") === "on" && actual ? actual.id : null;
  let appt: { startsAt: Date; professionalId: string | null } | null = null;
  try {
    appt = await prisma.$transaction((tx) =>
      bookAppointment(tx, {
        clinicId: u.clinicId,
        caseId,
        startsAt: startsAt!,
        professionalId,
        kind,
        source: "clinica",
        bookedBy: u.id,
        notes: String(formData.get("notes") ?? "").trim() || null,
        mode: "staff",
        force,
        replaceAppointmentId: replace,
      })
    );
  } catch (e) {
    const msg = agendaErrorMessage(e);
    fail(back, msg === "Esa hora acaba de ser reservada por otra persona. Elige otra." ? "Esa hora no está libre en el horario de la agenda. Elige otra o marca «fuera de horario»." : msg);
  }
  const pro = appt!.professionalId ? await prisma.user.findUnique({ where: { id: appt!.professionalId }, select: { name: true } }) : null;
  await pushEvent(
    caseId,
    `${replace ? "Cita cambiada" : "Cita dada"} por la clínica: ${fmtdt(appt!.startsAt)} (${pro?.name ?? "agenda de la clínica"})`,
    u.name
  );
  const phone = kase!.patient.owner.phone;
  if (phone)
    await notify(phone, replace ? "cita_cambiada" : "cita_confirmada", {
      caseId,
      clinica: kase!.clinic.name,
      direccion: kase!.clinic.address,
      fecha: appt!.startsAt.toISOString(),
    });
  ok(back, `Cita ${replace ? "cambiada" : "dada"} a ${kase!.patient.name}: ${fmtdt(appt!.startsAt)}`);
}

export async function cancelarCitaClinicaAction(formData: FormData) {
  const u = await requireClinicStaff();
  const back = String(formData.get("back") ?? "/panel?tab=agenda");
  const id = String(formData.get("appointmentId") ?? "");
  const appt = await prisma.appointment.findUnique({
    where: { id },
    include: { clinic: true, case: { include: { patient: { include: { owner: true } } } } },
  });
  if (!appt || appt.clinicId !== u.clinicId) fail(back, "Cita no accesible");
  const noShow = formData.get("status") === "NO_PRESENTADO";
  const reason = String(formData.get("reason") ?? "").trim() || null;
  try {
    await cancelAppointment(prisma, id, u.id, reason, noShow ? "NO_PRESENTADO" : "CANCELADA");
  } catch (e) {
    fail(back, agendaErrorMessage(e));
  }
  await pushEvent(
    appt!.caseId,
    noShow
      ? `El paciente no se presentó a la cita del ${fmtdt(appt!.startsAt)}`
      : `Cita del ${fmtdt(appt!.startsAt)} anulada por la clínica${reason ? `: ${reason}` : ""}`,
    u.name
  );
  const phone = appt!.case.patient.owner.phone;
  if (phone && !noShow)
    await notify(phone, "cita_cancelada", {
      caseId: appt!.caseId,
      clinica: appt!.clinic.name,
      fecha: appt!.startsAt.toISOString(),
      nota: "Tu clínica ha tenido que anular tu cita. Elige otra hora desde tu panel o te llamaremos para darte una nueva.",
    });
  ok(back, noShow ? "Marcada como no presentado" : "Cita anulada");
}

// --- Horario semanal ---

export async function addRuleAction(formData: FormData) {
  const u = await requireClinicStaff();
  const back = "/panel?tab=disp";
  const professionalId = agendaScope(u, String(formData.get("agenda") ?? ""), back);
  const weekdays = formData.getAll("weekday").map(Number).filter((d) => d >= 1 && d <= 7);
  const startMin = parseHHMM(String(formData.get("start")));
  const endMin = parseHHMM(String(formData.get("end")));
  const capacity = Math.max(1, Math.min(10, Number(formData.get("capacity") ?? 1) || 1));
  const online = formData.get("online") !== "off";
  if (!weekdays.length) fail(back, "Marca al menos un día de la semana");
  if (startMin === null || endMin === null || endMin <= startMin) fail(back, "Indica una franja válida (la hora de fin debe ser posterior a la de inicio)");
  if (professionalId) {
    const pro = await prisma.user.findFirst({ where: { id: professionalId, clinicId: u.clinicId, active: true } });
    if (!pro) fail(back, "Profesional no válido");
  }
  await prisma.availabilityRule.createMany({
    data: weekdays.map((weekday) => ({
      clinicId: u.clinicId,
      professionalId,
      weekday,
      startMin: startMin!,
      endMin: endMin!,
      capacity: professionalId ? 1 : capacity,
      online,
    })),
  });
  ok(back, "Franja añadida al horario");
}

export async function delRuleAction(formData: FormData) {
  const u = await requireClinicStaff();
  const back = "/panel?tab=disp";
  const id = String(formData.get("ruleId") ?? "");
  const rule = await prisma.availabilityRule.findUnique({ where: { id } });
  if (!rule || rule.clinicId !== u.clinicId) fail(back, "Franja no encontrada");
  agendaScope(u, rule.professionalId ?? "clinica", back);
  await prisma.availabilityRule.delete({ where: { id } });
  redirect(back);
}

// --- Excepciones: cierres (festivos, vacaciones, bajas) y aperturas puntuales ---

export async function addExceptionAction(formData: FormData) {
  const u = await requireClinicStaff();
  const back = "/panel?tab=disp";
  const professionalId = agendaScope(u, String(formData.get("agenda") ?? ""), back);
  const kind = formData.get("kind") === "APERTURA" ? "APERTURA" : "CIERRE";
  const startsOn = parseDateKey(String(formData.get("from") ?? ""));
  const endsOn = parseDateKey(String(formData.get("to") ?? "")) ?? startsOn;
  if (!startsOn || !endsOn) fail(back, "Indica la fecha (o el rango de fechas)");
  if (localToDateColumn(endsOn) < localToDateColumn(startsOn)) fail(back, "La fecha final es anterior a la inicial");
  const startMin = parseHHMM(String(formData.get("start") ?? ""));
  const endMin = parseHHMM(String(formData.get("end") ?? ""));
  const allDay = startMin === null && endMin === null;
  if (kind === "APERTURA" && allDay) fail(back, "Una apertura necesita hora de inicio y de fin");
  if (!allDay && (startMin === null || endMin === null || endMin <= startMin)) fail(back, "Franja horaria no válida");
  const capacity = Math.max(1, Math.min(10, Number(formData.get("capacity") ?? 1) || 1));
  await prisma.availabilityException.create({
    data: {
      clinicId: u.clinicId,
      professionalId,
      kind,
      startsOn: localToDateColumn(startsOn),
      endsOn: localToDateColumn(endsOn),
      startMin: allDay ? null : startMin,
      endMin: allDay ? null : endMin,
      capacity: professionalId ? 1 : capacity,
      online: formData.get("online") !== "off",
      note: String(formData.get("note") ?? "").trim() || null,
    },
  });
  ok(back, kind === "CIERRE" ? "Cierre anotado" : "Apertura puntual añadida");
}

export async function delExceptionAction(formData: FormData) {
  const u = await requireClinicStaff();
  const back = "/panel?tab=disp";
  const id = String(formData.get("exceptionId") ?? "");
  const x = await prisma.availabilityException.findUnique({ where: { id } });
  if (!x || x.clinicId !== u.clinicId) fail(back, "Excepción no encontrada");
  agendaScope(u, x.professionalId ?? "clinica", back);
  await prisma.availabilityException.delete({ where: { id } });
  redirect(back);
}

// --- Ajustes de la reserva online (solo administrador de clínica) ---

export async function saveAgendaSettingsAction(formData: FormData) {
  const u = await requireRole("ADMIN_CLINICA");
  const back = "/panel?tab=disp";
  if (!u.clinicId) fail(back, "Usuario sin clínica");
  const slotMinutes = Number(formData.get("slotMinutes"));
  const minNoticeHours = Number(formData.get("minNoticeHours"));
  const bookingHorizonDays = Number(formData.get("bookingHorizonDays"));
  if (![15, 20, 30, 45, 60, 90].includes(slotMinutes)) fail(back, "Duración de cita no válida");
  if (!(minNoticeHours >= 0 && minNoticeHours <= 168)) fail(back, "La antelación mínima debe estar entre 0 y 168 horas");
  if (!(bookingHorizonDays >= 7 && bookingHorizonDays <= 180)) fail(back, "El horizonte de reserva debe estar entre 7 y 180 días");
  await prisma.clinic.update({
    where: { id: u.clinicId! },
    data: {
      slotMinutes,
      minNoticeHours,
      bookingHorizonDays,
      onlineBooking: formData.get("onlineBooking") === "on",
      patientPicksPro: formData.get("patientPicksPro") === "on",
    },
  });
  ok(back, "Ajustes guardados");
}

// --- Suscripción iCal (Outlook / Google Calendar / Apple) ---
// Genera o renueva el token privado de la agenda del usuario o de la clínica.
export async function icalTokenAction(formData: FormData) {
  const u = await requireClinicStaff();
  const back = "/panel?tab=agenda";
  const scope = String(formData.get("scope") ?? "mia");
  const token = randomBytes(24).toString("base64url");
  if (scope === "clinica") {
    if (u.role !== "ADMIN_CLINICA") fail(back, "Solo el administrador puede generar el calendario de la clínica");
    await prisma.clinic.update({ where: { id: u.clinicId }, data: { calendarToken: token } });
  } else {
    await prisma.user.update({ where: { id: u.id }, data: { calendarToken: token } });
  }
  ok(back, "Enlace de calendario generado. Si ya tenías uno, el anterior deja de funcionar.");
}
