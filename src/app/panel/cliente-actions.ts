"use server";

// Acciones del cliente: pago (simulado hasta integrar Stripe) y acceso a documentos clínicos.
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { hashPassword, requireRole, verifyPassword } from "@/lib/auth";
import { audit, notify, pushEvent } from "@/lib/cases";
import { isValidPhone, normalizeEmail, normalizePhone } from "@/lib/contacto";
import { enviarAvisoMayoria } from "@/lib/mayoria";
import { avisarContrasenaCambiada, enviarVerificacionEmail } from "@/lib/cuenta";

const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret");

function fail(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=` + encodeURIComponent(msg));
}

async function myCase(caseId: string) {
  const u = await requireRole("CLIENTE");
  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    include: { patient: true, prescription: true, payment: true, clinic: true },
  });
  if (!kase || kase.patient.ownerId !== u.id) throw new Error("Caso no accesible");
  return { u, kase };
}

// Pago vía Ortosend (Stripe: tarjeta/Bizum). Aquí simulado: en producción se
// crea un PaymentIntent y el webhook de Stripe ejecuta esta transición.
export async function payAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const { u, kase } = await myCase(caseId);
  const back = "/panel";
  if (kase.state !== "PENDIENTE_PAGO") fail(back, "El caso no está pendiente de pago");
  if (!kase.prescription) fail(back, "Sin prescripción no hay pago"); // regla dura
  if (kase.payLinkExpiresAt && kase.payLinkExpiresAt < new Date())
    fail(back, "El enlace de pago ha caducado. Escríbenos para reactivarlo.");
  const delivery = formData.get("delivery") === "CLINICA" ? "CLINICA" : "DOMICILIO";
  const method = formData.get("method") === "bizum" ? "bizum" : "card";
  await prisma.$transaction([
    prisma.payment.update({
      where: { caseId },
      data: { paidAt: new Date(), method, providerId: `pi_sim_${kase.number}` },
    }),
    prisma.case.update({ where: { id: caseId }, data: { state: "ENTRADA_TALLER", delivery } }),
  ]);
  await pushEvent(
    caseId,
    `Pago 199,99 € recibido (${method === "bizum" ? "Bizum" : "tarjeta"}, simulado). Entrega: ${
      delivery === "CLINICA" ? "recogida en clínica" : "domicilio"
    }`,
    u.name
  );
  if (u.phone)
    await notify(u.phone, "pago_recibido", {
      nota: "Pago recibido. Empezamos a fabricar tus plantillas: las recibirás en 5 días laborables.",
    });
  redirect("/panel?ok=" + encodeURIComponent("Pago recibido. ¡Empezamos a fabricar!"));
}

// Capa sensible: ver el documento clínico exige re-confirmar la contraseña.
// Genera un token de lectura de 10 minutos y registra el acceso (RGPD).
export async function unlockRxAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const { u, kase } = await myCase(caseId);
  const password = String(formData.get("password") ?? "");
  if (!u.passwordHash || !(await verifyPassword(password, u.passwordHash)))
    fail(`/caso/${caseId}`, "Contraseña incorrecta");
  if (!kase.prescription) fail(`/caso/${caseId}`, "Aún no hay prescripción");
  const doc = await new SignJWT({ caseId, kind: "doc" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(secret());
  await audit(u.id, "prescription.view", `case:${kase.number}`);
  redirect(`/caso/${caseId}?doc=${encodeURIComponent(doc)}`);
}

export async function verifyDocToken(token: string, caseId: string) {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.kind === "doc" && payload.caseId === caseId;
  } catch {
    return false;
  }
}

// --- Personas a cargo: contacto del menor (donde recibirá el aviso a los 16) ---
export async function updatePatientContactAction(formData: FormData) {
  const u = await requireRole("CLIENTE");
  const patientId = String(formData.get("patientId"));
  const back = "/panel";
  const patient = await prisma.patient.findFirst({ where: { id: patientId, ownerId: u.id } });
  if (!patient || !patient.isMinor) fail(back, "Persona no encontrada");
  const email = normalizeEmail(String(formData.get("email") ?? "")) || null;
  const phone = normalizePhone(String(formData.get("phone") ?? "")) || null;
  if (email && !email.includes("@")) fail(back, "Email no válido");
  if (email && email === u.email) fail(back, "El email del menor debe ser distinto del tuyo");
  if (phone && !isValidPhone(phone)) fail(back, "Móvil no válido");
  await prisma.patient.update({ where: { id: patientId }, data: { email, phone } });
  // Si ya tiene la edad y aún no se le había podido avisar, se le avisa ahora.
  const updated = await prisma.patient.findUnique({ where: { id: patientId } });
  const r = updated && !updated.handoverNoticeAt ? await enviarAvisoMayoria(updated, u) : "no_procede";
  redirect(
    back +
      "?ok=" +
      encodeURIComponent(
        r === "enviado" ? `Datos guardados. Hemos enviado a ${patient!.name} el enlace para gestionar su cuenta.` : "Datos guardados"
      )
  );
}

// Reenvío del aviso de mayoría de edad (enlace caducado o email corregido).
export async function resendHandoverAction(formData: FormData) {
  const u = await requireRole("CLIENTE");
  const patientId = String(formData.get("patientId"));
  const patient = await prisma.patient.findFirst({ where: { id: patientId, ownerId: u.id } });
  if (!patient) fail("/panel", "Persona no encontrada");
  const r = await enviarAvisoMayoria(patient!, u);
  redirect(
    "/panel?" +
      (r === "enviado"
        ? "ok=" + encodeURIComponent(`Aviso reenviado a ${patient!.email}`)
        : "error=" + encodeURIComponent(r === "sin_email" ? "Añade primero el email del menor" : "Aún no procede: no ha cumplido la edad"))
  );
}

// --- Mis datos de acceso: email, móvil y contraseña (con la contraseña actual) ---
export async function updateMyAccountAction(formData: FormData) {
  const u = await requireRole("CLIENTE");
  const back = "/panel";
  const current = String(formData.get("current") ?? "");
  if (!u.passwordHash || !(await verifyPassword(current, u.passwordHash))) fail(back, "La contraseña actual no es correcta");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const password = String(formData.get("password") ?? "");
  if (!email.includes("@")) fail(back, "Email no válido");
  if (!isValidPhone(phone)) fail(back, "Móvil no válido");
  if (password && password.length < 8) fail(back, "La nueva contraseña debe tener al menos 8 caracteres");
  const dup = await prisma.user.findFirst({ where: { id: { not: u.id }, OR: [{ email }, { phone }] } });
  if (dup) fail(back, "Ya existe otra cuenta con ese email o móvil");
  const emailCambiado = email !== u.email;
  const updated = await prisma.user.update({
    where: { id: u.id },
    data: {
      email,
      phone,
      ...(emailCambiado ? { emailVerifiedAt: null } : {}),
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
    },
  });
  await audit(u.id, "account.update", `user:${u.id}`);
  if (emailCambiado) await enviarVerificacionEmail(updated);
  if (password) await avisarContrasenaCambiada(updated);
  redirect(
    back +
      "?ok=" +
      encodeURIComponent(
        emailCambiado ? `Datos actualizados. Te hemos enviado un enlace a ${email} para confirmar el nuevo email.` : "Datos de acceso actualizados"
      )
  );
}
