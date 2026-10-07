// Avisos del tratamiento por WhatsApp a través de ManyChat (citas, estudio,
// prescripción y pago, envío…). Cada tipo de aviso es un flujo de ManyChat con
// su mensaje pre-aprobado por Meta; aquí solo se rellenan los huecos logísticos
// (fecha, clínica, dirección, enlace, seguimiento). El texto libre «nota» del
// aviso NUNCA sale hacia ManyChat: puede contener detalles clínicos y solo va
// por email al propio paciente.
import { prisma } from "./db";
import { CAMPOS, aE164, flujoAviso, manychat } from "./manychat";
import { EMPRESA } from "./legal";

const str = (v: unknown) => (typeof v === "string" ? v : "");

function fechaTexto(iso: string) {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return d.toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "full", timeStyle: "short" });
}

// Huecos del mensaje a partir del payload del aviso (lista cerrada).
export function camposAviso(payload: Record<string, unknown>) {
  const enlace = str(payload.enlace) || "/panel";
  return {
    [CAMPOS.avisoFecha]: str(payload.fecha) ? fechaTexto(str(payload.fecha)) : "",
    [CAMPOS.avisoClinica]: str(payload.clinica),
    [CAMPOS.avisoDireccion]: str(payload.direccion),
    [CAMPOS.avisoEnlace]: enlace.startsWith("http") ? enlace : `${EMPRESA.web}${enlace}`,
    [CAMPOS.avisoSeguimiento]: str(payload.seguimiento),
    ...(str(payload.paciente) ? { [CAMPOS.paciente]: str(payload.paciente) } : {}),
  };
}

// Contacto de ManyChat de ese móvil: el del alta por WhatsApp si existe; si no
// (p. ej. reservó en la web), se crea con la prueba de su consentimiento.
async function contactoDe(telefono: string, nombre: string) {
  const inv = await prisma.consentInvitation.findFirst({
    where: { toPhone: telefono, manychatSubscriberId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (inv?.manychatSubscriberId) return inv.manychatSubscriberId;
  return manychat().buscarOCrearContacto({
    telefonoE164: aE164(telefono),
    nombre: nombre.split(" ")[0] || nombre || "Paciente",
    fraseConsentimiento: "Aceptó recibir los avisos del servicio por WhatsApp en ortosend.com",
  });
}

// Devuelve true si el aviso salió por WhatsApp.
export async function enviarAvisoWhatsApp(
  telefono: string,
  nombre: string,
  template: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const flow = flujoAviso(template);
  if (!flow) return false;
  try {
    const sub = await contactoDe(telefono, nombre);
    await manychat().ponerCampos(sub, camposAviso(payload));
    await manychat().lanzarFlujo(sub, flow);
    return true;
  } catch {
    return false;
  }
}
