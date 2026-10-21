import Link from "next/link";
import { destinoSeguro } from "@/lib/navegacion";
import { loginAction } from "@/app/(auth)/actions";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; next?: string }>;
}) {
  const { error, ok, next } = await searchParams;
  const dest = next ? destinoSeguro(next, "") : "";
  return (
    <div className="wrap" style={{ maxWidth: 400 }}>
      <div className="sp2" />
      <h2>Acceder</h2>
      <div className="muted">Acceso de pacientes. El equipo de clínicas y taller entra desde su app.</div>
      <div className="sp" />
      <Flash error={error} ok={ok} />
      <form className="card" action={loginAction}>
        {dest && <input type="hidden" name="next" value={dest} />}
        <label>Email o móvil</label>
        <input name="identifier" autoComplete="username" required />
        <label>Contraseña</label>
        <input name="password" type="password" autoComplete="current-password" required />
        <div className="sp" />
        <button type="submit" className="pri wfull">
          Entrar
        </button>
        <div className="tiny" style={{ marginTop: 10, textAlign: "center" }}>
          <Link href="/recuperar">¿Has olvidado tu contraseña?</Link>
        </div>
      </form>
      <div className="tiny" style={{ marginTop: 12 }}>
        ¿Primera vez? Si reservaste online ya tienes cuenta con la contraseña que creaste. Si tu
        clínica te dio de alta, crea tu contraseña en <Link href="/acceso">ortosend.es/acceso</Link>{" "}
        con tu DNI y tu móvil.
      </div>
    </div>
  );
}
