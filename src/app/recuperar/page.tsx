import { recoverAction } from "@/app/(auth)/actions";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RecuperarPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { error, ok } = await searchParams;
  return (
    <div className="wrap" style={{ maxWidth: 420 }}>
      <div className="sp2" />
      <h2>Recuperar contraseña</h2>
      <div className="sp" />
      <Flash error={error} ok={ok} />
      {!ok && (
        <form className="card" action={recoverAction}>
          <p className="muted">
            Escribe el email o el móvil de tu cuenta y te enviaremos por email un enlace para crear una
            contraseña nueva.
          </p>
          <label>Email o móvil</label>
          <input name="identifier" autoComplete="username" required />
          <div className="sp" />
          <button type="submit" className="pri wfull">
            Enviar enlace
          </button>
        </form>
      )}
      <div className="tiny" style={{ marginTop: 12 }}>
        Si tu cuenta la creó tu clínica y aún no la has activado, usa el enlace de invitación que te
        enviaron o pide a la clínica que lo reenvíe.
      </div>
    </div>
  );
}
