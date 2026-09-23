"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, destroySession, getSessionUser, hashPassword, verifyPassword, verifyInviteToken } from "@/lib/auth";
import { pushEvent, releaseAllBy } from "@/lib/cases";
import { CONSENT_VERSION, consentimientoFirmado, esMenor } from "@/lib/legal";

const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(1),
});

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/login?error=" + encodeURIComponent("Completa email/móvil y contraseña"));
  const id = parsed.data.identifier.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: id }, { phone: id }] },
  });
  if (!user || !user.active || !user.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    redirect("/login?error=" + encodeURIComponent("Credenciales incorrectas"));
  }
  await createSession(user.id);
  redirect("/panel");
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
  const user = await prisma.user.findUnique({ where: { id: uid! }, include: { patients: { include: { cases: true } } } });
  if (!user) redirect("/login?error=" + encodeURIComponent("Enlace de invitación caducado o no válido"));

  // Invitación de paciente (Flujo B): acepta ser atendido y firma los consentimientos.
  const pendientes = user!.role === "CLIENTE" ? user!.patients.filter((p) => !consentimientoFirmado(p.consents)) : [];
  const back = (msg: string) =>
    redirect(`/activar?token=${encodeURIComponent(token)}&error=` + encodeURIComponent(msg));
  if (pendientes.length) {
    if (formData.get("consentTratamiento") !== "on") back("Para empezar tienes que aceptar la invitación");
    if (formData.get("consentSalud") !== "on") back("El consentimiento de datos de salud (RGPD) es necesario");
    if (pendientes.some(esMenor) && formData.get("consentTutor") !== "on")
      back("Como el paciente es menor, tienes que declarar que eres su padre, madre o tutor legal");
  }

  const now = new Date();
  const firma = { fecha: now.toISOString(), version: CONSENT_VERSION, via: "invitacion" };
  const whatsapp = formData.get("consentWhatsApp") === "on";
  await prisma.$transaction([
    prisma.user.update({
      where: { id: uid! },
      data: { passwordHash: await hashPassword(password), activatedAt: now },
    }),
    ...pendientes.map((p) =>
      prisma.patient.update({
        where: { id: p.id },
        data: {
          consents: {
            tratamiento: { aceptado: true, ...firma },
            salud: { aceptado: true, ...firma },
            whatsapp: { aceptado: whatsapp, ...firma },
            ...(esMenor(p) ? { tutor: { aceptado: true, ...firma } } : {}),
          },
        },
      })
    ),
  ]);
  for (const p of pendientes)
    for (const c of p.cases)
      await pushEvent(c.id, "El paciente aceptó la invitación y firmó los consentimientos RGPD", user!.name);
  await createSession(uid!);
  redirect("/panel");
}
