"use server";

// Acciones del taller: siguiente-caso (global o por fase), aceptación técnica,
// diseño, fabricación (mecanizado CNC por lotes → confección), calidad con
// checklist y foto obligatorias, envío con seguimiento, entrega e incidencias.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { notify, pushEvent, releaseStale } from "@/lib/cases";
import { QC_CHECKS, TALLER_STATES } from "@/lib/taller";
import type { CaseState } from "@prisma/client";

function fail(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=` + encodeURIComponent(msg));
}

async function tallerCase(caseId: string) {
  const u = await requireRole("TALLER", "ADMIN");
  const kase = await prisma.case.findUnique({
    where: { id: caseId },
    include: { patient: true, clinic: true, prescription: true, payment: true, shipment: true },
  });
  if (!kase || !TALLER_STATES.includes(kase.state)) throw new Error("Caso no activo en taller");
  return { u, kase };
}

async function patientPhone(ownerId: string) {
  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  return owner?.phone ?? null;
}

// Siguiente caso pendiente: el más antiguo sin abrir. Con `state` en el
// formulario, solo dentro de esa fase (cada puesto del taller tira de la suya).
export async function nextTallerAction(formData?: FormData) {
  const u = await requireRole("TALLER");
  await releaseStale();
  const wanted = String(formData?.get("state") ?? "") as CaseState;
  const states = TALLER_STATES.includes(wanted) ? [wanted] : TALLER_STATES;
  const found = await prisma.case.findMany({
    where: { state: { in: states }, openBy: null },
    include: { incidents: { where: { type: "REHACER_DEFECTO", closedAt: null }, select: { id: true } } },
    orderBy: [{ state: "asc" }, { createdAt: "asc" }],
    take: 20,
  });
  // Los «rehacer» (no pasaron calidad) van siempre por delante del resto.
  const candidates = [...found].sort((a, b) => Number(b.incidents.length > 0) - Number(a.incidents.length > 0));
  for (const c of candidates) {
    const claimed = await prisma.case.updateMany({
      where: { id: c.id, openBy: null },
      data: { openBy: u.id, openAt: new Date() },
    });
    if (claimed.count === 1) redirect(`/caso/${c.id}`);
  }
  redirect("/panel?ok=" + encodeURIComponent("No hay casos pendientes en esa fase"));
}

export async function releaseCaseAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  await prisma.case.update({ where: { id: kase.id }, data: { openBy: null, openAt: null } });
  await pushEvent(kase.id, "Caso soltado a la cola", u.name);
  redirect("/panel");
}

// Abrir un caso concreto desde el tablero (si nadie lo tiene abierto).
export async function openTallerCaseAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  if (kase.openBy && kase.openBy !== u.id) fail("/panel", `El caso #${kase.number} lo tiene abierto otra persona`);
  await prisma.case.update({ where: { id: kase.id }, data: { openBy: u.id, openAt: new Date() } });
  redirect(`/caso/${kase.id}`);
}

// Entrada: aceptación técnica → diseño. Guardas: prescripción firmada y pago confirmado.
export async function acceptCaseAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  const back = `/caso/${kase.id}`;
  if (kase.state !== "ENTRADA_TALLER") fail(back, "El caso no está en entrada");
  if (!kase.prescription) fail(back, "Sin prescripción no se fabrica");
  if (!kase.payment?.paidAt) fail(back, "Sin pago no se fabrica");
  if (formData.get("scanOk") !== "on") fail(back, "Confirma que el escaneo abre y tiene resolución suficiente");
  if (formData.get("rxOk") !== "on") fail(back, "Confirma que la pauta de fabricación es ejecutable");
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
  if (formData.get("cadOk") !== "on") fail(back, "Confirma que el CAD está guardado en el archivo del taller");
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
  redirect("/panel?ok=" + encodeURIComponent(`Caso #${kase.number} → fabricación${lot ? ` (lote ${lot})` : ""}`));
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

// Asignar o cambiar el lote de mecanizado de un molde pendiente (desde la pestaña Lotes).
export async function setLotAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  const lot = String(formData.get("lot") ?? "").trim();
  if (kase.state !== "FABRICACION" || kase.fabPhase !== "MECANIZADO") fail("/panel?tab=lotes", "Solo moldes pendientes de mecanizar");
  await prisma.case.update({ where: { id: kase.id }, data: { lot: lot || null } });
  await pushEvent(kase.id, lot ? `Molde asignado al lote ${lot}` : "Molde sin lote", u.name);
  redirect("/panel?tab=lotes");
}

// Tanda de CNC terminada: todos los moldes del lote pasan a confección a la vez.
export async function lotDoneAction(formData: FormData) {
  const u = await requireRole("TALLER", "ADMIN");
  const lot = String(formData.get("lot") ?? "").trim();
  if (!lot) fail("/panel?tab=lotes", "Indica el lote");
  const molds = await prisma.case.findMany({
    where: { state: "FABRICACION", fabPhase: "MECANIZADO", lot },
  });
  if (molds.length === 0) fail("/panel?tab=lotes", `No hay moldes pendientes en el lote ${lot}`);
  await prisma.case.updateMany({
    where: { id: { in: molds.map((m) => m.id) } },
    data: { fabPhase: "CONFECCION" },
  });
  for (const m of molds)
    await pushEvent(m.id, `Molde mecanizado (${lot}, tanda de ${molds.length}) — pasa a confección a mano`, u.name);
  redirect("/panel?tab=lotes&ok=" + encodeURIComponent(`Lote ${lot} mecanizado: ${molds.length} molde(s) a confección`));
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

// Calidad superada → envío. Guardas: los cuatro puntos verificados y foto del par adjunta.
export async function qcOkAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  const back = `/caso/${kase.id}`;
  if (kase.state !== "CALIDAD") fail(back, "El caso no está en calidad");
  const missing = QC_CHECKS.filter(([k]) => formData.get(`qc_${k}`) !== "on");
  if (missing.length) fail(back, `Verifica todos los puntos del control: ${missing.map(([, l]) => l.split(" (")[0]).join("; ")}`);
  if (!kase.qcPhotoUrl) fail(back, "La foto del par es obligatoria antes de aprobar calidad");
  const carrier = String(formData.get("carrier") ?? "").trim();
  const tracking = String(formData.get("tracking") ?? "").trim();
  const trk = tracking || `TRK-${kase.number}-ES`;
  await prisma.$transaction([
    prisma.case.update({ where: { id: kase.id }, data: { state: "ENVIADO", openBy: null, openAt: null } }),
    prisma.shipment.upsert({
      where: { caseId: kase.id },
      create: {
        caseId: kase.id,
        toClinic: kase.delivery === "CLINICA",
        carrier: carrier || "Sendcloud (simulado)",
        tracking: trk,
        shippedAt: new Date(),
      },
      update: { carrier: carrier || undefined, tracking: trk, shippedAt: new Date() },
    }),
    // Si venía de un «rehacer», la incidencia queda resuelta al superar calidad.
    prisma.incident.updateMany({
      where: { caseId: kase.id, type: "REHACER_DEFECTO", closedAt: null },
      data: { closedAt: new Date(), resolution: "Rehecho y calidad superada" },
    }),
  ]);
  await pushEvent(kase.id, `Calidad superada — enviado (seguimiento ${trk})`, u.name);
  const phone = await patientPhone(kase.patient.ownerId);
  if (phone)
    await notify(phone, "enviado", {
      nota:
        kase.delivery === "CLINICA"
          ? `Tus plantillas van de camino a tu clínica (${kase.clinic.name}); te avisarán para recogerlas.`
          : `Tus plantillas están en camino. Seguimiento: ${trk}`,
    });
  redirect("/panel?tab=envios&ok=" + encodeURIComponent(`Caso #${kase.number} enviado`));
}

// No pasa calidad → rehacer (incidencia interna, vuelve a confección con prioridad).
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

// Corregir transportista / nº de seguimiento de un envío en curso.
export async function updateShipmentAction(formData: FormData) {
  const { u, kase } = await tallerCase(String(formData.get("caseId")));
  if (kase.state !== "ENVIADO") fail(`/caso/${kase.id}`, "El caso no está enviado");
  const carrier = String(formData.get("carrier") ?? "").trim();
  const tracking = String(formData.get("tracking") ?? "").trim();
  if (!tracking) fail(`/caso/${kase.id}`, "Indica el número de seguimiento");
  await prisma.shipment.upsert({
    where: { caseId: kase.id },
    create: { caseId: kase.id, toClinic: kase.delivery === "CLINICA", carrier: carrier || null, tracking, shippedAt: new Date() },
    update: { carrier: carrier || null, tracking },
  });
  await pushEvent(kase.id, `Envío actualizado: ${carrier || "—"} · ${tracking}`, u.name);
  const back = String(formData.get("back") ?? "") === "panel" ? "/panel?tab=envios" : `/caso/${kase.id}`;
  redirect(back + (back.includes("?") ? "&" : "?") + "ok=" + encodeURIComponent("Seguimiento actualizado"));
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
  const back = String(formData.get("back") ?? "") === "panel" ? "/panel?tab=envios" : "/panel";
  redirect(back + (back.includes("?") ? "&" : "?") + "ok=" + encodeURIComponent(`Caso #${kase.number} entregado`));
}

// Cerrar una incidencia con su resolución (desde la pestaña Incidencias).
export async function closeIncidentAction(formData: FormData) {
  const u = await requireRole("TALLER", "ADMIN");
  const id = String(formData.get("incidentId") ?? "");
  const resolution = String(formData.get("resolution") ?? "").trim();
  if (!resolution) fail("/panel?tab=incidencias", "Indica cómo se ha resuelto la incidencia");
  const inc = await prisma.incident.findUnique({ where: { id } });
  if (!inc || inc.closedAt) fail("/panel?tab=incidencias", "Incidencia no encontrada o ya cerrada");
  await prisma.incident.update({ where: { id }, data: { closedAt: new Date(), resolution } });
  await pushEvent(inc.caseId, `Incidencia cerrada (${inc.type.toLowerCase().replace("_", " ")}): ${resolution}`, u.name);
  redirect("/panel?tab=incidencias&ok=" + encodeURIComponent("Incidencia cerrada"));
}
