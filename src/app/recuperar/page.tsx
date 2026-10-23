import Link from "next/link";
import { recoverAction } from "@/app/(auth)/actions";
import { Flash } from "@/components/ui";
import { AntiBot } from "@/components/antibot";

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
        <form className="card px-lift" action={recoverAction}>
          <p className="muted">
            Escribe el email o el móvil de tu cuenta y te enviaremos por email un enlace para crear una
            contraseña nueva.
          </p>
          <label>Email o móvil</label>
          <input name="identifier" autoComplete="username" required />
          <div className="sp" />
          <AntiBot />
          <button type="submit" className="pri wfull">
            Enviar enlace
          </button>
        </form>
      )}
      <div className="tiny" style={{ marginTop: 12 }}>
        ¿No tienes email en tu cuenta o aún no la creaste? Entra en{" "}
        <Link href="/acceso">ortosend.es/acceso</Link> con tu DNI y tu móvil: recibirás un código para
        crear o restablecer tu contraseña.
      </div>
    </div>
  );
}
