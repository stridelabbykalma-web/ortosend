import { activateAction } from "@/app/(auth)/actions";
import { Flash } from "@/components/ui";
import { verifyInviteToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { consentimientoFirmado, esMenor } from "@/lib/legal";

export const dynamic = "force-dynamic";

export default async function ActivarPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token = "", error } = await searchParams;
  const uid = await verifyInviteToken(token);
  const user = uid
    ? await prisma.user.findUnique({
        where: { id: uid },
        include: { patients: { include: { cases: { include: { clinic: true }, orderBy: { createdAt: "desc" }, take: 1 } } } },
      })
    : null;
  // Paciente invitado por su clínica (Flujo B): la activación es la invitación, y en
  // ella acepta ser atendido y firma los consentimientos. Los profesionales solo crean
  // su contraseña.
  const pacientes = user?.role === "CLIENTE" ? user.patients.filter((p) => !consentimientoFirmado(p.consents)) : [];
  const clinica = pacientes[0]?.cases[0]?.clinic.name;
  const menor = pacientes.some((p) => esMenor(p));
  return (
    <div className="wrap" style={{ maxWidth: pacientes.length ? 560 : 420 }}>
      <div className="sp2" />
      <h2>{pacientes.length ? "Tu invitación a Ortosend" : "Activa tu cuenta Ortosend"}</h2>
      <div className="sp" />
      <Flash error={error} />
      {!user ? (
        <div className="note r">
          El enlace de invitación no es válido o ha caducado (validez: 72 h). Pide a tu clínica que
          te lo reenvíe.
        </div>
      ) : (
        <form className="card" action={activateAction}>
          <input type="hidden" name="token" value={token} />
          {pacientes.length ? (
            <>
              <p className="muted">
                Hola, <b>{user.name}</b>. {clinica ? <><b>{clinica}</b> te ha invitado</> : "Tu clínica te ha invitado"} a
                hacer tu estudio de plantillas a medida con Ortosend
                {pacientes.length === 1 && pacientes[0].name !== user.name ? <> para <b>{pacientes[0].name}</b></> : null}.
                Para empezar, acepta la invitación y firma los consentimientos.
              </p>
              <label className="chk">
                <input type="checkbox" name="consentTratamiento" required /> Acepto ser atendido
                {clinica ? <> en {clinica}</> : null} y por Ortosend para el estudio biomecánico de la
                pisada y, si un profesional lo prescribe, la fabricación de mis plantillas a medida.
                Entiendo que solo pagaré si hay prescripción.
              </label>
              <label className="chk">
                <input type="checkbox" name="consentSalud" required /> Consiento de forma explícita el
                tratamiento de mis datos de salud para la prestación del servicio, incluida la
                grabación de vídeos de mi marcha y fotografías de mis pies durante el estudio.
              </label>
              {menor && (
                <label className="chk">
                  <input type="checkbox" name="consentTutor" required /> Declaro ser el padre, la madre o el
                  tutor legal del menor y consentir en su nombre.
                </label>
              )}
              <label className="chk">
                <input type="checkbox" name="consentWhatsApp" defaultChecked /> Acepto recibir los avisos del
                servicio por WhatsApp (solo avisos y enlaces, nunca contenido clínico).
              </label>
              <div className="tiny" style={{ marginTop: 6 }}>
                Responsable: Ortosend. Finalidad: gestionar tu estudio y tratamiento. Derechos de
                acceso, rectificación y supresión en la{" "}
                <a href="/legal/privacidad">política de privacidad</a>.
              </div>
              <div className="sp" />
              <label>Crea tu contraseña (mínimo 8 caracteres)</label>
            </>
          ) : (
            <>
              <p className="muted">
                Hola, <b>{user.name}</b>. Crea tu contraseña para seguir tu tratamiento desde tu panel.
              </p>
              <label>Contraseña (mínimo 8 caracteres)</label>
            </>
          )}
          <input name="password" type="password" minLength={8} required />
          <div className="sp" />
          <button type="submit" className="pri wfull">
            {pacientes.length ? "Aceptar invitación y firmar" : "Activar cuenta"}
          </button>
        </form>
      )}
    </div>
  );
}
