"use server";

// Acciones del profesional sobre el alta con consentimiento por WhatsApp.
import { redirect } from "next/navigation";
import type { ConsentType, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { auditar, crearPreAlta, leerPreAlta, nuevoEnlaceWeb, puedeVerFicha, reenviar, reenviarEmailAlta, revocar, tratamientoPermitido } from "@/lib/alta";
import { enviarAcceso, enviarAccesoSiProcede } from "@/lib/acceso";
import { isValidDni, normalizeDni } from "@/lib/contacto";
import { ORDEN, esObligatorio } from "@/lib/consent/tipos";
import { origenPeticion } from "@/lib/rate-limit";

function volver(path: string, tipo: "ok" | "error", msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${tipo}=` + encodeURIComponent(msg));
}

async function staff(): Promise<User & { clinicId: string }> {
  const u = await requireRole("PROFESIONAL", "ADMIN_CLINICA");
  if (!u.clinicId) throw new Error("Usuario sin clínica asignada");
  return u as User & { clinicId: string };
}

async function pacienteDeMiClinica(u: User, patientId: string) {
  const p = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!p || !puedeVerFicha(u, p)) volver("/panel?tab=altas", "error", "Paciente no encontrado");
  return p!;
}

export async function preAltaAction(formData: FormData) {
  const u = await staff();
  const r = await crearPreAlta(u, leerPreAlta(formData));
  if (!r.ok) volver("/panel?tab=altas", "error", r.error);
  // Siempre a la ficha: ahí está el QR para que el paciente escriba ALTA desde su móvil.
  const quien = r.patient.isMinor ? `${r.patient.tutorName} (tutor de ${r.patient.name})` : r.patient.name;
  volver(
    `/panel/paciente/${r.patient.id}`,
    "ok",
    r.envio.ok
      ? `Alta creada y WhatsApp enviado a ${quien}. También puede empezar escaneando el QR o escribiendo ALTA.`
      : `Alta creada. Pide a ${quien} que escanee el QR o escriba ALTA a nuestro WhatsApp para empezar (el envío automático no salió: ${r.envio.error}).`
  );
}

export async function reenviarAction(formData: FormData) {
  const u = await staff();
  const p = await pacienteDeMiClinica(u, String(formData.get("patientId")));
  const r = await reenviar(p.id, u);
  const back = `/panel/paciente/${p.id}`;
  if (!r.ok) volver(back, "error", r.error);
  volver(back, "ok", "Invitación reenviada por WhatsApp y, si tiene email, también por email. El mensaje anterior deja de valer.");
}

// Reenvía solo el enlace web de aceptación por email (p. ej. si el móvil no tiene WhatsApp).
export async function reenviarEmailAction(formData: FormData) {
  const u = await staff();
  const p = await pacienteDeMiClinica(u, String(formData.get("patientId")));
  const back = `/panel/paciente/${p.id}`;
  const r = await reenviarEmailAlta(p.id, u);
  if (!r.ok) volver(back, "error", r.error ?? "No se pudo reenviar");
  volver(back, "ok", "Enlace de aceptación reenviado por email (el enlace anterior deja de valer).");
}

// Abre la aceptación web en este mismo dispositivo (tablet de la clínica),
// para que el paciente la complete delante del profesional.
export async function abrirAceptacionAquiAction(formData: FormData) {
  const u = await staff();
  const p = await pacienteDeMiClinica(u, String(formData.get("patientId")));
  const back = `/panel/paciente/${p.id}`;
  const r = await nuevoEnlaceWeb(p.id);
  if (!r.ok) volver(back, "error", r.error);
  await auditar(u.id, "patient.alta_web_abierta", p.id);
  redirect(`/alta/${r.token}`);
}

// Datos que el profesional completa tras la aceptación (el DNI identifica la cuenta).
export async function guardarDniAction(formData: FormData) {
  const u = await staff();
  const p = await pacienteDeMiClinica(u, String(formData.get("patientId")));
  const back = `/panel/paciente/${p.id}`;
  if (!tratamientoPermitido(p)) volver(back, "error", "El paciente no tiene los consentimientos en vigor");
  const dni = normalizeDni(String(formData.get("dni") ?? ""));
  const tutorDni = normalizeDni(String(formData.get("tutorDni") ?? ""));
  if (dni && !isValidDni(dni)) volver(back, "error", "El DNI/NIE del paciente no es válido (revisa la letra)");
  if (tutorDni && !isValidDni(tutorDni)) volver(back, "error", "El DNI/NIE del tutor no es válido (revisa la letra)");
  await prisma.patient.update({
    where: { id: p.id },
    data: { dni: dni || null, ...(p.isMinor ? { tutorDni: tutorDni || null } : {}) },
  });
  await auditar(u.id, "patient.edit", p.id, { campos: p.isMinor ? ["dni", "tutorDni"] : ["dni"] });
  // Ficha completa (documentos aceptados + DNI): el acceso al perfil sale solo.
  const canal = await enviarAccesoSiProcede(p.id);
  volver(
    back,
    "ok",
    canal
      ? `Datos guardados. Acceso al perfil enviado por ${canal === "whatsapp" ? "WhatsApp" : "email"}`
      : "Datos guardados"
  );
}

export async function enviarAccesoAction(formData: FormData) {
  const u = await staff();
  const p = await pacienteDeMiClinica(u, String(formData.get("patientId")));
  const r = await enviarAcceso(p.id, u);
  const back = `/panel/paciente/${p.id}`;
  if (!r.ok) volver(back, "error", r.error);
  volver(back, "ok", r.canal === "whatsapp" ? "Acceso enviado por WhatsApp" : "WhatsApp no disponible: acceso enviado por email");
}

// Retirada registrada por el profesional a petición del paciente.
export async function revocarEnNombreAction(formData: FormData) {
  const u = await staff();
  const p = await pacienteDeMiClinica(u, String(formData.get("patientId")));
  const back = `/panel/paciente/${p.id}`;
  const type = String(formData.get("type")) as ConsentType;
  if (!ORDEN.includes(type) || formData.get("op") !== "revocar") volver(back, "error", "Acción no válida");
  if (esObligatorio(type) && formData.get("entiendo") !== "on")
    volver(back, "error", "Confirma que el paciente te lo ha pedido y que se detendrá su tratamiento");
  const { ip, userAgent } = await origenPeticion();
  const hecho = await revocar({ patientId: p.id, type, actor: "profesional", channel: "panel", actorUserId: u.id, ip, userAgent });
  volver(back, hecho ? "ok" : "error", hecho ? "Consentimiento retirado y registrado" : "Ese consentimiento no estaba en vigor");
}
