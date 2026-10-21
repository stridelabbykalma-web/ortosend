"use server";

// Acciones del panel de clínica: disponibilidad, Flujo B y asistente de captura.
import { auditar, exigirTratamientoPermitido, tratamientoPermitido } from "@/lib/alta";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { checklistOf, pushEvent, titularDePaciente, avisarPaciente } from "@/lib/cases";
import { syncCaseAppointment, completeTodaysAppointment } from "@/lib/agenda-db";
import { BARO_KINDS, SCAN_KIND } from "@/lib/format";
import { nombreProyectoRevoScan } from "@/lib/scan";
import type { Questionnaire } from "@/lib/questionnaire";
import type { Exam } from "@/lib/exploracion";
import { complementariosCompletos, nucleoCompleto, ramasSinCubrir } from "@/lib/tests-podologicos";
import { RX_ROUTES, type RxRoute } from "@/lib/rx-route";
import type { User } from "@prisma/client";

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

// El alta de pacientes nuevos (pre-alta + consentimiento por WhatsApp) está en
// alta-actions.ts. La disponibilidad va por agenda-actions.ts.

// --- Asistente de captura (guardado continuo) ---
async function captureFor(caseId: string, u: User) {
  const kase = await prisma.case.findUnique({ where: { id: caseId }, include: { capture: true, patient: true } });
  if (!kase || kase.clinicId !== u.clinicId) throw new Error("Caso no accesible");
  await exigirTratamientoPermitido(kase.patientId);
  await auditar(u.id, "case.edit", kase.patientId, { caseId, rol: "clinica" });
  if (!["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"].includes(kase.state))
    throw new Error("El estudio no está en curso");
  const capture =
    kase.capture ?? (await prisma.capture.create({ data: { caseId } }));
  if (kase.state === "CITA_RESERVADA") {
    await prisma.case.update({ where: { id: caseId }, data: { state: "ESTUDIO_EN_CURSO" } });
    // El paciente ha venido: la cita del día queda como realizada.
    await completeTodaysAppointment(prisma, caseId);
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

  let qDone = prev.done === true;
  if (def.last) {
    const q = merged as Questionnaire;
    if (!String(q.motivo ?? "").trim()) fail(`/caso/${caseId}?paso=1`, "Falta el motivo de consulta (pantalla 1) para cerrar el cuestionario");
    if (q.lado !== "Sin dolor localizado" && !(Array.isArray(q.zonas) && q.zonas.length))
      fail(`/caso/${caseId}?paso=2`, "Faltan las zonas de dolor (pantalla 2) para cerrar el cuestionario");
    qDone = true;
  }
  const questionnaire = { ...merged, v: 2, done: qDone } as Questionnaire;
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

  // La última pantalla cierra el bloque: antes de marcarlo hecho se valida el
  // bloque ENTERO, no solo esta sección (si no, saltando pasos desde el índice
  // se podía enviar una exploración vacía con la checklist en verde).
  let done = prev.done === true;
  if (def.last) {
    const completo = merged as Exam;
    const q = (capture.questionnaire ?? null) as Questionnaire | null;
    if (!completo.tipoPie) fail(`/caso/${caseId}?paso=6`, "Falta el tipo de pie (pantalla 6) para cerrar la exploración");
    if (!nucleoCompleto(completo)) fail(`/caso/${caseId}?paso=7`, "Faltan los 5 tests generales (pantalla 7) para cerrar la exploración");
    const sinCubrir = ramasSinCubrir(q, completo);
    if (sinCubrir.length) fail(`/caso/${caseId}?paso=8`, `Faltan tests complementarios de: ${sinCubrir.join(", ")}`);
    if (!complementariosCompletos(completo)) fail(`/caso/${caseId}?paso=9`, "Faltan resultados de los tests complementarios (pantalla 9)");
    if (!completo.dismetria) fail(`/caso/${caseId}?paso=10`, "Falta la dismetría (pantalla 10) para cerrar la exploración");
    done = true;
  }
  const physicalExam = { ...prev, ...values, v: 2, done } as Exam;
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
      const owner = await titularDePaciente(kase.patientId);
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
  if (!tratamientoPermitido(kase!.patient)) fail(`/caso/${caseId}`, "El paciente no tiene los consentimientos en vigor");
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
    const q = kase!.capture?.questionnaire as { motivo?: string } | null;
    if (!q?.motivo?.trim())
      fail(`/caso/${caseId}?paso=1`, "El motivo de consulta es obligatorio: regístralo antes de enviar");
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

  // Ruta CLINICA: si nadie en la clínica puede firmar (colegiación sin
  // verificar, baja…), el caso se quedaría en una cola sin salida.
  if (rxRoute === "CLINICA") {
    const hayPrescriptor = await prisma.professionalProfile.findFirst({
      where: { canPrescribe: true, verifiedAt: { not: null }, user: { clinicId: u.clinicId, active: true } },
    });
    if (!hayPrescriptor)
      fail(`/caso/${caseId}?elegir=1`, "Vuestra clínica no tiene ningún prescriptor verificado: elige la receta de Ortosend o contacta con administración");
  }

  await prisma.capture.update({ where: { caseId }, data: { completedAt: new Date() } });
  // Si venía de una incidencia, la prueba repetida la resuelve; y la cita de
  // repetición (si la había) queda como realizada en vez de colgada en la agenda.
  if (fromRepeat) {
    await prisma.incident.updateMany({
      where: { caseId, type: "CAPTURA_INVALIDA", closedAt: null },
      data: { closedAt: new Date(), resolution: `Prueba repetida y reenviada por ${u.name}` },
    });
    const rep = await prisma.appointment.findFirst({
      where: { caseId, kind: "REPETICION", status: { in: ["RESERVADA", "CONFIRMADA"] } },
    });
    if (rep) {
      await prisma.appointment.update({ where: { id: rep.id }, data: { status: "COMPLETADA" } });
      await syncCaseAppointment(prisma, caseId);
    }
  }
  // Caso ya pagado (incidencia del taller tras el pago): la receta y el pago
  // siguen vigentes, así que vuelve directo al taller sin pasar otra vez por
  // prescripción ni por pago (firmar de nuevo chocaría con la receta única y
  // volver a PENDIENTE_PAGO le pediría pagar dos veces).
  const pagoVigente = await prisma.payment.findUnique({ where: { caseId } });
  if (fromRepeat && pagoVigente?.paidAt) {
    await prisma.case.update({
      where: { id: caseId },
      data: { state: "ENTRADA_TALLER", openBy: null, openAt: null },
    });
    await pushEvent(caseId, "Prueba repetida: el caso vuelve al taller (receta y pago vigentes)", u.name);
    await avisarPaciente(kase!.patientId, "estudio_completo", {
      caseId,
      nota: "Ya hemos repetido la prueba pendiente: tu pedido sigue en fabricación, sin coste adicional.",
    });
    redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase!.number} reenviado al taller (ya estaba pagado)`));
  }
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
  await avisarPaciente(kase!.patientId, "estudio_completo", {
    caseId,
    nota: "Tu estudio está completo y en valoración. Te avisaremos en un máximo de 48 h laborables.",
  });
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
  await exigirTratamientoPermitido(kase!.patientId);
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

