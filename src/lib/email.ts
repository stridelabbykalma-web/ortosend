// Envío de email (canal de respaldo y avisos legales). Sin proveedor
// configurado el aviso queda solo encolado en Notification, visible en el
// panel de administración. Con RESEND_API_KEY y EMAIL_FROM se envía de verdad
// a través de la API de Resend (sin dependencias).
import { EMPRESA } from "./legal";

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const link = (p: Payload) => (str(p.enlace) ? `${EMPRESA.web}${str(p.enlace)}` : `${EMPRESA.web}/panel`);

// Asunto y texto de cada plantilla. Solo avisos y enlaces, nunca contenido clínico.
export function renderEmail(template: string, p: Payload): { subject: string; text: string } {
  const firma = `\n\n— ${EMPRESA.nombreComercial}\n${EMPRESA.email}`;
  switch (template) {
    case "cita_confirmada":
      return {
        subject: `Cita confirmada en ${str(p.clinica)}`,
        text: `Hola ${str(p.nombre)},\n\nTu cita en ${str(p.clinica)} queda confirmada para el ${str(p.fechaTexto)}.${
          str(p.paciente) ? `\nPaciente: ${str(p.paciente)}.` : ""
        }\n\n${str(p.nota)}\n\nPuedes seguir tu tratamiento en ${link(p)}${firma}`,
      };
    case "recordatorio_24h":
      return {
        subject: `Recordatorio: mañana tienes cita en ${str(p.clinica)}`,
        text: `Hola ${str(p.nombre)},\n\nTe recordamos tu cita en ${str(p.clinica)} (${str(p.direccion)}) el ${str(
          p.fechaTexto
        )}.${str(p.paciente) ? `\nPaciente: ${str(p.paciente)}.` : ""}\n\nTrae tu calzado habitual y ropa cómoda. El estudio dura unos 45 minutos y es gratuito.${firma}`,
      };
    case "mayoria_edad":
      return {
        subject: `Ya puedes gestionar tu tratamiento en ${EMPRESA.nombreComercial}`,
        text: `Hola ${str(p.nombre)},\n\nHas cumplido ${str(p.edad)} años y a partir de ahora puedes gestionar tú mismo/a tu tratamiento de plantillas en ${EMPRESA.nombreComercial}. Hasta hoy lo gestionaba ${str(
          p.titular
        )}.\n\nEntra en este enlace, revisa tu email y tu móvil y crea tu contraseña. Desde ese momento serás la única persona con acceso a tu expediente:\n\n${link(
          p
        )}\n\nEl enlace es válido ${str(p.validez)}. Si caduca, la persona que gestionaba tu cuenta puede pedir que te lo reenviemos desde su panel.${firma}`,
      };
    case "mayoria_edad_titular":
      return {
        subject: `${str(p.paciente)} ya puede gestionar su tratamiento`,
        text: `Hola ${str(p.nombre)},\n\n${str(p.paciente)} ha cumplido ${str(
          p.edad
        )} años. Por ley, desde esa edad decide sobre su salud, así que le hemos enviado a ${str(
          p.emailPaciente
        )} un enlace para que cree su propia contraseña y confirme su email y su móvil.\n\nEn cuanto lo haga, su expediente dejará de verse desde tu cuenta y solo podrá acceder él/ella.${firma}`,
      };
    case "mayoria_edad_sin_email":
      return {
        subject: `${str(p.paciente)} ya puede gestionar su tratamiento: falta su email`,
        text: `Hola ${str(p.nombre)},\n\n${str(p.paciente)} ha cumplido ${str(
          p.edad
        )} años y debe pasar a gestionar su propio tratamiento, pero no tenemos un email suyo. Añádelo en tu panel (apartado «Personas a tu cargo») y le enviaremos el enlace para que cree su contraseña.${firma}`,
      };
    case "cuenta_traspasada":
      return {
        subject: `${str(p.paciente)} ya gestiona su cuenta`,
        text: `Hola ${str(p.nombre)},\n\n${str(
          p.paciente
        )} ha activado su propia cuenta en ${EMPRESA.nombreComercial}. Su expediente ya no es accesible desde la tuya; a partir de ahora los avisos le llegarán directamente.${firma}`,
      };
    case "cuenta_creada":
      return {
        subject: `Bienvenido/a a ${EMPRESA.nombreComercial}: confirma tu email`,
        text: `Hola ${str(p.nombre)},\n\nTu cuenta en ${EMPRESA.nombreComercial} ya está creada. Con ella sigues tu tratamiento, ves tu prescripción y pagas online solo si un profesional la firma.\n\nTus datos de acceso:\n· Email: ${str(
          p.email
        )}\n· Móvil: ${str(p.movil)}\n· Contraseña: la que has creado\n\nConfirma que este email es tuyo (así podrás recuperar tu contraseña si la olvidas):\n\n${link(
          p
        )}\n\nEl enlace es válido ${str(p.validez)}. Si no has sido tú, ignora este mensaje.${firma}`,
      };
    case "verificar_email":
      return {
        subject: `Confirma tu email en ${EMPRESA.nombreComercial}`,
        text: `Hola ${str(p.nombre)},\n\nConfirma que este email es tuyo desde este enlace (válido ${str(p.validez)}):\n\n${link(
          p
        )}\n\nSi no has sido tú, ignora este mensaje.${firma}`,
      };
    case "recuperar_contrasena":
      return {
        subject: `Restablece tu contraseña de ${EMPRESA.nombreComercial}`,
        text: `Hola ${str(p.nombre)},\n\nHemos recibido una petición para restablecer tu contraseña. Crea una nueva desde este enlace (válido ${str(
          p.validez
        )} y de un solo uso):\n\n${link(p)}\n\nSi no has sido tú, ignora este mensaje: tu contraseña no cambia.${firma}`,
      };
    case "contrasena_cambiada":
      return {
        subject: `Tu contraseña de ${EMPRESA.nombreComercial} ha cambiado`,
        text: `Hola ${str(p.nombre)},\n\nTu contraseña acaba de cambiar. Si no has sido tú, restablécela ahora desde ${EMPRESA.web}/recuperar y escríbenos.${firma}`,
      };
    case "cuenta_activada":
      return {
        subject: `Tu cuenta en ${EMPRESA.nombreComercial} está activa`,
        text: `Hola ${str(p.nombre)},\n\n${str(p.nota)}\n\n${link(p)}${firma}`,
      };
    case "invitacion_cuenta":
      return {
        subject: `Activa tu cuenta en ${EMPRESA.nombreComercial}`,
        text: `Hola ${str(p.nombre)},\n\n${
          str(p.nota) ||
          `${str(p.clinica) ? `${str(p.clinica)} ha` : "Tu clínica ha"} iniciado tu estudio de plantillas con ${EMPRESA.nombreComercial}.`
        }${
          str(p.paciente) ? `\nPaciente: ${str(p.paciente)} (menor a tu cargo).` : ""
        }\n\nCrea tu cuenta desde este enlace: revisarás tus datos, aceptarás los consentimientos y elegirás tu contraseña. Con ella sigues el tratamiento, ves la prescripción y pagas online solo si un profesional la firma (enlace válido ${str(
          p.validez
        )}):\n\n${link(p)}\n\nSi caduca, tu clínica puede reenviártelo.${firma}`,
      };
    default:
      return {
        subject: `Aviso de ${EMPRESA.nombreComercial}`,
        text: `${str(p.nota) || "Tienes novedades en tu tratamiento."}\n\n${link(p)}${firma}`,
      };
  }
}

// Devuelve true si el email salió por el proveedor; false si solo queda encolado.
export async function deliverEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
