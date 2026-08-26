"use server";

// Acciones del cliente: pago (simulado hasta integrar Stripe) y acceso a documentos clínicos.
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { requireRole, verifyPassword } from "@/lib/auth";
import { audit, notify, pushEvent } from "@/lib/cases";

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
