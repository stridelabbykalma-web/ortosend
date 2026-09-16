"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
  verifyPassword,
  verifyHandoverToken,
  verifyInviteToken,
} from "@/lib/auth";
import { notifyEmail, notifyOwner, pushEvent, releaseAllBy } from "@/lib/cases";
import { isValidPhone, normalizeEmail, normalizeIdentifier, normalizePhone } from "@/lib/contacto";

const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(1),
});

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  const next = String(formData.get("next") ?? "");
  const dest = next.startsWith("/") && !next.startsWith("//") ? next : "/panel";
  const loginUrl = (msg: string) =>
    `/login?error=${encodeURIComponent(msg)}${dest !== "/panel" ? `&next=${encodeURIComponent(dest)}` : ""}`;
  if (!parsed.success) redirect(loginUrl("Completa email/móvil y contraseña"));
  const id = normalizeIdentifier(parsed.data.identifier);
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: id }, { phone: id }] },
  });
  if (!user || !user.active || !user.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    redirect(loginUrl("Credenciales incorrectas"));
  }
  await createSession(user.id);
  redirect(dest);
}

export async function logoutAction() {
  const user = await getSessionUser();
  if (user) await releaseAllBy(user.id); // el reparto automático libera los casos abiertos
  await destroySession();
  redirect("/");
}

// Activación de cuenta por invitación (Flujo B) — enlace válido 72 h.
export async function activateAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8)
    redirect(`/activar?token=${encodeURIComponent(token)}&error=` + encodeURIComponent("La contraseña debe tener al menos 8 caracteres"));
  const uid = await verifyInviteToken(token);
  if (!uid) redirect("/login?error=" + encodeURIComponent("Enlace de invitación caducado o no válido"));
  await prisma.user.update({
    where: { id: uid! },
    data: { passwordHash: await hashPassword(password), activatedAt: new Date() },
  });
  await createSession(uid!);
  redirect("/panel");
}

// Mayoría de edad (16 años): el paciente toma el control de su cuenta. Crea su
// propio usuario con el email y móvil que confirma, se lleva al paciente (y sus
// casos) y el titular anterior deja de tener acceso.
export async function handoverAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const back = (msg: string): never =>
    redirect(`/mayoria?token=${encodeURIComponent(token)}&error=` + encodeURIComponent(msg));
  const pid = await verifyHandoverToken(token);
  if (!pid) redirect("/mayoria?error=" + encodeURIComponent("El enlace no es válido o ha caducado"));
  const patient = await prisma.patient.findUnique({ where: { id: pid! }, include: { owner: true } });
  if (!patient || !patient.isMinor || patient.handoverAt) back("Esta cuenta ya ha sido traspasada");
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const password = String(formData.get("password") ?? "");
  if (!email.includes("@")) back("Indica un email válido");
  if (!isValidPhone(phone)) back("Indica un móvil válido");
  if (password.length < 8) back("La contraseña debe tener al menos 8 caracteres");
  const p = patient!;
  if (email === p.owner.email || phone === p.owner.phone)
    back("Tu email y tu móvil deben ser distintos de los de quien gestionaba tu cuenta: serás la única persona con acceso");
  const dup = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (dup) back("Ya existe otra cuenta con ese email o móvil");
  const now = new Date();
  const user = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, phone, passwordHash: await hashPassword(password), role: "CLIENTE", name: p.name, activatedAt: now },
    });
    await tx.patient.update({
      where: { id: p.id },
      data: {
        ownerId: user.id,
        isMinor: false,
        email,
        phone,
        handoverAt: now,
        consents: {
          ...(p.consents as object),
          traspaso: { fecha: now.toISOString(), titularAnterior: p.owner.name },
        },
      },
    });
    return user;
  });
  const cases = await prisma.case.findMany({ where: { patientId: p.id }, select: { id: true } });
  for (const c of cases)
    await pushEvent(c.id, `Cuenta traspasada al paciente (mayoría de edad). ${p.owner.name} deja de tener acceso`, p.name);
  await notifyOwner(p.owner, p.consents, "cuenta_traspasada", { nombre: p.owner.name, paciente: p.name });
  await notifyEmail(email, "cuenta_activada", {
    nombre: p.name,
    nota: "Tu cuenta está activa. Ya eres la única persona con acceso a tu expediente.",
    enlace: "/panel",
  });
  await createSession(user.id);
  redirect("/panel?ok=" + encodeURIComponent("Tu cuenta es tuya: ya solo tú puedes acceder a tu tratamiento."));
}
