import { loginAction } from "@/app/(auth)/actions";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="wrap" style={{ maxWidth: 400 }}>
      <div className="sp2" />
      <h2>Acceder</h2>
      <div className="sp" />
      <Flash error={error} />
      <form className="card" action={loginAction}>
        <label>Email o móvil</label>
        <input name="identifier" autoComplete="username" required />
        <label>Contraseña</label>
        <input name="password" type="password" autoComplete="current-password" required />
        <div className="sp" />
        <button type="submit" className="pri wfull">
          Entrar
        </button>
      </form>
      <div className="tiny" style={{ marginTop: 12 }}>
        ¿Primera vez? Si has reservado cita online ya tienes cuenta con la contraseña que creaste.
        Si tu clínica inició tu estudio, activa tu cuenta desde el enlace que te enviamos por WhatsApp.
      </div>
    </div>
  );
}
