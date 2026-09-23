import Link from "next/link";
import { resetPasswordAction } from "@/app/(auth)/actions";
import { Flash } from "@/components/ui";
import { verifyResetToken } from "@/lib/auth";
import { RESET_HOURS } from "@/lib/cuenta";

export const dynamic = "force-dynamic";

export default async function RestablecerPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token = "", error } = await searchParams;
  const user = await verifyResetToken(token);
  return (
    <div className="wrap" style={{ maxWidth: 420 }}>
      <div className="sp2" />
      <h2>Nueva contraseña</h2>
      <div className="sp" />
      <Flash error={error} />
      {!user ? (
        <div className="note r">
          El enlace no es válido, ya se ha usado o ha caducado (validez: {RESET_HOURS} hora).{" "}
          <Link href="/recuperar">Pide uno nuevo</Link>.
        </div>
      ) : (
        <form className="card" action={resetPasswordAction}>
          <p className="muted">
            Hola, <b>{user.name}</b>. Crea tu nueva contraseña.
          </p>
          <input type="hidden" name="token" value={token} />
          <label>Nueva contraseña (mínimo 8 caracteres)</label>
          <input name="password" type="password" minLength={8} autoComplete="new-password" required />
          <label>Repítela</label>
          <input name="password2" type="password" minLength={8} autoComplete="new-password" required />
          <div className="sp" />
          <button type="submit" className="pri wfull">
            Guardar y entrar
          </button>
        </form>
      )}
    </div>
  );
}
