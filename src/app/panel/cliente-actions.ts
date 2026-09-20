"use server";

// Acciones del cliente: pago (simulado hasta integrar Stripe), acceso a documentos clínicos y citas.
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { requireRole, verifyPassword } from "@/lib/auth";
import { audit, notify, pushEvent } from "@/lib/cases";
import { activeAppointmentOf, bookAppointment, cancelAppointment } from "@/lib/agenda-db";
import { agendaErrorMessage, parseSlot, type SlotOk } from "@/lib/reserva-form";
import { fmtdt } from "@/lib/format";

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

// --- Citas: el cliente puede cambiar o anular su cita desde el panel ---
// Estados que admiten cita gestionada por el cliente: CITA_RESERVADA (estudio)
// y DEVUELTO_CLINICA (repetir una prueba, sin coste).
const CLIENT_BOOKABLE = ["CITA_RESERVADA", "DEVUELTO_CLINICA"];

export async function reprogramarCitaAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const { u, kase } = await myCase(caseId);
  const back = `/reserva/${kase.clinicId}?caso=${caseId}`;
  if (!CLIENT_BOOKABLE.includes(kase.state)) fail("/panel", "Este caso no admite cambiar la cita");
  const slot = parseSlot(formData);
  if (!slot.ok) fail(back, slot.error);
  const actual = await activeAppointmentOf(prisma, caseId);
  const kind = kase.state === "DEVUELTO_CLINICA" ? "REPETICION" : "ESTUDIO";
  let startsAt: Date | null = null;
  try {
    const appt = await prisma.$transaction((tx) =>
      bookAppointment(tx, {
        clinicId: kase.clinicId,
        caseId,
        startsAt: (slot as SlotOk).startsAt,
        professionalId: (slot as SlotOk).professionalId,
        kind,
        source: "cliente",
        bookedBy: u.id,
        mode: "online",
        replaceAppointmentId: actual?.id ?? null,
      })
    );
    startsAt = appt.startsAt;
  } catch (e) {
    fail(back, agendaErrorMessage(e));
  }
  await pushEvent(
    caseId,
    actual
      ? `Cita cambiada por el cliente: de ${fmtdt(actual.startsAt)} a ${fmtdt(startsAt)}`
      : `Cita reservada por el cliente (${kind === "REPETICION" ? "repetir prueba" : "estudio"}) — ${fmtdt(startsAt)}`,
    u.name
  );
  if (u.phone)
    await notify(u.phone, actual ? "cita_cambiada" : "cita_confirmada", {
      caseId,
      clinica: kase.clinic.name,
      direccion: kase.clinic.address,
      fecha: startsAt!.toISOString(),
    });
  redirect("/panel?ok=" + encodeURIComponent(`Cita ${actual ? "cambiada" : "confirmada"}: ${fmtdt(startsAt)}`));
}

export async function cancelarCitaAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const { u, kase } = await myCase(caseId);
  if (!CLIENT_BOOKABLE.includes(kase.state)) fail("/panel", "Este caso no admite anular la cita");
  const actual = await activeAppointmentOf(prisma, caseId);
  if (!actual) fail("/panel", "No hay ninguna cita activa");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  await cancelAppointment(prisma, actual!.id, u.id, reason);
  await pushEvent(caseId, `Cita del ${fmtdt(actual!.startsAt)} anulada por el cliente${reason ? `: ${reason}` : ""}`, u.name);
  if (u.phone)
    await notify(u.phone, "cita_cancelada", {
      caseId,
      clinica: kase.clinic.name,
      fecha: actual!.startsAt.toISOString(),
      nota: "Tu cita queda anulada. Puedes reservar otra hora cuando quieras desde tu panel.",
    });
  redirect("/panel?ok=" + encodeURIComponent("Cita anulada. Puedes elegir otra hora cuando quieras."));
}
