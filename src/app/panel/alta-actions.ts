"use server";

// Acciones del profesional sobre el alta con consentimiento por WhatsApp.
import { redirect } from "next/navigation";
import type { ConsentType, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { auditar, crearPreAlta, leerPreAlta, puedeVerFicha, reenviar, revocar, tratamientoPermitido } from "@/lib/alta";
import { enviarAcceso } from "@/lib/acceso";
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
  const nombre = r.patient.name;
  if (!r.envio.ok)
    volver(`/panel/paciente/${r.patient.id}`, "error", `Alta creada, pero el WhatsApp no salió: ${r.envio.error}. Puedes reenviarlo.`);
  volver("/panel?tab=altas", "ok", `WhatsApp enviado a ${r.patient.isMinor ? `${r.patient.tutorName} (tutor de ${nombre})` : nombre}. Verás aquí cómo acepta cada documento.`);
}

export async function reenviarAction(formData: FormData) {
  const u = await staff();
  const p = await pacienteDeMiClinica(u, String(formData.get("patientId")));
  const r = await reenviar(p.id, u);
  const back = `/panel/paciente/${p.id}`;
  if (!r.ok) volver(back, "error", r.error);
  volver(back, "ok", "WhatsApp reenviado. El mensaje anterior deja de valer.");
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
  volver(back, "ok", "Datos guardados");
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
