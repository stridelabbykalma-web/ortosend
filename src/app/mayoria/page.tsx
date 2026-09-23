import { handoverAction } from "@/app/(auth)/actions";
import { Flash } from "@/components/ui";
import { verifyHandoverToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EDAD_MAYORIA_SALUD, HANDOVER_TOKEN_DAYS } from "@/lib/edad";

export const dynamic = "force-dynamic";

// El paciente que ha cumplido 16 años toma el control de su cuenta: confirma
// email y móvil, crea su contraseña y pasa a ser el único con acceso.
export default async function MayoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token = "", error } = await searchParams;
  const pid = await verifyHandoverToken(token);
  const patient = pid ? await prisma.patient.findUnique({ where: { id: pid }, include: { owner: true } }) : null;
  const valido = patient && patient.isMinor && !patient.handoverAt;
  return (
    <div className="wrap" style={{ maxWidth: 480 }}>
      <div className="sp2" />
      <h2>Tu cuenta Ortosend, ahora tuya</h2>
      <div className="sp" />
      <Flash error={error} />
      {!valido ? (
        <div className="note r">
          {patient?.handoverAt
            ? "Esta cuenta ya fue traspasada. Entra con tu email o móvil y tu contraseña."
            : `El enlace no es válido o ha caducado (validez: ${HANDOVER_TOKEN_DAYS} días). La persona que gestionaba tu cuenta puede reenviártelo desde su panel.`}
        </div>
      ) : (
        <form className="card" action={handoverAction}>
          <p className="muted">
            Hola, <b>{patient!.name}</b>. Has cumplido {EDAD_MAYORIA_SALUD} años: desde ahora decides tú sobre tu
            tratamiento. Hasta hoy lo gestionaba <b>{patient!.owner.name}</b>; en cuanto confirmes tus datos,
            solo tú podrás acceder a tu expediente.
          </p>
          <input type="hidden" name="token" value={token} />
          <label>Tu email</label>
          <input name="email" type="email" defaultValue={patient!.email ?? ""} required />
          <label>Tu móvil</label>
          <input name="phone" type="tel" defaultValue={patient!.phone ?? ""} required />
          <label>Crea tu contraseña (mínimo 8 caracteres)</label>
          <input name="password" type="password" minLength={8} autoComplete="new-password" required />
          <div className="tiny" style={{ marginTop: 8 }}>
            Tu email y tu móvil deben ser distintos de los de {patient!.owner.name}. Podrás cambiarlos después
            desde tu panel.
          </div>
          <div className="sp" />
          <button type="submit" className="pri wfull">
            Activar mi cuenta
          </button>
        </form>
      )}
    </div>
  );
}
