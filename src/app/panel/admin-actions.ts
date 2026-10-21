"use server";

// Acciones de administración Ortosend: solicitudes, red de clínicas, cierre de
// casos y mantenimiento (caducidad del enlace de pago + recordatorios).
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { notifyOwner, pushEvent, avisarPaciente } from "@/lib/cases";
import { runJobs } from "@/lib/jobs";
import { PAY_LINK_DAYS, SOFT_EXPIRY_MONTHS } from "@/lib/states";

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
  const kase = await prisma.case.findUnique({ where: { id: caseId }, include: { patient: true, prescription: true } });
  if (!kase || kase.state !== "NO_CONVERTIDO") fail("/panel?tab=cas", "El caso no está caducado");
  // El tope se cuenta desde el PRIMER vencimiento (firma + 30 días): si se
  // contara desde el último, cada reactivación alargaría el plazo sin fin.
  const primerVencimiento = kase.prescription
    ? new Date(kase.prescription.signedAt.getTime() + PAY_LINK_DAYS * 24 * 3600 * 1000)
    : new Date(kase.payLinkExpiresAt ?? kase.createdAt);
  const limit = new Date(primerVencimiento);
  limit.setMonth(limit.getMonth() + SOFT_EXPIRY_MONTHS);
  if (new Date() > limit) fail("/panel?tab=cas", `Han pasado más de ${SOFT_EXPIRY_MONTHS} meses desde el primer vencimiento: ya no se puede reactivar`);
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

// Mantenimiento (en producción: cron diario — /api/cron). La lógica vive en
// src/lib/jobs.ts: aquí solo el botón del panel de administración.
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

// --- Personal del taller ---
export async function invitarTallerAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const back = "/panel?tab=tal";
  const { invitarPersonalTaller } = await import("@/lib/personal-taller");
  const { ErrorTaller } = await import("@/lib/taller-ops");
  let nombre = "";
  try {
    const r = await invitarPersonalTaller(admin, {
      nombre: String(formData.get("nombre") ?? ""),
      email: String(formData.get("email") ?? ""),
      telefono: String(formData.get("telefono") ?? ""),
    });
    nombre = r.user.name;
  } catch (e) {
    if (e instanceof ErrorTaller) fail(back, e.message);
    throw e;
  }
  redirect(back + "&ok=" + encodeURIComponent(`${nombre}: cuenta creada e invitación enviada`));
}

export async function personalTallerAction(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const back = "/panel?tab=tal";
  const userId = String(formData.get("userId") ?? "");
  const accion = String(formData.get("accion") ?? "");
  const { activarPersonalTaller, reenviarInvitacionTaller } = await import("@/lib/personal-taller");
  const { ErrorTaller } = await import("@/lib/taller-ops");
  try {
    if (accion === "reinvitar") await reenviarInvitacionTaller(admin, userId);
    else if (accion === "baja") await activarPersonalTaller(admin, userId, false);
    else if (accion === "alta") await activarPersonalTaller(admin, userId, true);
    else fail(back, "Acción no válida");
  } catch (e) {
    if (e instanceof ErrorTaller) fail(back, e.message);
    throw e;
  }
  const textos: Record<string, string> = { reinvitar: "Invitación reenviada", baja: "Dado/a de baja", alta: "Reactivado/a" };
  redirect(back + "&ok=" + encodeURIComponent(textos[accion]));
}
