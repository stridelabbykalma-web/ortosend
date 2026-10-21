// Mantenimiento diario (cron /api/cron y botón del panel de administración).
// Vive en src/lib: en un fichero "use server" sería una action pública que
// cualquiera podría invocar sin el secreto del cron.
import { prisma } from "./db";
import { notifyOwner, pushEvent, titularDe, avisarPaciente, reintentarEmailsPendientes, releaseStale } from "./cases";
import { fechaTextoLarga } from "./format";
import { PAY_LINK_DAYS, PAY_REMINDERS_DAYS } from "./states";
import { nacimientoLimiteMayoria } from "./edad";
import { enviarAvisoMayoria } from "./mayoria";
import { caducarVencidas, enviarRecordatorios, reintentarConfirmaciones } from "./alta";
import { limpiarRateLimit } from "./rate-limit";

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
