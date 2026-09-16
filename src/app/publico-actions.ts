"use server";

// Acciones de la web pública: reserva Flujo A, lista de espera y solicitud de clínica.
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, getSessionUser, hashPassword } from "@/lib/auth";
import { notifyOwner, pushEvent } from "@/lib/cases";
import { isValidPhone, normalizeEmail, normalizePhone } from "@/lib/contacto";
import { EDAD_MAYORIA_SALUD, esMenor, parseBirth } from "@/lib/edad";
import { CONSENT_VERSION } from "@/lib/legal";
import { HOLD_COOKIE, HOLD_MINUTES } from "@/lib/reserva";

const reservaSchema = z.object({
  clinicId: z.string().min(1),
  slotId: z.string().min(1, "Elige una hora"),
  modo: z.enum(["nuevo", "cuenta"]),
  motivo: z.string().optional(),
  // Visitante: crea su cuenta
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  birth: z.string().optional(),
  password: z.string().optional(),
  // Cliente con sesión: para quién es la cita
  patientId: z.string().optional(),
  // Menor a cargo (en ambos modos)
  menorNombre: z.string().optional(),
  menorNacimiento: z.string().optional(),
  menorEmail: z.string().optional(),
  menorMovil: z.string().optional(),
});

// Bloquea un hueco 15 min para este navegador mientras rellena la reserva.
// Devuelve si se ha conseguido y hasta qué hora.
export async function holdSlotAction(slotId: string): Promise<{ ok: boolean; until?: string }> {
  const jar = await cookies();
  let key = jar.get(HOLD_COOKIE)?.value;
  if (!key) {
    key = randomBytes(16).toString("hex");
    jar.set(HOLD_COOKIE, key, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
  }
  const now = new Date();
  const until = new Date(now.getTime() + HOLD_MINUTES * 60 * 1000);
  // Libera cualquier otro hueco que tuviera este navegador.
  await prisma.slot.updateMany({ where: { holdKey: key, id: { not: slotId } }, data: { holdUntil: null, holdKey: null } });
  const r = await prisma.slot.updateMany({
    where: {
      id: slotId,
      caseId: null,
      startsAt: { gt: now },
      OR: [{ holdUntil: null }, { holdUntil: { lt: now } }, { holdKey: key }],
    },
    data: { holdUntil: until, holdKey: key },
  });
  return r.count
    ? { ok: true, until: until.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) }
    : { ok: false };
}

export async function reservaAction(formData: FormData) {
  const parsed = reservaSchema.safeParse(Object.fromEntries(formData));
  const back = (msg: string): never =>
    redirect(`/reserva/${formData.get("clinicId")}?error=` + encodeURIComponent(msg));
  if (!parsed.success) back(parsed.error.issues[0].message);
  const d = parsed.data!;
  const now = new Date();
  const motivo = (d.motivo ?? "").trim() || null;

  // --- Quién reserva: titular nuevo (visitante) o cliente con sesión ---
  const sessionUser = await getSessionUser();
  let titular: { id: string; name: string; email: string | null; phone: string | null } | null = null;
  let nuevoTitular: { name: string; email: string; phone: string; birth: Date | null; password: string } | null = null;
  if (d.modo === "cuenta") {
    if (!sessionUser || sessionUser.role !== "CLIENTE") back("Inicia sesión con tu cuenta de cliente para reservar");
    titular = sessionUser!;
  } else {
    if (sessionUser?.role === "CLIENTE") back("Ya tienes sesión iniciada: recarga la página para reservar con tu cuenta");
    const name = (d.name ?? "").trim();
    const email = normalizeEmail(d.email);
    const phone = normalizePhone(d.phone);
    if (name.length < 3) back("Falta el nombre");
    if (!z.string().email().safeParse(email).success) back("Email no válido");
    if (!isValidPhone(phone)) back("Móvil no válido");
    if ((d.password ?? "").length < 8) back("La contraseña debe tener al menos 8 caracteres");
    const birth = parseBirth(d.birth);
    if (d.birth && !birth) back("Fecha de nacimiento no válida");
    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
    if (existing) back("Ya existe una cuenta con ese email o móvil. Inicia sesión para reservar.");
    nuevoTitular = { name, email, phone, birth, password: d.password! };
  }

  // --- Para quién es la cita: el propio titular, un menor ya registrado o uno nuevo ---
  const paraMenor = d.modo === "cuenta" ? d.patientId === "nuevo" : formData.get("paraMenor") === "on";
  let menor: { name: string; birth: Date; email: string | null; phone: string | null } | null = null;
  if (paraMenor) {
    const name = (d.menorNombre ?? "").trim();
    const birth = parseBirth(d.menorNacimiento);
    if (name.length < 3) back("Falta el nombre del menor");
    if (!birth) back("Falta la fecha de nacimiento del menor");
    if (!esMenor(birth!, now))
      back(`A partir de los ${EDAD_MAYORIA_SALUD} años el paciente reserva con su propia cuenta y sus propios datos`);
    const email = normalizeEmail(d.menorEmail) || null;
    const phone = normalizePhone(d.menorMovil) || null;
    if (email && !z.string().email().safeParse(email).success) back("El email del menor no es válido");
    if (phone && !isValidPhone(phone)) back("El móvil del menor no es válido");
    const emailTitular = titular?.email ?? nuevoTitular?.email ?? null;
    if (email && emailTitular && email === emailTitular)
      back("El email del menor debe ser distinto del tuyo: es donde recibirá el aviso para gestionar su cuenta");
    menor = { name, birth: birth!, email, phone };
  } else if (nuevoTitular?.birth && esMenor(nuevoTitular.birth, now)) {
    back(
      `Si tienes menos de ${EDAD_MAYORIA_SALUD} años, la reserva debe hacerla tu padre, madre o tutor con sus datos marcando «Reservo para un menor»`
    );
  }
  let patientExistente: { id: string; name: string; consents: unknown } | null = null;
  if (d.modo === "cuenta" && !paraMenor) {
    const p = await prisma.patient.findFirst({ where: { id: d.patientId ?? "", ownerId: titular!.id } });
    if (!p) back("Elige para quién es la cita");
    patientExistente = p;
  }
  const necesitaConsentimiento = !patientExistente;
  if (necesitaConsentimiento && formData.get("consentSalud") !== "on")
    back("El consentimiento de datos de salud (RGPD) es necesario");
  const consentWhatsApp = formData.get("consentWhatsApp") === "on";

  // --- Reclama el slot de forma atómica (respetando el bloqueo de 15 min) ---
  const holdKey = (await cookies()).get(HOLD_COOKIE)?.value ?? null;
  const slot = await prisma.slot.findUnique({ where: { id: d.slotId } });
  if (!slot || slot.caseId || slot.clinicId !== d.clinicId || slot.startsAt < now)
    back("Esa hora ya no está disponible. Elige otra.");
  const consents = {
    salud: { aceptado: true, fecha: now.toISOString(), version: CONSENT_VERSION, via: "web" },
    whatsapp: { aceptado: consentWhatsApp, fecha: now.toISOString(), version: CONSENT_VERSION },
    ...(menor ? { tutor: { declarado: true, fecha: now.toISOString(), version: CONSENT_VERSION } } : {}),
  };
  const result = await prisma
    .$transaction(async (tx) => {
      const owner = titular
        ? titular
        : await tx.user.create({
            data: {
              email: nuevoTitular!.email,
              phone: nuevoTitular!.phone,
              passwordHash: await hashPassword(nuevoTitular!.password),
              role: "CLIENTE",
              name: nuevoTitular!.name,
              activatedAt: now,
            },
          });
      const patient =
        patientExistente ??
        (await tx.patient.create({
          data: menor
            ? {
                ownerId: owner.id,
                name: menor.name,
                birthDate: menor.birth,
                isMinor: true,
                email: menor.email,
                phone: menor.phone,
                consents,
              }
            : {
                ownerId: owner.id,
                name: nuevoTitular!.name,
                birthDate: nuevoTitular!.birth,
                isMinor: false,
                consents,
              },
        }));
      const kase = await tx.case.create({
        data: {
          patientId: patient.id,
          clinicId: d.clinicId,
          state: "CITA_RESERVADA",
          flow: "A",
          appointmentAt: slot!.startsAt,
          reason: motivo,
        },
      });
      const claimed = await tx.slot.updateMany({
        where: {
          id: d.slotId,
          caseId: null,
          OR: [{ holdUntil: null }, { holdUntil: { lt: now } }, ...(holdKey ? [{ holdKey }] : [])],
        },
        data: { caseId: kase.id, holdUntil: null, holdKey: null },
      });
      if (claimed.count === 0) throw new Error("SLOT_TAKEN");
      return { owner, patient, kase };
    })
    .catch((e) => {
      if (e instanceof Error && e.message === "SLOT_TAKEN") return null;
      throw e;
    });
  if (!result) back("Esa hora acaba de ser reservada por otra persona. Elige otra.");
  const { owner, patient, kase } = result!;

  const clinic = await prisma.clinic.findUnique({ where: { id: d.clinicId } });
  const fechaTexto = slot!.startsAt.toLocaleString("es-ES", { dateStyle: "full", timeStyle: "short" });
  await pushEvent(
    kase.id,
    `Cita reservada online (Flujo A) — ${fechaTexto}${motivo ? ` · motivo: ${motivo}` : ""}${
      patient.id !== patientExistente?.id && menor ? ` · menor a cargo de ${owner.name}` : ""
    }`,
    owner.name
  );
  await notifyOwner(owner, patientExistente?.consents ?? consents, "cita_confirmada", {
    caseId: kase.id,
    nombre: owner.name,
    paciente: patient.name !== owner.name ? patient.name : undefined,
    clinica: clinic?.name,
    direccion: clinic?.address,
    fecha: slot!.startsAt.toISOString(),
    fechaTexto,
    enlace: "/panel",
    nota: "Trae tu calzado habitual. Reserva gratuita: solo pagarás si un profesional prescribe tu tratamiento.",
  });
  if (!titular) await createSession(owner.id);
  redirect(
    "/panel?ok=" +
      encodeURIComponent(
        `Cita confirmada${patient.name !== owner.name ? ` para ${patient.name}` : ""}. Te hemos enviado los detalles por email${
          consentWhatsApp ? " y WhatsApp" : ""
        }.`
      )
  );
}

const appSchema = z.object({
  name: z.string().min(2, "Falta el nombre de la clínica"),
  town: z.string().min(2, "Falta la población"),
  contact: z.string().min(3, "Falta la persona de contacto"),
  hasPrescriber: z.enum(["si", "no"]),
  notes: z.string().optional(),
});

export async function solicitudClinicaAction(formData: FormData) {
  const parsed = appSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    redirect("/para-clinicas?error=" + encodeURIComponent(parsed.error.issues[0].message));
  const d = parsed.data!;
  await prisma.clinicApplication.create({
    data: {
      name: d.name,
      town: d.town,
      contact: d.contact,
      hasPrescriber: d.hasPrescriber === "si",
      notes: d.notes || null,
    },
  });
  redirect("/para-clinicas?ok=" + encodeURIComponent("Solicitud recibida. Nuestro equipo la revisará y te contactará."));
}
