"use server";

// Acciones de prescripción (prescriptor de clínica o recetador central):
// reparto automático, firma, contacto, repetición, no-prescripción y borrador.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { audit, notify, pushEvent, releaseStale } from "@/lib/cases";
import { PAY_LINK_DAYS, VENTANA_COLA } from "@/lib/states";
import { PRICE_CENTS } from "@/lib/format";
import type { Case } from "@prisma/client";

function fail(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=` + encodeURIComponent(msg));
}

// El usuario puede valorar este caso: recetador central (clínicas sin prescriptor)
// o profesional prescriptor de la clínica del caso.
async function requirePrescriberFor(caseId: string) {
  const u = await requireRole("RECETADOR", "PROFESIONAL");
  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    include: { clinic: true, patient: true, prescription: true },
  });
  if (!kase) throw new Error("Caso no encontrado");
  if (u.role === "RECETADOR") {
    if (kase.clinic.hasPrescriber) throw new Error("Este caso lo valora el prescriptor de su clínica");
  } else {
    if (u.clinicId !== kase.clinicId) throw new Error("Caso de otra clínica");
  }
  const profile = await prisma.professionalProfile.findUnique({ where: { userId: u.id } });
  return { u, kase, profile };
}

// Siguiente caso de la cola central (el más antiguo). Reparto automático:
// al abrirlo queda asociado y desaparece de la cola del resto.
export async function nextRxAction() {
  const u = await requireRole("RECETADOR");
  await releaseStale();
  const candidates = await prisma.case.findMany({
    where: { state: "EN_PRESCRIPCION", openBy: null, clinic: { hasPrescriber: false } },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  for (const c of candidates) {
    const claimed = await prisma.case.updateMany({
      where: { id: c.id, openBy: null },
      data: { openBy: u.id, openAt: new Date() },
    });
    if (claimed.count === 1) redirect(`/caso/${c.id}`);
  }
  redirect("/panel?ok=" + encodeURIComponent("No hay casos en cola ahora mismo"));
}

// Abrir un caso concreto: el prescriptor de clínica elige de su propia cola y
// el recetador central, de los primeros de la cola (o de los marcados como
// complicados, que se pueden coger siempre para echar una mano).
export async function openCaseAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const { u, kase } = await requirePrescriberFor(caseId);
  if (kase.openBy === u.id) redirect(`/caso/${caseId}`);
  if (kase.openBy) fail("/panel", "Otro profesional tiene abierto ese caso");
  if (u.role === "RECETADOR" && !kase.hardAt) {
    await releaseStale();
    const primeros = await prisma.case.findMany({
      where: { state: "EN_PRESCRIPCION", openBy: null, clinic: { hasPrescriber: false } },
      orderBy: { createdAt: "asc" },
      take: VENTANA_COLA,
      select: { id: true },
    });
    if (!primeros.some((c) => c.id === caseId))
      fail(
        "/panel",
        `La cola es por antigüedad: solo puedes elegir entre los ${VENTANA_COLA} casos que llevan más tiempo esperando`
      );
  }
  // Reclamo atómico: si otro lo cogió entre la lectura y ahora, no lo pisamos.
  const claimed = await prisma.case.updateMany({
    where: { id: caseId, openBy: null },
    data: { openBy: u.id, openAt: new Date() },
  });
  if (claimed.count !== 1) fail("/panel", "Otro profesional acaba de coger ese caso");
  redirect(`/caso/${caseId}`);
}

// Marcar el caso como complicado: pide una segunda opinión al resto de
// prescriptores, que lo verán destacado en su cola con la nota.
export async function markHardAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const { u, kase } = await requirePrescriberFor(caseId);
  const back = `/caso/${caseId}`;
  const note = String(formData.get("hardNote") ?? "").trim();
  if (!note) fail(back, "Escribe qué hay que mirar: es lo que verá el compañero que lo coja");
  if (!["EN_PRESCRIPCION", "EN_CONTACTO"].includes(kase.state)) fail(back, "El caso no está en valoración");
  const soltar = formData.get("release") !== null;
  const draft = String(formData.get("assessment") ?? "").trim();
  await prisma.case.update({
    where: { id: caseId },
    data: {
      hardAt: new Date(),
      hardBy: u.id,
      hardByName: u.name,
      hardNote: note,
      ...(draft ? { rxDraft: draft } : {}),
      ...(soltar ? { openBy: null, openAt: null } : {}),
    },
  });
  await pushEvent(caseId, `Marcado como complicado — segunda opinión: ${note}`, u.name);
  if (soltar) redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} marcado como complicado y devuelto a la cola`));
  redirect(back + "?ok=" + encodeURIComponent("Caso marcado como complicado: tus compañeros lo verán destacado"));
}

// Retirar la marca: el caso ya no necesita una segunda opinión.
export async function unmarkHardAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const { u, kase } = await requirePrescriberFor(caseId);
  if (!kase.hardAt) redirect(`/caso/${caseId}`);
  await prisma.case.update({
    where: { id: caseId },
    data: { hardAt: null, hardBy: null, hardByName: null, hardNote: null },
  });
  await pushEvent(caseId, "Retirada la marca de caso complicado", u.name);
  redirect(`/caso/${caseId}?ok=` + encodeURIComponent("Marca de caso complicado retirada"));
}

async function ownerPhone(kase: Case & { patient: { ownerId: string } }) {
  const owner = await prisma.user.findUnique({ where: { id: kase.patient.ownerId } });
  return owner?.phone ?? null;
}

// Firma de la prescripción → documento clínico + enlace de pago (30 días).
export async function signRxAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const { u, kase, profile } = await requirePrescriberFor(caseId);
  const back = `/caso/${caseId}`;
  if (!["EN_PRESCRIPCION", "EN_CONTACTO"].includes(kase.state)) fail(back, "El caso no está en valoración");
  // Guardas duras: solo prescriptor verificado firma; sin prescripción no hay pago.
  if (!profile?.canPrescribe || !profile.verifiedAt || !profile.collegiateNum)
    fail(back, "Solo un prescriptor con colegiación verificada puede firmar");
  const assessment = String(formData.get("assessment") ?? "").trim();
  const diagnosis =
    String(formData.get("diagnosis") ?? "") +
    (formData.get("diagnosisDetail") ? ` — ${String(formData.get("diagnosisDetail")).trim()}` : "");
  const fabricationOrder = String(formData.get("fabricationOrder") ?? "").trim();
  const usageGuidelines = String(formData.get("usageGuidelines") ?? "").trim();
  if (!fabricationOrder)
    fail(back, "La pauta de fabricación es obligatoria: es la orden de trabajo del taller");
  const expires = new Date(Date.now() + PAY_LINK_DAYS * 24 * 3600 * 1000);
  await prisma.$transaction([
    prisma.prescription.create({
      data: {
        caseId,
        prescriberId: u.id,
        prescriberName: u.name,
        collegiateNum: profile.collegiateNum,
        assessment,
        diagnosis,
        fabricationOrder,
        usageGuidelines,
        pdfUrl: `prescripciones/${kase.number}.pdf`, // PDF firmado e inmutable (generación real pendiente)
      },
    }),
    prisma.payment.create({ data: { caseId, amountCents: PRICE_CENTS } }),
    prisma.case.update({
      where: { id: caseId },
      data: { state: "PENDIENTE_PAGO", openBy: null, openAt: null, rxDraft: null, payLinkExpiresAt: expires },
    }),
  ]);
  await pushEvent(caseId, `Prescripción firmada por ${u.name} (col. ${profile.collegiateNum})`, u.name);
  await audit(u.id, "prescription.sign", `case:${kase.number}`);
  const phone = await ownerPhone(kase);
  if (phone)
    await notify(phone, "rx_lista_pago", {
      nota: "Tu prescripción está lista. Entra en tu panel para verla y completar el pago (199,99 €, enlace válido 30 días).",
    });
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} prescrito y enviado a pago`));
}

// El prescriptor quiere hablar con el paciente → asignación pegajosa.
export async function contactAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const { u, kase } = await requirePrescriberFor(caseId);
  const note = String(formData.get("note") ?? "").trim();
  if (!note) fail(`/caso/${caseId}`, "La nota del contacto es obligatoria (quedará en el caso)");
  if (kase.state !== "EN_PRESCRIPCION") fail(`/caso/${caseId}`, "El caso no está en valoración");
  await prisma.case.update({
    where: { id: caseId },
    data: { state: "EN_CONTACTO", assignedTo: u.id, openBy: null, openAt: null },
  });
  await pushEvent(caseId, `Contacto con el paciente solicitado: ${note}`, u.name);
  const phone = await ownerPhone(kase);
  if (phone)
    await notify(phone, "propuesta_llamada", {
      nota: `${u.name.split("(")[0].trim()} está valorando tu estudio y quiere hacerte unas preguntas. Te llamará en breve.`,
    });
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} asignado a ti hasta resolverlo`));
}

// Devolver a clínica para repetir una prueba (sin coste para el cliente).
export async function repeatAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const { u, kase } = await requirePrescriberFor(caseId);
  const what = String(formData.get("what") ?? "").trim();
  const why = String(formData.get("why") ?? "").trim();
  if (!what) fail(`/caso/${caseId}`, "Indica qué prueba hay que repetir");
  if (!["EN_PRESCRIPCION", "EN_CONTACTO"].includes(kase.state)) fail(`/caso/${caseId}`, "El caso no está en valoración");
  await prisma.$transaction([
    prisma.case.update({ where: { id: caseId }, data: { state: "DEVUELTO_CLINICA", openBy: null, openAt: null } }),
    prisma.incident.create({
      data: { caseId, type: "CAPTURA_INVALIDA", reason: `Repetir: ${what}${why ? ` — ${why}` : ""}`, openedBy: u.name },
    }),
  ]);
  // Se invalida la prueba para que la clínica la repita.
  const capture = await prisma.capture.findUnique({ where: { caseId } });
  if (capture) await prisma.capture.update({ where: { caseId }, data: { completedAt: null } });
  await pushEvent(caseId, `Devuelto a clínica — repetir: ${what}${why ? ` (${why})` : ""}`, u.name);
  const phone = await ownerPhone(kase);
  if (phone)
    await notify(phone, "repetir_prueba", {
      nota: "Necesitamos completar una prueba de tu estudio; tu clínica te contactará para una cita breve, sin coste.",
    });
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} devuelto a la clínica`));
}

// No prescribir: el cliente no paga, la clínica no cobra.
export async function noPrescribeAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const { u, kase } = await requirePrescriberFor(caseId);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!["EN_PRESCRIPCION", "EN_CONTACTO"].includes(kase.state)) fail(`/caso/${caseId}`, "El caso no está en valoración");
  await prisma.case.update({
    where: { id: caseId },
    data: { state: "NO_PRESCRITO", openBy: null, openAt: null },
  });
  await pushEvent(caseId, `No prescrito.${reason ? ` Recomendación: ${reason}` : ""}`, u.name);
  const phone = await ownerPhone(kase);
  if (phone)
    await notify(phone, "no_prescrito", {
      nota: `Hemos valorado tu estudio con detalle y el tratamiento con plantillas no está indicado; no se te cobrará nada.${reason ? ` Nuestra recomendación: ${reason}` : ""}`,
    });
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} cerrado sin prescripción`));
}

// Guardar borrador y soltar el caso (vuelve a la cola conservando antigüedad).
export async function draftAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const { u, kase } = await requirePrescriberFor(caseId);
  await prisma.case.update({
    where: { id: caseId },
    data: { rxDraft: String(formData.get("assessment") ?? "").trim() || null, openBy: null, openAt: null },
  });
  await pushEvent(caseId, "Borrador guardado; caso devuelto a la cola (conserva antigüedad)", u.name);
  void kase;
  redirect("/panel");
}
