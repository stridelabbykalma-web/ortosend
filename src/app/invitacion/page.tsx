import Link from "next/link";
import { acceptInvitationAction } from "@/app/(auth)/actions";
import { Flash } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { INVITE_HOURS, estadoInvitacion } from "@/lib/invitacion";
import { EDAD_MAYORIA_SALUD } from "@/lib/edad";
import { fmtd } from "@/lib/format";

export const dynamic = "force-dynamic";

// Flujo B: el paciente (o su tutor) acepta la invitación de la clínica. Aquí
// crea su cuenta, revisa sus datos y acepta los consentimientos; en ese momento
// se abre el estudio.
export default async function InvitacionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; hecho?: string }>;
}) {
  const { token = "", error, hecho } = await searchParams;
  const inv = token ? await prisma.invitation.findUnique({ where: { token }, include: { clinic: true } }) : null;
  const estado = inv ? estadoInvitacion(inv) : null;
  const user = await getSessionUser();
  const cliente = user?.role === "CLIENTE" ? user : null;
  const titular = inv?.tutorName ?? inv?.name;
  return (
    <div className="wrap" style={{ maxWidth: 560 }}>
      <div className="sp2" />
      <h2>Tu estudio de plantillas con Ortosend</h2>
      <div className="sp" />
      <Flash error={error} />
      {hecho ? (
        <div className="note g">
          Cuenta creada y estudio abierto. Entra desde tu móvil en <b>ortosend.com</b> con tu email o
          móvil y la contraseña que acabas de crear.
        </div>
      ) : !inv || estado === "cancelada" ? (
        <div className="note r">Esta invitación no existe o ha sido anulada por la clínica.</div>
      ) : estado === "caducada" ? (
        <div className="note r">
          El enlace ha caducado (validez: {INVITE_HOURS} h). Pide a {inv.clinic.name} que te lo reenvíe.
        </div>
      ) : estado === "aceptada" ? (
        <div className="note a">
          Esta invitación ya se aceptó. <Link href="/login">Entra con tu cuenta</Link> para seguir tu
          tratamiento.
        </div>
      ) : (
        <form className="card" action={acceptInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <p className="muted">
            Hola, <b>{titular}</b>. <b>{inv.clinic.name}</b> ({inv.createdByName}) te invita a crear tu cuenta
            para el estudio de {inv.isMinor ? `${inv.name}, menor a tu cargo` : "tus plantillas a medida"}.
            La cita y el estudio son gratuitos: solo pagarás si un profesional colegiado prescribe el
            tratamiento.
          </p>
          <div className="card" style={{ background: "var(--paper)", marginBottom: 10 }}>
            <div className="tiny">DATOS QUE HA REGISTRADO LA CLÍNICA</div>
            <div>
              Paciente: <b>{inv.name}</b>
              {inv.birthDate ? ` · nacido/a el ${fmtd(inv.birthDate)}` : ""}
            </div>
            {inv.isMinor && (
              <div className="tiny">
                Tutor: {inv.tutorName}. Gestionarás su tratamiento hasta que cumpla {EDAD_MAYORIA_SALUD} años;
                ese día se le avisará a su email ({inv.patientEmail ?? "pendiente de indicar"}) para que tome el
                control de su cuenta.
              </div>
            )}
          </div>

          {cliente ? (
            <div className="note" style={{ marginBottom: 10 }}>
              Aceptarás con tu cuenta actual (<b>{cliente.name}</b>, {cliente.email ?? cliente.phone}).
            </div>
          ) : (
            <>
              <b>1. Tu cuenta</b>
              <div className="grid g2">
                <div>
                  <label>Tu email</label>
                  <input name="email" type="email" defaultValue={inv.email ?? ""} required />
                </div>
                <div>
                  <label>Tu móvil</label>
                  <input name="phone" type="tel" defaultValue={inv.phone} required />
                </div>
              </div>
              <div className="tiny">Revisa que sean correctos: son tu vía de acceso y de aviso.</div>
              <label>Crea tu contraseña (mínimo 8 caracteres)</label>
              <input name="password" type="password" minLength={8} autoComplete="new-password" required />
              <div className="tiny" style={{ marginTop: 6 }}>
                ¿Ya tienes cuenta en Ortosend?{" "}
                <Link href={`/login?next=${encodeURIComponent(`/invitacion?token=${token}`)}`}>Inicia sesión</Link> y
                acepta con ella.
              </div>
            </>
          )}

          <b style={{ display: "block", marginTop: 12 }}>{cliente ? "Consentimientos" : "2. Consentimientos"}</b>
          <label className="chk" style={{ marginTop: 8 }}>
            <input type="checkbox" name="consentSalud" required /> Consiento de forma explícita el tratamiento de{" "}
            {inv.isMinor ? "los datos de salud del menor" : "mis datos de salud"} para la prestación del servicio,
            incluida la grabación de vídeos de la marcha y fotografías de los pies durante el estudio, y su
            valoración por un profesional sanitario colegiado.
            {inv.isMinor &&
              ` Declaro ser su padre, madre o tutor legal y consentir en su nombre; sé que al cumplir ${EDAD_MAYORIA_SALUD} años se le avisará por email para que tome el control de su cuenta y yo dejaré de tener acceso.`}
          </label>
          <label className="chk">
            <input type="checkbox" name="consentWhatsApp" /> Acepto recibir los avisos del servicio por WhatsApp
            (solo avisos y enlaces, nunca contenido clínico).
          </label>
          <div className="tiny" style={{ marginTop: 8 }}>
            Responsable: Ortosend. {inv.clinic.name} actúa como encargada del tratamiento. Derechos de acceso,
            rectificación y supresión en la <a href="/legal/privacidad">política de privacidad</a>.
          </div>
          <div className="sp" />
          <button type="submit" className="pri wfull">
            {cliente ? "Aceptar y abrir mi estudio" : "Crear mi cuenta y aceptar"}
          </button>
        </form>
      )}
    </div>
  );
}
