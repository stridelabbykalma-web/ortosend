"use server";

// Acciones de la web pública: reserva Flujo A, lista de espera y solicitud de clínica.
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { notify, pushEvent } from "@/lib/cases";

const reservaSchema = z.object({
  clinicId: z.string().min(1),
  slotId: z.string().min(1, "Elige una hora"),
  name: z.string().min(3, "Falta el nombre"),
  phone: z.string().min(6, "Falta el móvil"),
  email: z.string().email("Email no válido"),
  birth: z.string().optional(),
  motivo: z.string().optional(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

export async function reservaAction(formData: FormData) {
  const parsed = reservaSchema.safeParse(Object.fromEntries(formData));
  const back = (msg: string) =>
    redirect(`/reserva/${formData.get("clinicId")}?error=` + encodeURIComponent(msg));
  if (!parsed.success) back(parsed.error.issues[0].message);
  const d = parsed.data!;
  if (formData.get("consentSalud") !== "on") back("El consentimiento de datos de salud (RGPD) es necesario");

  const email = d.email.toLowerCase();
  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone: d.phone }] } });
  if (existing) back("Ya existe una cuenta con ese email o móvil. Inicia sesión para reservar.");

  // Reclama el slot de forma atómica (evita dobles reservas).
  const slot = await prisma.slot.findUnique({ where: { id: d.slotId } });
  if (!slot || slot.caseId || slot.clinicId !== d.clinicId) back("Esa hora ya no está disponible. Elige otra.");

  const consentWhatsApp = formData.get("consentWhatsApp") === "on";
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        phone: d.phone,
        passwordHash: await hashPassword(d.password),
        role: "CLIENTE",
        name: d.name,
        activatedAt: now,
      },
    });
    const patient = await tx.patient.create({
      data: {
        ownerId: user.id,
        name: d.name,
        birthDate: d.birth ? new Date(d.birth) : null,
        consents: {
          salud: { aceptado: true, fecha: now.toISOString(), version: "v1" },
          whatsapp: { aceptado: consentWhatsApp, fecha: now.toISOString(), version: "v1" },
        },
      },
    });
    const kase = await tx.case.create({
      data: {
        patientId: patient.id,
        clinicId: d.clinicId,
        state: "CITA_RESERVADA",
        flow: "A",
        appointmentAt: slot!.startsAt,
      },
    });
    const claimed = await tx.slot.updateMany({
      where: { id: d.slotId, caseId: null },
      data: { caseId: kase.id },
    });
    if (claimed.count === 0) throw new Error("SLOT_TAKEN");
    return { user, kase };
  }).catch((e) => {
    if (e instanceof Error && e.message === "SLOT_TAKEN") return null;
    throw e;
  });
  if (!result) back("Esa hora acaba de ser reservada por otra persona. Elige otra.");

  const clinic = await prisma.clinic.findUnique({ where: { id: d.clinicId } });
  await pushEvent(result!.kase.id, `Cita reservada online (Flujo A) — ${slot!.startsAt.toLocaleString("es-ES")}`, d.name);
  await notify(d.phone, "cita_confirmada", {
    clinica: clinic?.name,
    fecha: slot!.startsAt.toISOString(),
    nota: "Trae tu calzado habitual. Reserva gratuita: solo pagarás si un profesional prescribe tu tratamiento.",
  });
  await createSession(result!.user.id);
  redirect("/panel?ok=" + encodeURIComponent("Cita confirmada. Te hemos enviado los detalles por WhatsApp."));
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
