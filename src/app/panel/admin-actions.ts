"use server";

// Acciones de administración Ortosend: solicitudes, red de clínicas, cierre de
// casos y mantenimiento (caducidad del enlace de pago + recordatorios).
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { notifyOwner, pushEvent, titularDe, avisarPaciente, reintentarEmailsPendientes, releaseStale } from "@/lib/cases";
import { fechaTextoLarga } from "@/lib/format";
import { PAY_LINK_DAYS, PAY_REMINDERS_DAYS, SOFT_EXPIRY_MONTHS } from "@/lib/states";
import { nacimientoLimiteMayoria } from "@/lib/edad";
import { enviarAvisoMayoria } from "@/lib/mayoria";
import { caducarVencidas, enviarRecordatorios, reintentarConfirmaciones } from "@/lib/alta";
import { limpiarRateLimit } from "@/lib/rate-limit";

function fail(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=` + encodeURIComponent(msg));
}

export async function applicationSetAction(formData: FormData) {
  const u = await requireRole("ADMIN");
  const id = String(formData.get("applicationId"));
  const status = String(formData.get("status"));
  if (!["revision", "aprobada", "rechazada"].includes(status)) fail("/panel?tab=sol", "Estado no válido");
  const app = await prisma.clinicApplication.findUnique({ where: { id } });
  if (!app) fail("/panel?tab=sol", "Solicitud no encontrada");
  await prisma.clinicApplication.update({ where: { id }, data: { status } });
  if (status === "aprobada") {
    // Alta de la clínica en estado APROBADA: contrato + cesión de equipamiento +
    // cuentas + formación → el admin la pasa a ACTIVA y aparece en el buscador.
    await prisma.clinic.create({
      data: {
        name: app!.name,
        address: "(pendiente de completar)",
        town: app!.town,
        postalCode: "00000",
        hasPrescriber: app!.hasPrescriber,
        status: "APROBADA",
      },
    });
  }
  void u;
  redirect("/panel?tab=sol");
}

export async function clinicStatusAction(formData: FormData) {
  await requireRole("ADMIN");
  const id = String(formData.get("clinicId"));
  const status = String(formData.get("status"));
  if (!["ACTIVA", "SUSPENDIDA", "FORMACION", "BAJA"].includes(status)) fail("/panel?tab=cli", "Estado no válido");
  await prisma.clinic.update({ where: { id }, data: { status: status as "ACTIVA" } });
  redirect("/panel?tab=cli");
}

// Cierre tras el seguimiento de adaptación (día 20): programa la revisión anual.
export async function closeCaseAction(formData: FormData) {
  const u = await requireRole("ADMIN");
  const caseId = String(formData.get("caseId"));
  const kase = await prisma.case.findUnique({ where: { id: caseId }, include: { patient: true } });
  if (!kase || kase.state !== "ENTREGADO") fail("/panel?tab=cas", "El caso no está entregado");
  const annual = new Date();
  annual.setFullYear(annual.getFullYear() + 1);
  await prisma.case.update({ where: { id: caseId }, data: { state: "CERRADO", annualReviewAt: annual } });
  await pushEvent(caseId, "Caso cerrado tras seguimiento. Revisión anual programada", u.name);
  redirect("/panel?tab=cas");
}

// Reactivación blanda del enlace de pago (hasta 6 meses desde la caducidad).
export async function reactivatePayAction(formData: FormData) {
  const u = await requireRole("ADMIN");
  const caseId = String(formData.get("caseId"));
  const kase = await prisma.case.findUnique({ where: { id: caseId }, include: { patient: true } });
  if (!kase || kase.state !== "NO_CONVERTIDO") fail("/panel?tab=cas", "El caso no está caducado");
  const limit = new Date(kase.payLinkExpiresAt ?? kase.createdAt);
  limit.setMonth(limit.getMonth() + SOFT_EXPIRY_MONTHS);
  if (new Date() > limit) fail("/panel?tab=cas", `Han pasado más de ${SOFT_EXPIRY_MONTHS} meses: ya no se puede reactivar`);
  const expires = new Date(Date.now() + PAY_LINK_DAYS * 24 * 3600 * 1000);
  await prisma.case.update({
    where: { id: caseId },
    data: { state: "PENDIENTE_PAGO", payLinkExpiresAt: expires },
  });
  await pushEvent(caseId, "Enlace de pago reactivado (30 días)", u.name);
  await avisarPaciente(kase.patientId, "rx_lista_pago", {
    caseId,
    enlace: "/panel",
    nota: "Tu enlace de pago vuelve a estar activo 30 días más.",
  });
  redirect("/panel?tab=cas");
}

// Mantenimiento (en producción: cron diario — /api/cron). Caduca enlaces de pago
// a los 30 días y encola los recordatorios de los días 3/7/15.
export async function runJobsAction() {
  const u = await requireRole("ADMIN");
  const res = await runJobs();
  void u;
  redirect(
    "/panel?ok=" +
      encodeURIComponent(
        `Mantenimiento: ${res.expired} enlaces caducados, ${res.reminders} recordatorios de pago, ${res.citas} recordatorios de cita, ${res.mayoria} avisos de mayoría de edad, ${res.invitaciones} recordatorios de alta por WhatsApp, ${res.caducadas} altas caducadas, ${res.emailsReintentados} emails reintentados`
      )
  );
}

export async function runJobs() {
  const now = new Date();
  // Casos abiertos por alguien que dejó de navegar: se liberan a los 45 min.
  await releaseStale();
  // 1) Caducidad de enlaces de pago (30 días) → NO_CONVERTIDO
  const expiredCases = await prisma.case.findMany({
    where: { state: "PENDIENTE_PAGO", payLinkExpiresAt: { lt: now } },
    include: { patient: true },
  });
  for (const c of expiredCases) {
    await prisma.case.update({ where: { id: c.id }, data: { state: "NO_CONVERTIDO" } });
    await pushEvent(c.id, "Enlace de pago caducado (30 días) — no convertido", "sistema");
  }
  // 2) Recordatorio de pago: solo el ÚLTIMO día vencido (3/7/15), nunca la
  // ristra entera, y con reserva atómica (payReminderDay) por si el cron
  // corriera dos veces a la vez.
  let reminders = 0;
  const pending = await prisma.case.findMany({
    where: { state: "PENDIENTE_PAGO", payLinkExpiresAt: { not: null } },
    include: { patient: true },
  });
  for (const c of pending) {
    const sentAtDay = Math.floor(
      (now.getTime() - (c.payLinkExpiresAt!.getTime() - PAY_LINK_DAYS * 24 * 3600 * 1000)) / (24 * 3600 * 1000)
    );
    const due = PAY_REMINDERS_DAYS.filter((d) => sentAtDay >= d);
    if (!due.length) continue;
    const d = Math.max(...due);
    const template = `pago_d${d}`;
    // Compatibilidad con los casos de antes del marcador: si ya se avisó, se anota y listo.
    const already = await prisma.notification.findFirst({
      where: { template, payload: { path: ["caseId"], equals: c.id } },
    });
    const r = await prisma.case.updateMany({ where: { id: c.id, payReminderDay: { lt: d } }, data: { payReminderDay: d } });
    if (already || r.count === 0) continue;
    const nota = "Tu prescripción sigue lista y tu enlace de pago activo. Completa el pago para iniciar la fabricación.";
    await avisarPaciente(c.patientId, template, { caseId: c.id, enlace: "/panel", nota });
    reminders++;
  }
  // 3) Recordatorio de cita la víspera, por DÍA LOCAL de la clínica (no una
  // ventana de horas: un cron diario a las 8 avisaría tarde de la cita de
  // mañana a las 9). Marca atómica en reminderSentAt para no duplicar.
  let citas = 0;
  const soon = await prisma.appointment.findMany({
    where: {
      status: { in: ["RESERVADA", "CONFIRMADA"] },
      reminderSentAt: null,
      startsAt: { gt: now, lt: new Date(now.getTime() + 48 * 3600 * 1000) },
    },
    include: { clinic: true, case: { include: { patient: { include: { owner: true } } } } },
  });
  for (const a of soon) {
    const tz = a.clinic.timezone || "Europe/Madrid";
    const dia = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
    const citaDia = dia(a.startsAt);
    if (citaDia !== dia(now) && citaDia !== dia(new Date(now.getTime() + 24 * 3600 * 1000))) continue;
    const r = await prisma.appointment.updateMany({ where: { id: a.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (r.count === 0) continue;
    const titular = titularDe(a.case.patient);
    const esManana = citaDia !== dia(now);
    await notifyOwner(titular, a.case.patient.consents, "recordatorio_24h", {
      caseId: a.caseId,
      appointmentId: a.id,
      nombre: titular.name,
      paciente: a.case.patient.name !== titular.name ? a.case.patient.name : undefined,
      clinica: a.clinic.name,
      direccion: a.clinic.address,
      fecha: a.startsAt.toISOString(),
      fechaTexto: fechaTextoLarga(a.startsAt),
      enlace: "/panel",
      nota: `Recordatorio de tu cita de ${esManana ? "mañana" : "hoy"}. Trae tu calzado habitual. Si no puedes venir, cambia la hora desde tu panel.`,
    });
    citas++;
  }
  // 3b) Casos «en contacto» cuyo prescriptor lleva 7 días sin moverlos: vuelven
  // a la cola para que no se queden colgados de alguien de vacaciones o de baja.
  const quietos = await prisma.case.findMany({
    where: {
      state: "EN_CONTACTO",
      assignedTo: { not: null },
      events: { none: { at: { gt: new Date(now.getTime() - 7 * 24 * 3600 * 1000) } } },
    },
    select: { id: true },
  });
  for (const c of quietos) {
    await prisma.case.update({ where: { id: c.id }, data: { assignedTo: null, state: "EN_PRESCRIPCION" } });
    await pushEvent(c.id, "Sin actividad 7 días durante el contacto: el caso vuelve a la cola de prescripción", "sistema");
  }
  // 4) Mayoría de edad (16 años): aviso al paciente para que tome el control de su cuenta.
  let mayoria = 0;
  const mayores = await prisma.patient.findMany({
    where: { isMinor: true, handoverAt: null, handoverNoticeAt: null, birthDate: { lte: nacimientoLimiteMayoria(now) } },
    include: { owner: true },
  });
  for (const p of mayores) {
    if (p.owner && (await enviarAvisoMayoria(p, p.owner)) === "enviado") mayoria++;
  }
  // 5) Alta por WhatsApp: caducidad (72 h), recordatorio a las 24 h y
  // reintento de las etiquetas de ManyChat que fallaron al aceptar.
  const caducadas = await caducarVencidas();
  const invitaciones = await enviarRecordatorios(now);
  await reintentarConfirmaciones();
  await limpiarRateLimit();
  // Emails que no salieron en su momento (proveedor sin configurar o caído).
  const emailsReintentados = await reintentarEmailsPendientes();
  return { expired: expiredCases.length, reminders, citas, mayoria, invitaciones, caducadas, emailsReintentados };
}

// --- Altas de profesionales solicitadas por las clínicas ---
// Aprobar valida la ficha: crea la cuenta (con invitación de activación 72 h)
// y el perfil profesional; si prescribe, la colegiación queda verificada.
export async function professionalApplicationAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const id = String(formData.get("applicationId"));
  const decision = String(formData.get("decision"));
  const note = String(formData.get("note") ?? "").trim();
  const back = "/panel?tab=usr";
  const app = await prisma.professionalApplication.findUnique({ where: { id }, include: { clinic: true } });
  if (!app || app.status !== "recibida") fail(back, "Solicitud no encontrada o ya resuelta");

  if (decision === "rechazada") {
    await prisma.professionalApplication.update({
      where: { id },
      data: { status: "rechazada", resolutionNote: note || null, resolvedAt: new Date() },
    });
    redirect(back + "&ok=" + encodeURIComponent(`Solicitud de ${app.fullName} rechazada`));
  }
  if (decision !== "aprobada") fail(back, "Decisión no válida");

  const dup = await prisma.user.findFirst({ where: { OR: [{ email: app.email }, { phone: app.phone }] } });
  if (dup) fail(back, "Ya existe una cuenta con ese email o móvil");
  const user = await prisma.user.create({
    data: {
      email: app.email,
      phone: app.phone,
      role: "PROFESIONAL",
      name: app.fullName,
      clinicId: app.clinicId,
      invitedAt: new Date(),
      professional: {
        create: {
          dni: app.dni,
          degree: app.degree,
          canPrescribe: app.canPrescribe,
          collegiateNum: app.collegiateNum,
          college: app.college,
          // La aprobación de Ortosend implica colegiación validada.
          verifiedAt: app.canPrescribe ? new Date() : null,
        },
      },
    },
  });
  await prisma.professionalApplication.update({
    where: { id },
    data: { status: "aprobada", resolutionNote: note || null, resolvedAt: new Date() },
  });
  const { createInviteToken } = await import("@/lib/auth");
  const token = await createInviteToken(user.id);
  // Aviso al profesional: WhatsApp (si su flujo está configurado) o, si no, email.
  await notifyOwner({ name: app.fullName, phone: app.phone, email: app.email }, { whatsapp: { aceptado: true } }, "invitacion_profesional", {
    enlace: `/activar?token=${token}`,
    validez: "72 h",
    nota: `Bienvenido/a al equipo de ${app.clinic.name} en Ortosend. Activa tu cuenta y completa la formación (5 módulos).`,
  });
  void admin;
  redirect(back + "&ok=" + encodeURIComponent(`Cuenta de ${app.fullName} creada e invitación enviada`));
}
