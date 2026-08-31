"use server";

// Acciones del panel de clínica: disponibilidad, Flujo B y asistente de captura.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole, createInviteToken } from "@/lib/auth";
import { checklistOf, notify, pushEvent } from "@/lib/cases";
import { VIDEO_KINDS, BARO_KINDS } from "@/lib/format";
import type { Questionnaire } from "@/lib/questionnaire";
import type { User } from "@prisma/client";

const MAX_SLOTS = 5;

function fail(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=` + encodeURIComponent(msg));
}

async function requireClinicStaff(): Promise<User & { clinicId: string }> {
  const u = await requireRole("PROFESIONAL", "ADMIN_CLINICA");
  if (!u.clinicId) throw new Error("Usuario sin clínica asignada");
  return u as User & { clinicId: string };
}

// --- Disponibilidad (huecos web, máx. 5 activos) ---
export async function addSlotAction(formData: FormData) {
  const u = await requireClinicStaff();
  const back = "/panel?tab=disp";
  const startsAt = String(formData.get("startsAt") ?? "");
  if (!startsAt) fail(back, "Indica fecha y hora");
  const when = new Date(startsAt);
  if (isNaN(+when) || when < new Date()) fail(back, "La fecha debe ser futura");
  const active = await prisma.slot.count({
    where: { clinicId: u.clinicId, caseId: null, startsAt: { gt: new Date() } },
  });
  if (active >= MAX_SLOTS) fail(back, `Máximo ${MAX_SLOTS} huecos activos publicados`);
  await prisma.slot.create({ data: { clinicId: u.clinicId, startsAt: when } });
  redirect(back);
}

export async function delSlotAction(formData: FormData) {
  const u = await requireClinicStaff();
  const id = String(formData.get("slotId"));
  await prisma.slot.deleteMany({ where: { id, clinicId: u.clinicId, caseId: null } });
  redirect("/panel?tab=disp");
}

// --- Flujo B: caso iniciado en clínica + invitación de cuenta (72 h) ---
export async function newCaseBAction(formData: FormData) {
  const u = await requireClinicStaff();
  const back = "/panel?tab=agenda";
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  const birth = String(formData.get("birth") ?? "");
  if (!name || !phone) fail(back, "Nombre y móvil del paciente son obligatorios");
  const dup = await prisma.user.findFirst({
    where: { OR: [{ phone }, ...(email ? [{ email }] : [])] },
  });
  if (dup) fail(back, "Ya existe una cuenta con ese móvil o email");
  const now = new Date();
  const { kase, owner } = await prisma.$transaction(async (tx) => {
    const owner = await tx.user.create({
      data: { email, phone, role: "CLIENTE", name, invitedAt: now },
    });
    const patient = await tx.patient.create({
      data: {
        ownerId: owner.id,
        name,
        birthDate: birth ? new Date(birth) : null,
        // Consentimiento recogido en papel/tablet en la clínica; queda versionado.
        consents: { salud: { aceptado: true, fecha: now.toISOString(), version: "v1", via: "clinica" } },
      },
    });
    const kase = await tx.case.create({
      data: { patientId: patient.id, clinicId: u.clinicId, state: "ESTUDIO_EN_CURSO", flow: "B" },
    });
    await tx.capture.create({ data: { caseId: kase.id } });
    return { kase, owner };
  });
  const token = await createInviteToken(owner.id);
  await pushEvent(kase.id, `Caso creado en clínica (Flujo B) por ${u.name}`, u.name);
  await notify(phone, "invitacion_cuenta", {
    enlace: `/activar?token=${token}`,
    validez: "72 h",
    clinica: u.clinicId,
  });
  redirect(`/caso/${kase.id}`);
}

// --- Asistente de captura (guardado continuo) ---
async function captureFor(caseId: string, u: User) {
  const kase = await prisma.case.findUnique({ where: { id: caseId }, include: { capture: true, patient: true } });
  if (!kase || kase.clinicId !== u.clinicId) throw new Error("Caso no accesible");
  if (!["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"].includes(kase.state))
    throw new Error("El estudio no está en curso");
  const capture =
    kase.capture ?? (await prisma.capture.create({ data: { caseId } }));
  if (kase.state === "CITA_RESERVADA") {
    await prisma.case.update({ where: { id: caseId }, data: { state: "ESTUDIO_EN_CURSO" } });
    await pushEvent(caseId, "Estudio iniciado en clínica", u.name);
  }
  return { kase, capture };
}

export async function saveQuestionnaireAction(formData: FormData) {
  const u = await requireClinicStaff();
  const caseId = String(formData.get("caseId"));
  const back = `/caso/${caseId}`;
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const list = (k: string) => formData.getAll(k).map((v) => String(v).trim()).filter(Boolean);

  const motivo = str("motivo");
  if (!motivo) fail(back, "Falta el motivo de consulta");
  const dolor = str("dolor");
  if (dolor === "") fail(back, "Indica la intensidad del dolor (0-10)");
  const lado = str("lado");
  if (lado !== "Sin dolor localizado" && list("zonas").length === 0)
    fail(back, "Marca al menos una zona de dolor (o elige «Sin dolor localizado»)");

  const questionnaire: Questionnaire = {
    v: 2,
    motivo,
    evolucion: str("evolucion"),
    lado,
    zonas: list("zonas"),
    dolor,
    momentos: list("momentos"),
    actividad: str("actividad"),
    deporte: str("deporte"),
    horasPie: str("horasPie"),
    profesion: str("profesion"),
    peso: str("peso"),
    altura: str("altura"),
    tallaCalzado: str("tallaCalzado"),
    calzado: list("calzado"),
    desgaste: str("desgaste"),
    plantillasPrevias: str("plantillasPrevias"),
    antecedentes: list("antecedentes"),
    antecedentesDetalle: str("antecedentesDetalle"),
    medicacion: str("medicacion"),
    tratamientosPrevios: list("tratamientosPrevios"),
    observaciones: str("observaciones"),
  };
  const { capture } = await captureFor(caseId, u);
  await prisma.capture.update({
    where: { id: capture.id },
    data: { questionnaire },
  });
  redirect(back);
}

export async function saveExamAction(formData: FormData) {
  const u = await requireClinicStaff();
  const caseId = String(formData.get("caseId"));
  const { capture } = await captureFor(caseId, u);
  await prisma.capture.update({
    where: { id: capture.id },
    data: {
      physicalExam: {
        tobillo: String(formData.get("tobillo") ?? ""),
        hallux: String(formData.get("hallux") ?? ""),
        dismetria: String(formData.get("dismetria") ?? ""),
        alza: String(formData.get("alza") ?? "").trim() || "No",
      },
    },
  });
  redirect(`/caso/${caseId}`);
}

// Marca un elemento de captura como subido y CONFIRMADO por el servidor.
// (En producción: subida por fragmentos a R2/S3 y confirmación real del servidor.)
export async function markMediaAction(formData: FormData) {
  const u = await requireClinicStaff();
  const caseId = String(formData.get("caseId"));
  const kind = String(formData.get("kind"));
  const valid = ["scan_L", "scan_R", ...VIDEO_KINDS.map(([k]) => k), ...BARO_KINDS.map(([k]) => k)];
  if (!valid.includes(kind)) fail(`/caso/${caseId}`, "Elemento de captura desconocido");
  const { capture } = await captureFor(caseId, u);
  const exists = await prisma.mediaAsset.findFirst({ where: { captureId: capture.id, kind } });
  if (!exists) {
    await prisma.mediaAsset.create({
      data: {
        captureId: capture.id,
        kind,
        url: `media/${caseId}/${kind}`,
        confirmedAt: new Date(), // check verde SOLO con confirmación del servidor
      },
    });
  }
  redirect(`/caso/${caseId}`);
}

// Envío del estudio: checklist bloqueante → ESTUDIO_COMPLETO → EN_PRESCRIPCION.
export async function sendCaseAction(formData: FormData) {
  const u = await requireClinicStaff();
  const caseId = String(formData.get("caseId"));
  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    include: { capture: { include: { media: true } }, patient: true, clinic: true },
  });
  if (!kase || kase.clinicId !== u.clinicId) fail("/panel", "Caso no accesible");
  const fromRepeat = kase!.state === "DEVUELTO_CLINICA";
  if (!["ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"].includes(kase!.state))
    fail(`/caso/${caseId}`, "El estudio no está en curso");
  const cl = checklistOf(kase!.capture);
  if (!cl.completa) fail(`/caso/${caseId}`, "La checklist del protocolo debe estar completa (todo en verde)");
  await prisma.capture.update({ where: { caseId }, data: { completedAt: new Date() } });
  await prisma.case.update({ where: { id: caseId }, data: { state: "EN_PRESCRIPCION" } });
  const central = !kase!.clinic.hasPrescriber;
  await pushEvent(
    caseId,
    fromRepeat
      ? "Prueba repetida y reenviada a prescripción"
      : `Estudio completo. Enviado a ${central ? "cola central Ortosend" : "prescriptor de la clínica"}`,
    u.name
  );
  if (kase!.patient) {
    const owner = await prisma.user.findUnique({ where: { id: kase!.patient.ownerId } });
    if (owner?.phone)
      await notify(owner.phone, "estudio_completo", {
        nota: "Tu estudio está completo y en valoración. Te avisaremos en un máximo de 48 h laborables.",
      });
  }
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase!.number} enviado a prescripción`));
}
