import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/(auth)/actions";
import { getSessionUser } from "@/lib/auth";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

// Entrada del equipo (clínicas, taller y administración) y punto de
// instalación de la app: el manifest PWA solo se enlaza desde aquí, así la
// web pública queda para los pacientes y esta página se instala como app.
export const metadata: Metadata = {
  title: "Ortosend Clínicas — Acceso del equipo",
  robots: { index: false },
  manifest: "/manifest-equipo.webmanifest",
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Ortosend", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#0e6e5c" };

export default async function EquipoPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; next?: string }>;
}) {
  const { error, ok, next } = await searchParams;
  const user = await getSessionUser();
  if (user) redirect(user.role === "CLIENTE" ? "/panel" : next?.startsWith("/") ? next : "/panel");
  return (
    <div className="wrap" style={{ maxWidth: 440 }}>
      <div className="sp2" />
      <h2>Acceso del equipo</h2>
      <div className="muted">Clínicas asociadas, taller y administración de Ortosend.</div>
      <div className="sp" />
      <Flash error={error} ok={ok} />
      <form className="card" action={loginAction}>
        <input type="hidden" name="ambito" value="equipo" />
        {next?.startsWith("/") && <input type="hidden" name="next" value={next} />}
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
      <div className="sp" />
      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Instalar como app en tu dispositivo</summary>
        <div className="tiny" style={{ marginTop: 8, display: "grid", gap: 6 }}>
          <div>
            <b>iPhone / iPad</b> — abre esta página en Safari, toca el botón de compartir y elige
            «Añadir a pantalla de inicio».
          </div>
          <div>
            <b>Mac</b> — en Safari: Archivo → «Añadir al Dock». En Chrome: icono de instalar en la
            barra de direcciones.
          </div>
          <div>
            <b>Android (tablet o móvil)</b> — en Chrome: menú ⋮ → «Instalar aplicación».
          </div>
          <div>
            <b>Windows</b> — en Chrome o Edge: icono de instalar en la barra de direcciones.
          </div>
          <div className="muted">
            La app se abre a pantalla completa, con su propio icono, y se actualiza sola. La cámara
            del estudio de captura funciona igual que en el navegador.
          </div>
        </div>
      </details>
      <div className="tiny" style={{ marginTop: 12 }}>
        ¿Eres paciente? Tu acceso está en la <Link href="/login">web de Ortosend</Link>.
      </div>
      <div className="sp2" />
    </div>
  );
}
