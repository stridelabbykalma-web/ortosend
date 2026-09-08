"use server";

// Acciones de administración Ortosend: solicitudes, red de clínicas, cierre de
// casos y mantenimiento (caducidad del enlace de pago + recordatorios).
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { notify, pushEvent } from "@/lib/cases";
import { PAY_LINK_DAYS, PAY_REMINDERS_DAYS, SOFT_EXPIRY_MONTHS } from "@/lib/states";

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
  const owner = await prisma.user.findUnique({ where: { id: kase.patient.ownerId } });
  if (owner?.phone)
    await notify(owner.phone, "rx_lista_pago", { nota: "Tu enlace de pago vuelve a estar activo 30 días más." });
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
      encodeURIComponent(`Mantenimiento: ${res.expired} enlaces caducados, ${res.reminders} recordatorios encolados`)
  );
}

export async function runJobs() {
  const now = new Date();
  // 1) Caducidad de enlaces de pago (30 días) → NO_CONVERTIDO
  const expiredCases = await prisma.case.findMany({
    where: { state: "PENDIENTE_PAGO", payLinkExpiresAt: { lt: now } },
    include: { patient: true },
  });
  for (const c of expiredCases) {
    await prisma.case.update({ where: { id: c.id }, data: { state: "NO_CONVERTIDO" } });
    await pushEvent(c.id, "Enlace de pago caducado (30 días) — no convertido", "sistema");
  }
  // 2) Recordatorios de pago días 3/7/15
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
    const owner = await prisma.user.findUnique({ where: { id: c.patient.ownerId } });
    if (!owner?.phone) continue;
    for (const d of due) {
      const template = `pago_d${d}`;
      const already = await prisma.notification.findFirst({
        where: { template, toPhone: owner.phone, payload: { path: ["caseId"], equals: c.id } },
      });
      if (already) continue;
      await notify(owner.phone, template, {
        caseId: c.id,
        nota: "Tu prescripción sigue lista y tu enlace de pago activo. Completa el pago para iniciar la fabricación.",
      });
      reminders++;
    }
  }
  return { expired: expiredCases.length, reminders };
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
  await notify(app.phone, "invitacion_profesional", {
    enlace: `/activar?token=${token}`,
    validez: "72 h",
    nota: `Bienvenido/a al equipo de ${app.clinic.name} en Ortosend. Activa tu cuenta y completa la formación (5 módulos).`,
  });
  void admin;
  redirect(back + "&ok=" + encodeURIComponent(`Cuenta de ${app.fullName} creada e invitación enviada`));
}
