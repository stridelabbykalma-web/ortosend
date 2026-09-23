import { activateAction } from "@/app/(auth)/actions";
import { Flash } from "@/components/ui";
import { verifyInviteToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { INVITE_HOURS } from "@/lib/invitacion";
import { EDAD_MAYORIA_SALUD } from "@/lib/edad";

export const dynamic = "force-dynamic";

// Activación por invitación (Flujo B y profesionales): confirma email y móvil,
// crea la contraseña y, si es cliente, ratifica online los consentimientos.
export default async function ActivarPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token = "", error } = await searchParams;
  const uid = await verifyInviteToken(token);
  const user = uid ? await prisma.user.findUnique({ where: { id: uid }, include: { patients: true } }) : null;
  const menores = user?.patients.filter((p) => p.isMinor) ?? [];
  const esCliente = user?.role === "CLIENTE";
  return (
    <div className="wrap" style={{ maxWidth: 480 }}>
      <div className="sp2" />
      <h2>Activa tu cuenta Ortosend</h2>
      <div className="sp" />
      <Flash error={error} />
      {!user ? (
        <div className="note r">
          El enlace de invitación no es válido o ha caducado (validez: {INVITE_HOURS} h). Pide a tu
          clínica que te lo reenvíe.
        </div>
      ) : user.activatedAt ? (
        <div className="note a">Esta cuenta ya está activada. Entra desde <a href="/login">Acceder</a>.</div>
      ) : (
        <form className="card" action={activateAction}>
          <p className="muted">
            Hola, <b>{user.name}</b>.{" "}
            {menores.length > 0
              ? `Desde esta cuenta gestionarás el tratamiento de ${menores.map((m) => m.name).join(" y ")} hasta que cumpla ${EDAD_MAYORIA_SALUD} años.`
              : esCliente
                ? "Con esta cuenta seguirás tu tratamiento, verás tu prescripción y pagarás online solo si un profesional la firma."
                : "Confirma tus datos y crea tu contraseña para entrar en el panel."}
          </p>
          <input type="hidden" name="token" value={token} />
          <div className="grid g2">
            <div>
              <label>Tu email</label>
              <input name="email" type="email" defaultValue={user.email ?? ""} required />
            </div>
            <div>
              <label>Tu móvil</label>
              <input name="phone" type="tel" defaultValue={user.phone ?? ""} required />
            </div>
          </div>
          <div className="tiny">Revisa que sean correctos: son tu vía de acceso y de aviso.</div>
          <label>Contraseña (mínimo 8 caracteres)</label>
          <input name="password" type="password" minLength={8} autoComplete="new-password" required />
          {esCliente && (
            <>
              <label className="chk" style={{ marginTop: 10 }}>
                <input type="checkbox" name="consentSalud" required /> Confirmo el consentimiento explícito,
                firmado en la clínica, al tratamiento de {menores.length ? "los datos de salud del menor" : "mis datos de salud"} para
                este servicio, incluidos los vídeos de la marcha y las fotografías de los pies del estudio.
                {menores.length > 0 && " Declaro ser su padre, madre o tutor legal."}
              </label>
              <label className="chk">
                <input type="checkbox" name="consentWhatsApp" /> Acepto recibir los avisos del servicio por
                WhatsApp (solo avisos y enlaces, nunca contenido clínico).
              </label>
              <div className="tiny" style={{ marginTop: 6 }}>
                Responsable: Ortosend. Derechos y detalle en la <a href="/legal/privacidad">política de privacidad</a>.
              </div>
            </>
          )}
          <div className="sp" />
          <button type="submit" className="pri wfull">
            Activar cuenta
          </button>
        </form>
      )}
    </div>
  );
}
