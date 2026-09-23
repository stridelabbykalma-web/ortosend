"use server";

// Acciones del panel de clínica: disponibilidad, Flujo B y asistente de captura.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { checklistOf, notify, pushEvent } from "@/lib/cases";
import {
  caducidadInvitacion,
  enviarInvitacion,
  estadoInvitacion,
  nuevoTokenInvitacion,
  reenviarInvitacion,
} from "@/lib/invitacion";
import { isValidPhone, normalizeEmail, normalizePhone } from "@/lib/contacto";
import { EDAD_MAYORIA_SALUD, esMenor, parseBirth } from "@/lib/edad";
import { BARO_KINDS, SCAN_KIND } from "@/lib/format";
import { nombreProyectoRevoScan } from "@/lib/scan";
import type { Questionnaire } from "@/lib/questionnaire";
import type { Exam } from "@/lib/exploracion";
import { nucleoCompleto, ramasSinCubrir } from "@/lib/tests-podologicos";
import { RX_ROUTES, type RxRoute } from "@/lib/rx-route";
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

// --- Flujo B: invitación con los datos esenciales del paciente ---
// La clínica no crea la cuenta: el paciente (o su tutor, si es menor de 16) la
// crea al aceptar la invitación, acepta los consentimientos y entonces nace el
// caso. Todo queda registrado por el propio paciente.
export async function invitePatientAction(formData: FormData) {
  const u = await requireClinicStaff();
  const back = "/panel?tab=agenda";
  const name = String(formData.get("name") ?? "").trim();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const email = normalizeEmail(String(formData.get("email") ?? "")) || null;
  const birth = parseBirth(String(formData.get("birth") ?? ""));
  const tutorNombre = String(formData.get("tutorNombre") ?? "").trim();
  const tutorMovil = normalizePhone(String(formData.get("tutorMovil") ?? ""));
  const tutorEmail = normalizeEmail(String(formData.get("tutorEmail") ?? "")) || null;
  const menor = esMenor(birth);
  if (!name) fail(back, "El nombre del paciente es obligatorio");
  if (menor && !tutorNombre) fail(back, `Paciente menor de ${EDAD_MAYORIA_SALUD} años: indica su padre, madre o tutor`);
  if (email && !email.includes("@")) fail(back, "Email no válido");
  // Destinatario de la invitación: el paciente o, si es menor, su tutor.
  const toPhone = menor ? tutorMovil : phone;
  const toEmail = menor ? tutorEmail : email;
  if (!isValidPhone(toPhone)) fail(back, menor ? "El móvil del tutor es obligatorio" : "Móvil del paciente no válido");
  if (phone && !isValidPhone(phone)) fail(back, "Móvil del paciente no válido");
  if (toEmail && !toEmail.includes("@")) fail(back, "Email del tutor no válido");
  if (menor && email && email === toEmail) fail(back, "El email del menor debe ser distinto del de su tutor");
  const clinic = await prisma.clinic.findUnique({ where: { id: u.clinicId }, select: { name: true } });
  const inv = await prisma.invitation.create({
    data: {
      clinicId: u.clinicId,
      createdBy: u.id,
      createdByName: u.name,
      token: nuevoTokenInvitacion(),
      name,
      birthDate: birth,
      isMinor: menor,
      patientEmail: menor ? email : null,
      patientPhone: menor ? phone || null : null,
      tutorName: menor ? tutorNombre : null,
      phone: toPhone,
      email: toEmail,
      expiresAt: caducidadInvitacion(),
    },
  });
  await enviarInvitacion(inv, clinic?.name ?? "Tu clínica");
  redirect(
    back +
      "&ok=" +
      encodeURIComponent(
        `Invitación enviada a ${inv.tutorName ?? inv.name} (${inv.phone}${inv.email ? ` y ${inv.email}` : ""}). El estudio se abre en cuanto la acepte.`
      )
  );
}

export async function resendInvitationAction(formData: FormData) {
  const u = await requireClinicStaff();
  const back = "/panel?tab=agenda";
  const inv = await prisma.invitation.findFirst({
    where: { id: String(formData.get("invitationId")), clinicId: u.clinicId },
    include: { clinic: true },
  });
  if (!inv) fail(back, "Invitación no encontrada");
  const estado = estadoInvitacion(inv!);
  if (estado === "aceptada" || estado === "cancelada") fail(back, `La invitación ya está ${estado}`);
  await reenviarInvitacion(inv!, inv!.clinic.name);
  redirect(back + "&ok=" + encodeURIComponent(`Invitación reenviada a ${inv!.tutorName ?? inv!.name}`));
}

export async function cancelInvitationAction(formData: FormData) {
  const u = await requireClinicStaff();
  const back = "/panel?tab=agenda";
  const r = await prisma.invitation.updateMany({
    where: { id: String(formData.get("invitationId")), clinicId: u.clinicId, status: "pendiente" },
    data: { status: "cancelada" },
  });
  if (!r.count) fail(back, "Invitación no encontrada o ya resuelta");
  redirect(back + "&ok=" + encodeURIComponent("Invitación cancelada"));
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
    // Escaneo: se anota el nombre con el que está guardado el proyecto de Revo
    // Scan en la carpeta compartida de la clínica, que es como lo busca el taller.
    let meta: object | undefined;
    if (kind === SCAN_KIND) {
      const owner = await prisma.user.findUnique({ where: { id: kase.patient.ownerId }, select: { phone: true } });
      meta = { proyecto: nombreProyectoRevoScan(kase.patient.name, owner?.phone, kase.number) };
    }
    await prisma.mediaAsset.create({
      data: {
        captureId: capture.id,
        kind,
        url: `${carpeta}/${kind}`,
        meta,
        confirmedAt: new Date(), // check verde SOLO con confirmación del servidor
      },
    });
    if (kind === SCAN_KIND)
      await pushEvent(caseId, `Escaneo de las espumas guardado en Revo Scan como «${(meta as { proyecto: string }).proyecto}»`, u.name);
  }
  redirect(`/caso/${caseId}${next ? `?paso=${next}` : ""}`);
}

// Envío del estudio: checklist bloqueante → ESTUDIO_COMPLETO → EN_PRESCRIPCION.
export async function sendCaseAction(formData: FormData) {
  const u = await requireClinicStaff();
  const caseId = String(formData.get("caseId"));
  const paso = String(formData.get("paso") ?? "");
  const back = `/caso/${caseId}${paso ? `?paso=${paso}` : ""}`;
  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    include: { capture: { include: { media: true } }, patient: true, clinic: true },
  });
  if (!kase || kase.clinicId !== u.clinicId) fail("/panel", "Caso no accesible");
  const fromRepeat = kase!.state === "DEVUELTO_CLINICA";
  if (!["ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"].includes(kase!.state))
    fail(`/caso/${caseId}`, "El estudio no está en curso");

  // Quién receta se eligió antes de empezar el estudio (chooseRxRouteAction).
  const rxRoute = kase!.rxRoute as RxRoute | null;
  if (!rxRoute) fail(`/caso/${caseId}?elegir=1`, "Antes de enviar hay que elegir quién receta el caso");
  if (rxRoute === "ORTOSEND") {
    // Estudio completo de Ortosend: checklist bloqueante, sin todo en verde no hay envío.
    const cl = checklistOf(kase!.capture);
    if (!cl.completa) fail(`/caso/${caseId}`, "La checklist del protocolo debe estar completa (todo en verde)");
  } else {
    // Receta propia (con o sin segunda opinión): las pruebas son elegibles salvo el
    // motivo de consulta, la baropodometría y el escaneo de las espumas.
    const q = kase!.capture?.questionnaire as { motivo?: string } | null;
    if (!q?.motivo?.trim())
      fail(`/caso/${caseId}?paso=1`, "El motivo de consulta es obligatorio: regístralo antes de enviar");
    const cl = checklistOf(kase!.capture);
    if (!cl.baro) fail(`/caso/${caseId}`, "La baropodometría (estática y dinámica múltiple) es obligatoria también en la receta propia");
    if (!cl.escaneos) fail(`/caso/${caseId}`, "El escaneo de las espumas fenólicas es obligatorio también en la receta propia");
  }
  void back;

  await prisma.capture.update({ where: { caseId }, data: { completedAt: new Date() } });
  await prisma.case.update({
    where: { id: caseId },
    data: {
      state: "EN_PRESCRIPCION",
      rxRequestedBy: kase!.rxRequestedBy ?? u.id,
      // Receta propia: queda asignado a quien lo envió solo si es prescriptor; si lo
      // envió el administrador, lo coge cualquier prescriptor de la clínica desde su cola.
      assignedTo:
        rxRoute === "CLINICA" && (await esPrescriptorVerificado(kase!.rxRequestedBy ?? u.id))
          ? (kase!.rxRequestedBy ?? u.id)
          : null,
      openBy: null,
      openAt: null,
    },
  });
  const destino = {
    CLINICA: `receta propia de ${u.name}`,
    ORTOSEND: "receta por parte del equipo de Ortosend",
    REVISION: `receta propia de ${u.name} con segunda opinión de Ortosend`,
  }[rxRoute];
  await pushEvent(
    caseId,
    fromRepeat ? `Prueba repetida y reenviada a prescripción: ${destino}` : `Estudio completo. Enviado a prescripción: ${destino}`,
    u.name
  );
  if (kase!.patient) {
    const owner = await prisma.user.findUnique({ where: { id: kase!.patient.ownerId } });
    if (owner?.phone)
      await notify(owner.phone, "estudio_completo", {
        nota: "Tu estudio está completo y en valoración. Te avisaremos en un máximo de 48 h laborables.",
      });
  }
  if (rxRoute === "CLINICA") {
    // Si quien envía es prescriptor, aterriza en la receta; si no (p. ej. el
    // administrador), el caso queda en la cola de prescripciones de la clínica.
    const firma = await esPrescriptorVerificado(u.id);
    redirect(
      `/caso/${caseId}?ok=` +
        encodeURIComponent(
          firma
            ? `Caso #${kase!.number} enviado: ya puedes rellenar y firmar la receta`
            : `Caso #${kase!.number} enviado: queda en la cola de prescripciones de vuestra clínica`
        )
    );
  }
  redirect(
    "/panel?ok=" +
      encodeURIComponent(
        `Caso #${kase!.number} enviado a ${rxRoute === "REVISION" ? "Ortosend para revisión" : "prescripción de Ortosend"}`
      )
  );
}

// Quién receta se decide ANTES de empezar el estudio, porque el protocolo
// depende de ello: si receta Ortosend se hace el estudio completo; si receta
// la clínica o pide una segunda opinión, el formulario es otro (pendiente).
// Solo un prescriptor con colegiación verificada puede quedárselo o pedir
// revisión; el resto envía a Ortosend.
// ¿Tiene la clínica algún prescriptor con colegiación verificada?
async function clinicaPuedeRecetar(clinicId: string) {
  const n = await prisma.professionalProfile.count({
    where: { canPrescribe: true, verifiedAt: { not: null }, user: { clinicId, active: true } },
  });
  return n > 0;
}

// ¿Es este usuario un prescriptor con colegiación verificada?
async function esPrescriptorVerificado(userId: string) {
  const p = await prisma.professionalProfile.findUnique({ where: { userId } });
  return !!p?.canPrescribe && !!p.verifiedAt;
}

export async function chooseRxRouteAction(formData: FormData) {
  const u = await requireClinicStaff();
  const caseId = String(formData.get("caseId"));
  const kase = await prisma.case.findUnique({ where: { id: caseId } });
  if (!kase || kase.clinicId !== u.clinicId) fail("/panel", "Caso no accesible");
  if (!["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"].includes(kase!.state))
    fail(`/caso/${caseId}`, "El caso ya está enviado: no se puede cambiar quién receta");
  // Las opciones de receta propia dependen de la clínica (que tenga un prescriptor
  // verificado), no de quien rellena: el administrador también puede elegirlas.
  const pedida = String(formData.get("rxRoute") ?? "");
  let rxRoute: RxRoute;
  if (!(await clinicaPuedeRecetar(u.clinicId!))) rxRoute = "ORTOSEND";
  else if (RX_ROUTES.includes(pedida as RxRoute)) rxRoute = pedida as RxRoute;
  else fail(`/caso/${caseId}?elegir=1`, "Elige quién receta este caso");
  if (kase!.rxRoute !== rxRoute) {
    await prisma.case.update({ where: { id: caseId }, data: { rxRoute, rxRequestedBy: u.id } });
    const texto = { CLINICA: `receta propia de ${u.name}`, ORTOSEND: "receta por parte del equipo de Ortosend", REVISION: `receta propia de ${u.name} con segunda opinión de Ortosend` }[rxRoute];
    await pushEvent(caseId, `Quién receta: ${texto}`, u.name);
  }
  redirect(`/caso/${caseId}`);
}

// --- Solicitud de alta de profesional (solo ADMIN_CLINICA) ---
// La cuenta la crea Ortosend tras validar la ficha (colegiación incluida si prescribe).
export async function requestProfessionalAction(formData: FormData) {
  const u = await requireRole("ADMIN_CLINICA");
  if (!u.clinicId) throw new Error("Usuario sin clínica asignada");
  const back = "/panel?tab=prof";
  const fullName = String(formData.get("fullName") ?? "").trim();
  const dni = String(formData.get("dni") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const degree = String(formData.get("degree") ?? "").trim();
  const canPrescribe = formData.get("canPrescribe") === "on";
  const collegiateNum = String(formData.get("collegiateNum") ?? "").trim();
  const college = String(formData.get("college") ?? "").trim();
  if (!fullName || !dni || !email || !phone || !degree)
    fail(back, "Nombre completo, DNI, email, móvil y titulación son obligatorios");
  if (canPrescribe && (!collegiateNum || !college))
    fail(back, "Para un prescriptor, el nº de colegiado y el colegio profesional son obligatorios");
  const dup = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (dup) fail(back, "Ya existe una cuenta con ese email o móvil");
  await prisma.professionalApplication.create({
    data: {
      clinicId: u.clinicId,
      requestedBy: u.id,
      fullName,
      dni,
      email,
      phone,
      degree,
      canPrescribe,
      collegiateNum: collegiateNum || null,
      college: college || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });
  redirect(back + "&ok=" + encodeURIComponent("Solicitud enviada. Ortosend validará la ficha y creará la cuenta."));
}

