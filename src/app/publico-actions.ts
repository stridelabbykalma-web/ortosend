"use server";

// Acciones de la web pública: reserva Flujo A con el calendario real de la
// clínica (visitante y cliente con sesión), lista de espera y solicitud de
// clínica. Integra el alta de cuenta con email de bienvenida/verificación y
// el tratamiento de menores (los gestiona su tutor hasta los 16).
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, getSessionUser, hashPassword } from "@/lib/auth";
import { notifyOwner, pushEvent } from "@/lib/cases";
import { bookAppointment } from "@/lib/agenda-db";
import { agendaErrorMessage, parseSlot, type SlotOk } from "@/lib/reserva-form";
import { fmtdt } from "@/lib/format";
import { isValidPhone, normalizeEmail, normalizePhone } from "@/lib/contacto";
import { EDAD_MAYORIA_SALUD, esMenor, parseBirth } from "@/lib/edad";
import { CONSENT_VERSION } from "@/lib/legal";
import { enviarBienvenida } from "@/lib/cuenta";

const reservaSchema = z.object({
  clinicId: z.string().min(1),
  name: z.string().min(3, "Falta el nombre"),
  phone: z.string().min(6, "Falta el móvil"),
  email: z.string().email("Email no válido"),
  birth: z.string().optional(),
  motivo: z.string().optional(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

// Visitante: alta de cuenta + paciente + caso + cita, todo en una transacción.
export async function reservaAction(formData: FormData) {
  const back = (msg: string): never =>
    redirect(`/reserva/${formData.get("clinicId")}?error=` + encodeURIComponent(msg));
  const slot = parseSlot(formData);
  if (!slot.ok) back(slot.error);
  const parsed = reservaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(parsed.error.issues[0].message);
  const d = parsed.data!;
  if (formData.get("consentSalud") !== "on") back("El consentimiento de datos de salud (RGPD) es necesario");

  const clinic = await prisma.clinic.findUnique({ where: { id: d.clinicId } });
  if (!clinic || clinic.status !== "ACTIVA" || !clinic.onlineBooking) back("Esta clínica no admite reservas online");

  const now = new Date();
  const email = normalizeEmail(d.email);
  const phone = normalizePhone(d.phone);
  if (!isValidPhone(phone)) back("Móvil no válido");
  const birth = parseBirth(d.birth);
  if (d.birth && !birth) back("Fecha de nacimiento no válida");
  if (birth && esMenor(birth, now))
    back(
      `Si el paciente tiene menos de ${EDAD_MAYORIA_SALUD} años, la reserva debe hacerla su padre, madre o tutor: crea tu cuenta con tus datos y reserva para «otra persona a mi cargo», o inicia sesión si ya la tienes`
    );
  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (existing) back("Ya existe una cuenta con ese email o móvil. Inicia sesión para reservar.");

  const consentWhatsApp = formData.get("consentWhatsApp") === "on";
  const consents = {
    salud: { aceptado: true, fecha: now.toISOString(), version: CONSENT_VERSION, via: "web" },
    whatsapp: { aceptado: consentWhatsApp, fecha: now.toISOString(), version: CONSENT_VERSION },
  };
  let result: { userId: string; caseId: string; startsAt: Date } | null = null;
  try {
    result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          phone,
          passwordHash: await hashPassword(d.password),
          role: "CLIENTE",
          name: d.name.trim(),
          activatedAt: now,
        },
      });
      const patient = await tx.patient.create({
        data: {
          ownerId: user.id,
          name: d.name.trim(),
          birthDate: birth,
          isMinor: false,
          consents,
        },
      });
      const kase = await tx.case.create({
        data: {
          patientId: patient.id,
          clinicId: d.clinicId,
          state: "CITA_RESERVADA",
          flow: "A",
          reason: (d.motivo ?? "").trim() || null,
        },
      });
      const appt = await bookAppointment(tx, {
        clinicId: d.clinicId,
        caseId: kase.id,
        startsAt: (slot as SlotOk).startsAt,
        professionalId: (slot as SlotOk).professionalId,
        kind: "ESTUDIO",
        source: "web",
        notes: d.motivo ? `Motivo indicado al reservar: ${d.motivo}` : null,
        mode: "online",
      });
      return { userId: user.id, caseId: kase.id, startsAt: appt.startsAt };
    });
  } catch (e) {
    back(agendaErrorMessage(e));
  }

  await pushEvent(result!.caseId, `Cita reservada online (Flujo A) — ${fmtdt(result!.startsAt)}${d.motivo ? ` · motivo: ${d.motivo}` : ""}`, d.name);
  const owner = { id: result!.userId, name: d.name.trim(), email, phone };
  await notifyOwner(owner, consents, "cita_confirmada", {
    caseId: result!.caseId,
    nombre: owner.name,
    clinica: clinic!.name,
    direccion: clinic!.address,
    fecha: result!.startsAt.toISOString(),
    fechaTexto: result!.startsAt.toLocaleString("es-ES", { dateStyle: "full", timeStyle: "short" }),
    enlace: "/panel",
    nota: "Trae tu calzado habitual. Reserva gratuita: solo pagarás si un profesional prescribe tu tratamiento.",
  });
  // Cuenta nueva: bienvenida con los datos de acceso y enlace para confirmar el email.
  await enviarBienvenida(owner);
  await createSession(result!.userId);
  redirect(
    "/panel?ok=" +
      encodeURIComponent(`Cita confirmada. Te hemos enviado los detalles por email${consentWhatsApp ? " y WhatsApp" : ""}.`)
  );
}

// Cliente con sesión: reserva para un paciente suyo (o da de alta a otro a su cargo).
export async function reservaClienteAction(formData: FormData) {
  const clinicId = String(formData.get("clinicId") ?? "");
  const back = (msg: string): never => redirect(`/reserva/${clinicId}?error=` + encodeURIComponent(msg));
  const user = await getSessionUser();
  if (!user || user.role !== "CLIENTE") redirect(`/login?next=/reserva/${clinicId}`);
  const slot = parseSlot(formData);
  if (!slot.ok) back(slot.error);
  if (formData.get("consentSalud") !== "on") back("El consentimiento de datos de salud (RGPD) es necesario");
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
  if (!clinic || clinic.status !== "ACTIVA" || !clinic.onlineBooking) back("Esta clínica no admite reservas online");

  const patientId = String(formData.get("patientId") ?? "");
  const now = new Date();
  let patient: { id: string; name: string } | null = null;
  if (patientId && patientId !== "nuevo") {
    patient = await prisma.patient.findFirst({ where: { id: patientId, ownerId: user!.id } });
    if (!patient) back("Paciente no válido");
  } else {
    const newName = String(formData.get("newName") ?? "").trim();
    if (newName.length < 3) back("Indica el nombre y apellidos del paciente");
    const newBirth = parseBirth(String(formData.get("newBirth") ?? ""));
    const menor = esMenor(newBirth, now);
    patient = await prisma.patient.create({
      data: {
        ownerId: user!.id,
        name: newName,
        birthDate: newBirth,
        isMinor: menor,
        consents: {
          salud: { aceptado: true, fecha: now.toISOString(), version: CONSENT_VERSION, via: "titular" },
          ...(menor ? { tutor: { declarado: true, fecha: now.toISOString(), version: CONSENT_VERSION } } : {}),
        },
      },
    });
  }
  // Un paciente no puede tener dos estudios abiertos a la vez.
  const abierto = await prisma.case.findFirst({
    where: { patientId: patient!.id, state: { in: ["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "ESTUDIO_COMPLETO", "EN_PRESCRIPCION", "EN_CONTACTO"] } },
  });
  if (abierto) back(`${patient!.name} ya tiene un estudio en marcha (caso #${abierto.number}). Cambia su cita desde el panel.`);

  let result: { caseId: string; startsAt: Date } | null = null;
  try {
    result = await prisma.$transaction(async (tx) => {
      const kase = await tx.case.create({
        data: { patientId: patient!.id, clinicId, state: "CITA_RESERVADA", flow: "A" },
      });
      const appt = await bookAppointment(tx, {
        clinicId,
        caseId: kase.id,
        startsAt: (slot as SlotOk).startsAt,
        professionalId: (slot as SlotOk).professionalId,
        kind: "ESTUDIO",
        source: "web",
        bookedBy: user!.id,
        mode: "online",
      });
      return { caseId: kase.id, startsAt: appt.startsAt };
    });
  } catch (e) {
    back(agendaErrorMessage(e));
  }
  await pushEvent(result!.caseId, `Cita reservada online desde la cuenta del cliente — ${fmtdt(result!.startsAt)}`, user!.name);
  await notifyOwner(user!, { whatsapp: { aceptado: true } }, "cita_confirmada", {
    caseId: result!.caseId,
    nombre: user!.name,
    paciente: patient!.name !== user!.name ? patient!.name : undefined,
    clinica: clinic!.name,
    direccion: clinic!.address,
    fecha: result!.startsAt.toISOString(),
    fechaTexto: result!.startsAt.toLocaleString("es-ES", { dateStyle: "full", timeStyle: "short" }),
    enlace: "/panel",
  });
  redirect("/panel?ok=" + encodeURIComponent(`Cita confirmada para ${patient!.name}: ${fmtdt(result!.startsAt)}`));
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
