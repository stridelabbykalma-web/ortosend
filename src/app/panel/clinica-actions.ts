"use server";

// Acciones del panel de clínica: disponibilidad, Flujo B y asistente de captura.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole, createInviteToken } from "@/lib/auth";
import { checklistOf, notify, pushEvent } from "@/lib/cases";
import { BARO_KINDS, SCAN_KIND } from "@/lib/format";
import type { Questionnaire } from "@/lib/questionnaire";
import type { Exam } from "@/lib/exploracion";
import { nucleoCompleto, ramasSinCubrir } from "@/lib/tests-podologicos";
import type { User } from "@prisma/client";

const MAX_SLOTS = 5;

// Nombre seguro para rutas de archivo a partir del nombre del paciente.
function slugify(t: string) {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

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

// --- Guardado por secciones del modo guiado (una pantalla = una sección) ---
// Cada sección hace merge sobre el JSON existente; el bloque se marca done al
// guardar su última sección. Así el estudio puede continuarse desde cualquier
// dispositivo por la pantalla en la que se quedó.

const Q_FIELDS: Record<string, { strs: (keyof Questionnaire)[]; lists: (keyof Questionnaire)[]; last?: boolean }> = {
  motivo: { strs: ["motivo", "evolucion", "dolor", "lado"], lists: [] },
  zonas: { strs: ["tipoSintoma"], lists: ["zonas", "momentos"] },
  actividad: { strs: ["actividad", "deporte", "horasPie", "profesion", "peso", "altura", "tallaCalzado"], lists: [] },
  calzado: { strs: ["desgaste", "plantillasPrevias"], lists: ["calzado"] },
  antecedentes: {
    strs: ["antecedentesDetalle", "medicacion", "observaciones"],
    lists: ["antecedentes", "tratamientosPrevios"],
    last: true,
  },
};

const E_FIELDS: Record<string, { strs: (keyof Exam)[]; lists: (keyof Exam)[]; last?: boolean }> = {
  movilidad: { strs: ["tipoPie", "fpiIzq", "fpiDcho", "movilidadObs"], lists: [] },
  // Los 5 generales, que se hacen siempre
  nucleo: {
    strs: [
      "jackIzq",
      "jackDcho",
      "navDropIzq",
      "navDropDcho",
      "resistSupIzq",
      "resistSupDcho",
      "lungeIzq",
      "lungeDcha",
      "singleHeelIzq",
      "singleHeelDcho",
    ],
    lists: [],
  },
  comp_sel: { strs: [], lists: ["testsSel"] },
  comp_res: {
    strs: [
      "heelRise",
      "maxPronIzq",
      "maxPronDcho",
      "navDriftIzq",
      "navDriftDcho",
      "tooManyToes",
      "resistInversion",
      "coleman",
      "balanceIzq",
      "balanceDcho",
      "singleLegSquat",
      "stepDown",
      "trendelenburg",
      "rotCadera",
      "dorsi1mtfIzq",
      "dorsi1mtfDcho",
      "tobillo",
      "primerRadio",
      "formulaMetatarsal",
      "formulaDigital",
      "compresionMtt",
      "mulder",
      "compresionCalcaneo",
      "palpacionCalcaneo",
      "palpacionAquiles",
      "thompson",
      "tinel",
      "estabilidadTobillo",
      "territorioSensitivo",
    ],
    lists: [],
  },
  dismetria: { strs: ["dismetria", "ladoCorto", "lamina", "alza"], lists: [] },
  marcha: {
    strs: ["marchaPatron", "contactoInicial", "anguloPaso", "retropieApoyo", "despegue", "marchaObs"],
    lists: [],
    last: true,
  },
};

function sectionValues(formData: FormData, def: { strs: string[]; lists: string[] }) {
  const out: Record<string, unknown> = {};
  for (const k of def.strs) out[k] = String(formData.get(k) ?? "").trim();
  for (const k of def.lists)
    out[k] = formData.getAll(k).map((v) => String(v).trim()).filter(Boolean);
  return out;
}

// Autoguardado (estilo Drive): cada pulsación guarda la sección en curso, sin
// validar ni redirigir. La validación dura queda para el botón «Continuar»,
// que además marca el bloque como completo en su última sección.
export async function autosaveSectionAction(
  formData: FormData
): Promise<{ ok: boolean }> {
  try {
    const u = await requireClinicStaff();
    const caseId = String(formData.get("caseId"));
    const block = String(formData.get("block"));
    const section = String(formData.get("section"));
    const def = block === "q" ? Q_FIELDS[section] : block === "e" ? E_FIELDS[section] : null;
    if (!def) return { ok: false };
    const { capture } = await captureFor(caseId, u);
    const prev = ((block === "q" ? capture.questionnaire : capture.physicalExam) ?? {}) as Record<
      string,
      unknown
    >;
    const merged = {
      ...prev,
      ...sectionValues(formData, def as { strs: string[]; lists: string[] }),
      v: 2,
      done: prev.done === true,
    };
    await prisma.capture.update({
      where: { id: capture.id },
      data: block === "q" ? { questionnaire: merged } : { physicalExam: merged },
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function saveQuestionnaireSectionAction(formData: FormData) {
  const u = await requireClinicStaff();
  const caseId = String(formData.get("caseId"));
  const paso = String(formData.get("paso") ?? "");
  const next = String(formData.get("next") ?? "");
  const back = `/caso/${caseId}${paso ? `?paso=${paso}` : ""}`;
  const section = String(formData.get("section"));
  const def = Q_FIELDS[section];
  if (!def) fail(back, "Sección desconocida");

  const { capture } = await captureFor(caseId, u);
  const prev = (capture.questionnaire ?? {}) as Record<string, unknown>;
  const merged = { ...prev, ...sectionValues(formData, def as { strs: string[]; lists: string[] }) };

  if (section === "motivo" && !String(merged.motivo ?? "").trim())
    fail(back, "Falta el motivo de consulta");
  if (
    section === "zonas" &&
    merged.lado !== "Sin dolor localizado" &&
    (merged.zonas as string[]).length === 0
  )
    fail(back, "Marca al menos una zona de dolor (o vuelve atrás y elige «Sin dolor localizado»)");

  const questionnaire = {
    ...merged,
    v: 2,
    done: def.last ? true : prev.done === true,
  } as Questionnaire;
  await prisma.capture.update({ where: { id: capture.id }, data: { questionnaire } });
  redirect(`/caso/${caseId}${next ? `?paso=${next}` : ""}`);
}

export async function saveExamSectionAction(formData: FormData) {
  const u = await requireClinicStaff();
  const caseId = String(formData.get("caseId"));
  const paso = String(formData.get("paso") ?? "");
  const next = String(formData.get("next") ?? "");
  const back = `/caso/${caseId}${paso ? `?paso=${paso}` : ""}`;
  const section = String(formData.get("section"));
  const def = E_FIELDS[section];
  if (!def) fail(back, "Sección desconocida");

  const { capture } = await captureFor(caseId, u);
  const prev = (capture.physicalExam ?? {}) as Record<string, unknown>;
  const values = sectionValues(formData, def);

  const merged = { ...prev, ...values } as Exam;

  // Los 5 generales son obligatorios para todos.
  if (section === "nucleo" && !nucleoCompleto(merged))
    fail(back, "Faltan resultados: los 5 tests generales se hacen en todos los pacientes");

  // Cada rama activa necesita al menos un test que la valore. Guardamos antes
  // de avisar, para que al volver esté marcado lo que ya había elegido.
  if (section === "comp_sel") {
    const q = (capture.questionnaire ?? null) as Questionnaire | null;
    const sinCubrir = ramasSinCubrir(q, merged);
    if (sinCubrir.length) {
      await prisma.capture.update({
        where: { id: capture.id },
        data: { physicalExam: { ...merged, v: 2, done: prev.done === true } as Exam },
      });
      fail(back, `Marca al menos un test para: ${sinCubrir.join(", ")}`);
    }
  }

  if (section === "dismetria") {
    if (values.dismetria === "Sí" && (!values.ladoCorto || !values.lamina))
      fail(back, "Con dismetría marcada indica el lado corto y la lámina que nivela la pelvis");
    if (values.dismetria !== "Sí") {
      values.ladoCorto = "";
      values.lamina = "";
      values.alza = "No";
    } else if (!values.alza) {
      values.alza = "No";
    }
  }

  const physicalExam = {
    ...prev,
    ...values,
    v: 2,
    done: def.last ? true : prev.done === true,
  } as Exam;
  await prisma.capture.update({ where: { id: capture.id }, data: { physicalExam } });
  redirect(`/caso/${caseId}${next ? `?paso=${next}` : ""}`);
}

// Marca un elemento de captura como subido y CONFIRMADO por el servidor.
// (En producción: subida por fragmentos a R2/S3 y confirmación real del servidor.)
export async function markMediaAction(formData: FormData) {
  const u = await requireClinicStaff();
  const caseId = String(formData.get("caseId"));
  const kind = String(formData.get("kind"));
  const next = String(formData.get("next") ?? "");
  // Los vídeos y fotos NO pasan por aquí: suben de verdad vía /api/media.
  const valid = [SCAN_KIND, ...BARO_KINDS.map(([k]) => k)];
  if (!valid.includes(kind)) fail(`/caso/${caseId}`, "Elemento de captura desconocido");
  const { kase, capture } = await captureFor(caseId, u);
  const exists = await prisma.mediaAsset.findFirst({ where: { captureId: capture.id, kind } });
  if (!exists) {
    // Carpeta por caso identificada con el nombre del paciente, para que el archivo
    // del escáner o del dashboard quede asociado sin depender de su nombre original.
    const carpeta = `estudios/${String(kase.number).padStart(5, "0")}-${slugify(kase.patient.name)}`;
    await prisma.mediaAsset.create({
      data: {
        captureId: capture.id,
        kind,
        url: `${carpeta}/${kind}`,
        confirmedAt: new Date(), // check verde SOLO con confirmación del servidor
      },
    });
  }
  redirect(`/caso/${caseId}${next ? `?paso=${next}` : ""}`);
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
