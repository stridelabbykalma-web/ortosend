import { activateAction } from "@/app/(auth)/actions";
import { Flash } from "@/components/ui";
import { verifyInviteToken } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ActivarPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token = "", error } = await searchParams;
  const uid = await verifyInviteToken(token);
  const user = uid ? await prisma.user.findUnique({ where: { id: uid } }) : null;
  return (
    <div className="wrap" style={{ maxWidth: 420 }}>
      <div className="sp2" />
      <h2>Activa tu cuenta Ortosend</h2>
      <div className="sp" />
      <Flash error={error} />
      {!user ? (
        <div className="note r">
          El enlace de invitación no es válido o ha caducado (validez: 72 h). Pide a tu clínica que
          te lo reenvíe.
        </div>
      ) : (
        <form className="card" action={activateAction}>
          <p className="muted">
            Hola, <b>{user.name}</b>. Crea tu contraseña para seguir tu tratamiento desde tu panel.
          </p>
          <input type="hidden" name="token" value={token} />
          <label>Contraseña (mínimo 8 caracteres)</label>
          <input name="password" type="password" minLength={8} required />
          <div className="sp" />
          <button type="submit" className="pri wfull">
            Activar cuenta
          </button>
        </form>
      )}
    </div>
  );
}
