"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, destroySession, getSessionUser, hashPassword, verifyPassword, verifyInviteToken } from "@/lib/auth";
import { releaseAllBy } from "@/lib/cases";

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
  await prisma.user.update({
    where: { id: uid! },
    data: { passwordHash: await hashPassword(password), activatedAt: new Date() },
  });
  await createSession(uid!);
  redirect("/panel");
}
