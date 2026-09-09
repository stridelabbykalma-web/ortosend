// ============================================================
// Escaneos (servidor): quién sube, bandeja de la clínica y asociación al caso
// ============================================================
import { prisma } from "./db";
import { getSessionUser, verifyScanToken } from "./auth";
import { audit, pushEvent } from "./cases";
import { SCAN_KIND } from "./format";
import { INBOX_HOURS, PUENTE_VIVO_MIN, SCAN_WAIT_MIN, fmtMB } from "./scan";
import { presignGet, r2Configured } from "./storage";
import type { ScanUpload } from "@prisma/client";

export const CAPTURE_STATES = ["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"] as const;

export type Actor = { clinicId: string; name: string; userId: string | null; agentId: string | null };

// Puente (token firmado) o profesional de la clínica (cookie de sesión).
export async function actorOf(req: Request): Promise<Actor | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (token) {
    const agentId = await verifyScanToken(token);
    if (!agentId) return null;
    const agent = await prisma.scanAgent.findUnique({ where: { id: agentId } });
    if (!agent || agent.revokedAt) return null;
    await prisma.scanAgent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });
    return { clinicId: agent.clinicId, name: `${agent.name} (puente)`, userId: null, agentId: agent.id };
  }
  const user = await getSessionUser();
  if (!user || !user.clinicId) return null;
  if (user.role !== "PROFESIONAL" && user.role !== "ADMIN_CLINICA") return null;
  return { clinicId: user.clinicId, name: user.name, userId: user.id, agentId: null };
}

// El asistente de este caso está en el paso del escaneo: «levanta la mano»
// para que el próximo escaneo que llegue de la clínica sea suyo.
export async function marcarEsperando(caseId: string) {
  await prisma.case.updateMany({
    where: { id: caseId, state: { in: [...CAPTURE_STATES] } },
    data: { scanWaitingAt: new Date() },
  });
}

// ¿Hay algún puente de escaneo dando señal en esta clínica?
export async function puenteActivo(clinicId: string): Promise<boolean> {
  const desde = new Date(Date.now() - PUENTE_VIVO_MIN * 60 * 1000);
  return (await prisma.scanAgent.count({ where: { clinicId, revokedAt: null, lastSeenAt: { gt: desde } } })) > 0;
}

// Escaneos recibidos en la clínica que todavía no son de ningún caso.
export async function bandejaDe(clinicId: string) {
  return prisma.scanUpload.findMany({
    where: {
      clinicId,
      status: "recibido",
      caseId: null,
      receivedAt: { gt: new Date(Date.now() - INBOX_HOURS * 3600 * 1000) },
    },
    orderBy: { receivedAt: "desc" },
    select: { id: true, filename: true, label: true, sizeBytes: true, receivedAt: true, uploadedBy: true },
  });
}

// Asocia un escaneo de la bandeja a un caso: crea el MediaAsset scan_espumas
// confirmado (check verde) y deja constancia en el historial.
export async function asociarEscaneo(upload: ScanUpload, caseId: string, actor: Actor, motivo = "confirmado a mano") {
  const kase = await prisma.case.findUnique({ where: { id: caseId }, include: { capture: true, patient: true } });
  if (!kase || kase.clinicId !== upload.clinicId) throw new Error("Caso no accesible");
  if (!CAPTURE_STATES.includes(kase.state as (typeof CAPTURE_STATES)[number]))
    throw new Error("El estudio ya no está en curso");
  if (upload.caseId) throw new Error("Este escaneo ya está asociado a un caso");

  const capture = kase.capture ?? (await prisma.capture.create({ data: { caseId } }));
  if (kase.state === "CITA_RESERVADA") {
    await prisma.case.update({ where: { id: caseId }, data: { state: "ESTUDIO_EN_CURSO" } });
    await pushEvent(caseId, "Estudio iniciado en clínica", actor.name);
  }
  // Un caso puede acumular varios escaneos (repetir el molde): el taller elige.
  const media = await prisma.mediaAsset.create({
    data: {
      captureId: capture.id,
      kind: SCAN_KIND,
      url: "",
      sizeBytes: upload.sizeBytes,
      meta: { uploadId: upload.id, archivo: upload.filename, mime: upload.mime, storage: upload.storage },
      confirmedAt: new Date(), // check verde SOLO con confirmación del servidor
    },
  });
  await prisma.mediaAsset.update({ where: { id: media.id }, data: { url: `/api/media/${media.id}` } });
  await prisma.scanUpload.update({ where: { id: upload.id }, data: { caseId, mediaId: media.id } });
  await prisma.case.update({ where: { id: caseId }, data: { scanWaitingAt: null } });
  await pushEvent(
    caseId,
    `Escaneo de las espumas recibido y asociado al paciente: ${upload.filename} (${fmtMB(upload.sizeBytes)})${upload.label ? ` · proyecto «${upload.label}»` : ""} · ${motivo}`,
    actor.name
  );
  if (actor.userId) await audit(actor.userId, "media.upload", `case:${kase.number}:${SCAN_KIND}`);
  return { caso: kase.number, paciente: kase.patient.name, mediaId: media.id };
}

// Texto comparable: minúsculas, sin acentos ni signos.
function normaliza(t: string) {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Al recibir un escaneo, de qué caso es. Por orden:
//   1. El nombre del proyecto en Revo Scan lleva el número de un caso abierto.
//   2. El nombre del proyecto es el nombre de un paciente con estudio abierto.
//   3. Hay exactamente UN caso de la clínica esperando en el paso del escaneo.
// Si nada de eso decide sin ambigüedad, se queda en la bandeja y el
// profesional lo confirma con un toque desde el asistente.
export async function autoasociar(upload: ScanUpload, actor: Actor) {
  const abiertos = await prisma.case.findMany({
    where: { clinicId: upload.clinicId, state: { in: [...CAPTURE_STATES] } },
    select: {
      id: true,
      number: true,
      scanWaitingAt: true,
      patient: { select: { name: true, dni: true, owner: { select: { phone: true } } } },
    },
  });
  const etiqueta = normaliza(upload.label ?? "");

  if (etiqueta) {
    const cifras = etiqueta.match(/\d{1,15}/g) ?? [];
    // Teléfono: 9 cifras seguidas que coinciden con el móvil del titular
    // (se comparan las 9 últimas, por si uno lleva prefijo +34).
    const telefonos = new Set(cifras.filter((n) => n.length >= 9).map((n) => n.slice(-9)));
    const porTelefono = abiertos.filter((c) => {
      const t = (c.patient.owner.phone ?? "").replace(/\D/g, "").slice(-9);
      return t.length === 9 && telefonos.has(t);
    });
    if (porTelefono.length === 1)
      return asociarEscaneo(upload, porTelefono[0].id, actor, "teléfono del paciente en el nombre del proyecto");

    // DNI/NIE: 7-8 cifras (+ letra) que coinciden con el del paciente.
    const dnis = new Set(cifras.filter((n) => n.length === 7 || n.length === 8));
    const porDni = abiertos.filter((c) => {
      const d = (c.patient.dni ?? "").replace(/\D/g, "");
      return d.length >= 7 && dnis.has(d);
    });
    if (porDni.length === 1) return asociarEscaneo(upload, porDni[0].id, actor, "DNI del paciente en el nombre del proyecto");

    const numeros = new Set(cifras.filter((n) => n.length <= 7).map(Number));
    const porNumero = abiertos.filter((c) => numeros.has(c.number));
    if (porNumero.length === 1)
      return asociarEscaneo(upload, porNumero[0].id, actor, "número de caso en el nombre del proyecto");

    // Nombre del paciente dentro del nombre del proyecto (o al revés, si el
    // proyecto lleva solo parte del nombre). Mínimo 5 letras para no acertar
    // por casualidad.
    const porNombre = abiertos.filter((c) => {
      const n = normaliza(c.patient.name);
      return n.length >= 5 && (etiqueta.includes(n) || (etiqueta.length >= 5 && n.includes(etiqueta)));
    });
    if (porNombre.length === 1)
      return asociarEscaneo(upload, porNombre[0].id, actor, "nombre del paciente en el proyecto");
  }

  const desde = Date.now() - SCAN_WAIT_MIN * 60 * 1000;
  const esperando = abiertos.filter((c) => c.scanWaitingAt && +c.scanWaitingAt > desde);
  if (esperando.length === 1)
    return asociarEscaneo(upload, esperando[0].id, actor, "caso abierto en el paso del escaneo");
  return null;
}

// Dónde está el binario de un escaneo ya asociado: URL firmada de R2 o bytes.
export async function descargaDe(
  uploadId: string
): Promise<{ redirect: string } | { bytes: Buffer; mime: string; filename: string; encoding: string | null } | null> {
  const up = await prisma.scanUpload.findUnique({ where: { id: uploadId } });
  if (!up || up.status !== "recibido") return null;
  if (up.storage === "r2" && up.key) {
    if (!r2Configured()) return null;
    return { redirect: await presignGet(up.key, up.filename) };
  }
  if (up.bytes) return { bytes: Buffer.from(up.bytes), mime: up.mime, filename: up.filename, encoding: up.encoding };
  return null;
}
