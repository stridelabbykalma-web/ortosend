"use server";

// Acciones del taller: siguiente-caso, aceptación técnica, diseño, fabricación
// (mecanizado CNC → confección), calidad con foto obligatoria, envío e incidencias.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { notify, pushEvent, releaseStale } from "@/lib/cases";
import type { CaseState } from "@prisma/client";

const ACTIVE: CaseState[] = ["ENTRADA_TALLER", "DISENO", "FABRICACION", "CALIDAD", "ENVIADO"];

function fail(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=` + encodeURIComponent(msg));
}

async function tallerCase(caseId: string) {
  const u = await requireRole("TALLER", "ADMIN");
  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    include: { patient: true, clinic: true, prescription: true, payment: true, shipment: true },
  });
  if (!kase || !ACTIVE.includes(kase.state)) throw new Error("Caso no activo en taller");
  return { u, kase };
}

async function patientPhone(ownerId: string) {
  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  return owner?.phone ?? null;
}

export async function nextTallerAction() {
  const u = await requireRole("TALLER");
  await releaseStale();
  const candidates = await prisma.case.findMany({
    where: { state: { in: ACTIVE }, openBy: null },
    orderBy: [{ state: "asc" }, { createdAt: "asc" }],
    take: 5,
  });
  for (const c of candidates) {
    const claimed = await prisma.case.updateMany({
      where: { id: c.id, openBy: null },
      data: { openBy: u.id, openAt: new Date() },
    });
    if (claimed.count === 1) redirect(`/caso/${c.id}`);
  }
  redirect("/panel?ok=" + encodeURIComponent("No hay casos pendientes"));
}

export async function releaseCaseAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  await prisma.case.update({ where: { id: kase.id }, data: { openBy: null, openAt: null } });
  await pushEvent(kase.id, "Caso soltado a la cola", u.name);
  redirect("/panel");
}

// Entrada: aceptación técnica → diseño. Guardas: prescripción firmada y pago confirmado.
export async function acceptCaseAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  const back = `/caso/${kase.id}`;
  if (kase.state !== "ENTRADA_TALLER") fail(back, "El caso no está en entrada");
  if (!kase.prescription) fail(back, "Sin prescripción no se fabrica");
  if (!kase.payment?.paidAt) fail(back, "Sin pago no se fabrica");
  if (formData.get("scanOk") !== "on") fail(back, "Confirma que el escaneo abre y tiene resolución suficiente");
  await prisma.case.update({ where: { id: kase.id }, data: { state: "DISENO", openBy: null, openAt: null } });
  await pushEvent(kase.id, "Aceptado por el taller. Etiquetas de molde (I/D) y hoja de trabajo impresas", u.name);
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} aceptado → diseño`));
}

// Incidencia de captura en entrada → devolver a clínica (sin coste para el cliente).
export async function captureIncidentAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) fail(`/caso/${kase.id}`, "Indica el motivo de la incidencia");
  if (kase.state !== "ENTRADA_TALLER") fail(`/caso/${kase.id}`, "Solo desde entrada de taller");
  await prisma.$transaction([
    prisma.case.update({ where: { id: kase.id }, data: { state: "DEVUELTO_CLINICA", openBy: null, openAt: null } }),
    prisma.incident.create({ data: { caseId: kase.id, type: "CAPTURA_INVALIDA", reason, openedBy: u.name } }),
    prisma.capture.updateMany({ where: { caseId: kase.id }, data: { completedAt: null } }),
  ]);
  await pushEvent(kase.id, "Incidencia de captura — devuelto a clínica sin coste para el cliente", u.name);
  const phone = await patientPhone(kase.patient.ownerId);
  if (phone)
    await notify(phone, "repetir_prueba", {
      nota: "Necesitamos completar una prueba de tu estudio; tu clínica te contactará, sin coste.",
    });
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} devuelto a la clínica`));
}

// Diseño terminado (CAD adjunto y archivado) → fabricación, fase mecanizado.
export async function designDoneAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  const back = `/caso/${kase.id}`;
  if (kase.state !== "DISENO") fail(back, "El caso no está en diseño");
  const lot = String(formData.get("lot") ?? "").trim();
  await prisma.case.update({
    where: { id: kase.id },
    data: {
      state: "FABRICACION",
      fabPhase: "MECANIZADO",
      lot: lot || null,
      // CAD archivado para reposiciones y revisión anual (subida real pendiente).
      designFileUrl: `disenos/caso-${kase.number}.stl`,
      openBy: null,
      openAt: null,
    },
  });
  await pushEvent(kase.id, `Diseño terminado (CAD archivado) — a mecanizado CNC${lot ? ` · lote ${lot}` : ""}`, u.name);
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} → fabricación`));
}

// Molde mecanizado → confección a mano (registra lote CNC).
export async function phaseDoneAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  const back = `/caso/${kase.id}`;
  if (kase.state !== "FABRICACION" || kase.fabPhase !== "MECANIZADO") fail(back, "El caso no está en mecanizado");
  const lot = String(formData.get("lot") ?? "").trim();
  await prisma.case.update({
    where: { id: kase.id },
    data: { fabPhase: "CONFECCION", lot: lot || kase.lot },
  });
  await pushEvent(kase.id, `Molde mecanizado (${lot || kase.lot || "—"}) — pasa a confección a mano`, u.name);
  redirect(back);
}

// Confección terminada (trazabilidad del material) → control de calidad.
export async function confectionDoneAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  const back = `/caso/${kase.id}`;
  if (kase.state !== "FABRICACION" || kase.fabPhase !== "CONFECCION") fail(back, "El caso no está en confección");
  const material = String(formData.get("material") ?? "").trim();
  if (!material) fail(back, "Registra el material/lote para trazabilidad");
  await prisma.case.update({
    where: { id: kase.id },
    data: { state: "CALIDAD", material, openBy: null, openAt: null },
  });
  await pushEvent(kase.id, `Confección terminada (material ${material}) — a control de calidad`, u.name);
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} → calidad`));
}

// Adjuntar la foto obligatoria del par (simulada; subida real pendiente).
export async function attachQcPhotoAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  if (kase.state !== "CALIDAD") fail(`/caso/${kase.id}`, "El caso no está en calidad");
  await prisma.case.update({ where: { id: kase.id }, data: { qcPhotoUrl: `calidad/caso-${kase.number}.jpg` } });
  await pushEvent(kase.id, "Foto del par adjuntada en calidad", u.name);
  redirect(`/caso/${kase.id}`);
}

// Calidad superada → envío. Guarda: foto del par adjunta.
export async function qcOkAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  const back = `/caso/${kase.id}`;
  if (kase.state !== "CALIDAD") fail(back, "El caso no está en calidad");
  if (!kase.qcPhotoUrl) fail(back, "La foto del par es obligatoria antes de aprobar calidad");
  await prisma.$transaction([
    prisma.case.update({ where: { id: kase.id }, data: { state: "ENVIADO", openBy: null, openAt: null } }),
    prisma.shipment.upsert({
      where: { caseId: kase.id },
      create: {
        caseId: kase.id,
        toClinic: kase.delivery === "CLINICA",
        carrier: "Sendcloud (simulado)",
        tracking: `TRK-${kase.number}-ES`,
        shippedAt: new Date(),
      },
      update: { shippedAt: new Date() },
    }),
  ]);
  await pushEvent(kase.id, `Calidad superada — enviado (seguimiento TRK-${kase.number}-ES)`, u.name);
  const phone = await patientPhone(kase.patient.ownerId);
  if (phone)
    await notify(phone, "enviado", {
      nota:
        kase.delivery === "CLINICA"
          ? `Tus plantillas van de camino a tu clínica (${kase.clinic.name}); te avisarán para recogerlas.`
          : `Tus plantillas están en camino. Seguimiento: TRK-${kase.number}-ES`,
    });
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} enviado`));
}

// No pasa calidad → rehacer (incidencia interna, vuelve a fabricación con prioridad).
export async function qcFailAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) fail(`/caso/${kase.id}`, "Indica el defecto encontrado");
  if (kase.state !== "CALIDAD") fail(`/caso/${kase.id}`, "El caso no está en calidad");
  await prisma.$transaction([
    prisma.case.update({
      where: { id: kase.id },
      data: { state: "FABRICACION", fabPhase: "CONFECCION", qcPhotoUrl: null, openBy: null, openAt: null },
    }),
    prisma.incident.create({ data: { caseId: kase.id, type: "REHACER_DEFECTO", reason, openedBy: u.name } }),
  ]);
  await pushEvent(kase.id, `No pasa calidad: ${reason} — rehacer con prioridad`, u.name);
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} vuelve a fabricación`));
}

// Entrega confirmada (en producción: webhook del transportista).
export async function deliveredAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  if (kase.state !== "ENVIADO") fail(`/caso/${kase.id}`, "El caso no está enviado");
  await prisma.$transaction([
    prisma.case.update({ where: { id: kase.id }, data: { state: "ENTREGADO", openBy: null, openAt: null } }),
    prisma.shipment.updateMany({ where: { caseId: kase.id }, data: { deliveredAt: new Date() } }),
  ]);
  await pushEvent(
    kase.id,
    "Entrega confirmada. Inicia periodo de adaptación (seguimiento día 20) y queda programada la revisión anual",
    u.name
  );
  const phone = await patientPhone(kase.patient.ownerId);
  if (phone)
    await notify(phone, "entregado", {
      nota: "¡Entregadas! Recuerda: adaptación progresiva 2-3 semanas. Te preguntaremos qué tal en unos días.",
    });
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} entregado`));
}
