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
  verifyResetToken,
} from "@/lib/auth";
import { audit, notifyEmail, notifyOwner, pushEvent, releaseAllBy, titularDe } from "@/lib/cases";
import { isValidPhone, normalizeEmail, normalizeIdentifier, normalizePhone } from "@/lib/contacto";
import { avisarContrasenaCambiada, enviarBienvenida, enviarRecuperacion, enviarVerificacionEmail } from "@/lib/cuenta";
import { claveCuenta, claveIp, limitar, origenPeticion } from "@/lib/rate-limit";
import { destinoSeguro } from "@/lib/navegacion";
import { CONSENT_VERSION } from "@/lib/legal";
import { pareceBot } from "@/lib/antibot";

const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(1),
});

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  // Ámbito de la entrada: la web pública (/login) es solo para pacientes y
  // /equipo es solo para el personal (clínicas, taller, administración).
  const ambito = formData.get("ambito") === "equipo" ? "equipo" : "cliente";
  const base = ambito === "equipo" ? "/equipo" : "/login";
  const next = String(formData.get("next") ?? "");
  // Solo rutas internas: "//" y "/\" son redirecciones a otros dominios.
  const dest = /^\/(?![\/\\])/.test(next) ? next : "/panel";
  const loginUrl = (msg: string) =>
    `${base}?error=${encodeURIComponent(msg)}${dest !== "/panel" ? `&next=${encodeURIComponent(dest)}` : ""}`;
  if (!parsed.success) redirect(loginUrl("Completa email/móvil y contraseña"));
  // Freno a la fuerza bruta: 10 intentos por minuto y IP.
  const origen = await origenPeticion();
  if (!origen.sinPeticion && !(await limitar(claveIp("login", origen.ip), 10, 60)))
    redirect(loginUrl("Demasiados intentos. Espera un minuto."));
  const id = normalizeIdentifier(parsed.data.identifier.slice(0, 200));
  // Y por cuenta: 20 intentos cada 15 minutos aunque vengan de muchas IP.
  if (!origen.sinPeticion && !(await limitar(claveCuenta("login-cuenta", id), 20, 900)))
    redirect(loginUrl("Demasiados intentos con esta cuenta. Espera 15 minutos o recupera la contraseña."));
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: id }, { phone: id }] },
  });
  if (!user || !user.active || !user.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    redirect(loginUrl("Credenciales incorrectas"));
  }
  if (ambito === "cliente" && user!.role !== "CLIENTE") {
    redirect("/equipo?ok=" + encodeURIComponent("Tu cuenta es del equipo: esta es tu entrada. Vuelve a escribir tus credenciales."));
  }
  if (ambito === "equipo" && user!.role === "CLIENTE") {
    redirect("/login?error=" + encodeURIComponent("Esa cuenta es de paciente: entra desde la web de Ortosend."));
  }
  await createSession(user!.id);
  // Continuidad del estudio: si el profesional entra desde otro dispositivo
  // (p. ej. el móvil) mientras tiene un estudio activo en el PC (latido en los
  // últimos 30 min), se le lleva directo a ese caso y a ese mismo paso.
  if (dest === "/panel" && (user!.role === "PROFESIONAL" || user!.role === "ADMIN_CLINICA")) {
    const activa = await prisma.studySession.findFirst({
      where: {
        userId: user!.id,
        lastSeenAt: { gt: new Date(Date.now() - 30 * 60 * 1000) },
        case: { state: { in: ["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"] } },
      },
      orderBy: { lastSeenAt: "desc" },
    });
    if (activa)
      redirect(
        `/caso/${activa.caseId}${activa.paso > 0 ? `?paso=${activa.paso}&` : "?"}ok=` +
          encodeURIComponent("Continuando el estudio que tenías abierto en el otro dispositivo")
      );
  }
  redirect(dest);
}

export async function logoutAction() {
  const user = await getSessionUser();
  if (user) {
    await releaseAllBy(user.id); // el reparto automático libera los casos abiertos
    // Cerrar sesión invalida el token en TODOS los dispositivos (sessionEpoch):
    // borrar la cookie no basta si alguien se la llevó de un equipo compartido.
    await prisma.user.update({ where: { id: user.id }, data: { sessionEpoch: { increment: 1 } } });
  }
  await destroySession();
  redirect("/");
}

// Activación de cuenta por invitación (Flujo B) — enlace válido 72 h. El
// paciente (o su tutor) confirma email y móvil, crea su contraseña y, si es
// cliente, ratifica online los consentimientos recogidos en la clínica.
export async function activateAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const back = (msg: string): never =>
    redirect(`/activar?token=${encodeURIComponent(token)}&error=` + encodeURIComponent(msg));
  const uid = await verifyInviteToken(token);
  const user = uid ? await prisma.user.findUnique({ where: { id: uid } }) : null;
  if (!user) redirect("/login?error=" + encodeURIComponent("Enlace de invitación caducado o no válido"));
  if (user!.activatedAt) redirect("/login?error=" + encodeURIComponent("Esta cuenta ya está activada: entra con tu contraseña"));
  const u = user!;
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const password = String(formData.get("password") ?? "");
  if (!email.includes("@")) back("Indica un email válido");
  if (!isValidPhone(phone)) back("Indica un móvil válido");
  if (password.length < 8) back("La contraseña debe tener al menos 8 caracteres");
  const esCliente = u.role === "CLIENTE";
  if (esCliente && formData.get("consentSalud") !== "on") back("Debes confirmar el consentimiento de datos de salud");
  const consentWhatsApp = formData.get("consentWhatsApp") === "on";
  const dup = await prisma.user.findFirst({ where: { id: { not: u.id }, OR: [{ email }, { phone }] } });
  if (dup) back("Ya existe otra cuenta con ese email o móvil");
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: u.id },
      data: {
        email,
        phone,
        passwordHash: await hashPassword(password),
        activatedAt: now,
        emailVerifiedAt: null,
      },
    });
    if (esCliente) {
      // Ratificación online de lo firmado en clínica, con la versión vigente.
      const patients = await tx.patient.findMany({ where: { ownerId: u.id } });
      for (const p of patients) {
        const prev = (p.consents ?? {}) as Record<string, unknown>;
        await tx.patient.update({
          where: { id: p.id },
          data: {
            consents: {
              ...prev,
              salud: { aceptado: true, fecha: now.toISOString(), version: CONSENT_VERSION, via: "activacion" },
              whatsapp: { aceptado: consentWhatsApp, fecha: now.toISOString(), version: CONSENT_VERSION, via: "activacion" },
            },
          },
        });
      }
    }
    return updated;
  });
  if (esCliente) {
    const cases = await prisma.case.findMany({ where: { patient: { ownerId: u.id } }, select: { id: true } });
    for (const c of cases) await pushEvent(c.id, `Cuenta activada por ${u.name} (datos y consentimientos confirmados)`, u.name);
  }
  await audit(u.id, "account.activate", `user:${u.id}`);
  await enviarBienvenida(updated);
  await createSession(u.id);
  redirect("/panel?ok=" + encodeURIComponent("Cuenta activada. Te hemos enviado un email para confirmar tu dirección."));
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
  const anterior = titularDe(p);
  if (email === anterior.email || phone === anterior.phone)
    back("Tu email y tu móvil deben ser distintos de los de quien gestionaba tu cuenta: serás la única persona con acceso");
  const dup = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (dup) back("Ya existe otra cuenta con ese email o móvil");
  const now = new Date();
  const user = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        phone,
        passwordHash: await hashPassword(password),
        role: "CLIENTE",
        name: p.name,
        activatedAt: now,
        // El enlace llegó a p.email: si lo mantiene, ya está confirmado.
        emailVerifiedAt: email === p.email ? now : null,
      },
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
          traspaso: { fecha: now.toISOString(), titularAnterior: anterior.name },
        },
      },
    });
    return user;
  });
  const cases = await prisma.case.findMany({ where: { patientId: p.id }, select: { id: true } });
  for (const c of cases)
    await pushEvent(c.id, `Cuenta traspasada al paciente (mayoría de edad). ${anterior.name} deja de tener acceso`, p.name);
  await notifyOwner(anterior, p.consents, "cuenta_traspasada", { nombre: anterior.name, paciente: p.name });
  await notifyEmail(email, "cuenta_activada", {
    nombre: p.name,
    nota: "Tu cuenta está activa. Ya eres la única persona con acceso a tu expediente.",
    enlace: "/panel",
  });
  if (!user.emailVerifiedAt) await enviarVerificacionEmail(user);
  await createSession(user.id);
  redirect("/panel?ok=" + encodeURIComponent("Tu cuenta es tuya: ya solo tú puedes acceder a tu tratamiento."));
}

// --- Recuperación de contraseña (Flujo A) ---
// Siempre responde lo mismo, exista o no la cuenta, para no revelar quién está registrado.
export async function recoverAction(formData: FormData) {
  // Freno al spam de emails de recuperación: 5 por 10 minutos y IP.
  const origen = await origenPeticion();
  if (!origen.sinPeticion && !(await limitar(claveIp("recuperar", origen.ip), 5, 600)))
    redirect("/recuperar?error=" + encodeURIComponent("Demasiadas peticiones. Espera unos minutos."));
  const bot = await pareceBot(formData);
  if (bot) redirect("/recuperar?error=" + encodeURIComponent(bot));
  const id = normalizeIdentifier(String(formData.get("identifier") ?? "").slice(0, 200));
  // Como mucho 3 emails de recuperación por hora a una misma cuenta (sin decir si existe).
  if (id.length >= 3 && (origen.sinPeticion || (await limitar(claveCuenta("recuperar-cuenta", id), 3, 3600)))) {
    const user = await prisma.user.findFirst({ where: { OR: [{ email: id }, { phone: id }] } });
    if (user && user.active && user.email) await enviarRecuperacion(user);
  }
  redirect(
    "/recuperar?ok=" +
      encodeURIComponent(
        "Si esa cuenta existe y tiene email, en unos minutos recibirás un enlace para crear una contraseña nueva (válido 1 hora)."
      )
  );
}

export async function resetPasswordAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const again = String(formData.get("password2") ?? "");
  const back = (msg: string): never =>
    redirect(`/restablecer?token=${encodeURIComponent(token)}&error=` + encodeURIComponent(msg));
  const user = await verifyResetToken(token);
  if (!user) redirect("/recuperar?error=" + encodeURIComponent("El enlace no es válido, ya se ha usado o ha caducado. Pide uno nuevo."));
  if (password.length < 8) back("La contraseña debe tener al menos 8 caracteres");
  if (password !== again) back("Las dos contraseñas no coinciden");
  const updated = await prisma.user.update({
    where: { id: user!.id },
    data: { passwordHash: await hashPassword(password), activatedAt: user!.activatedAt ?? new Date() },
  });
  await audit(user!.id, "password.reset", `user:${user!.id}`);
  await avisarContrasenaCambiada(updated);
  await releaseAllBy(user!.id);
  await createSession(user!.id);
  redirect("/panel?ok=" + encodeURIComponent("Contraseña cambiada. Ya has iniciado sesión."));
}

// Reenvío del enlace de confirmación del email desde el panel.
export async function resendVerificationAction() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user!.emailVerifiedAt) redirect("/panel");
  await enviarVerificacionEmail(user!);
  redirect("/panel?ok=" + encodeURIComponent(`Te hemos reenviado el enlace de confirmación a ${user!.email}`));
}
