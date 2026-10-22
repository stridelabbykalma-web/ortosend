import type { Metadata, Viewport } from "next";
import { destinoSeguro } from "@/lib/navegacion";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/(auth)/actions";
import { getSessionUser } from "@/lib/auth";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

// Entrada del taller de fabricación y punto de instalación de su app: el
// manifest del taller solo se enlaza desde aquí, igual que el de clínicas en
// /equipo. Cada cosa tiene su propio sitio.
export const metadata: Metadata = {
  title: "Ortosend Taller — Acceso del taller",
  robots: { index: false },
  manifest: "/manifest-taller.webmanifest",
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Taller", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#0e6e5c" };

export default async function TallerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; next?: string }>;
}) {
  const { error, ok, next } = await searchParams;
  const dest = next ? destinoSeguro(next, "") : "";
  const user = await getSessionUser();
  if (user) redirect(user.role === "CLIENTE" ? "/panel" : dest || "/panel");
  return (
    <div className="wrap" style={{ maxWidth: 440 }}>
      <div className="sp2" />
      <div className="logo" style={{ fontSize: 28 }}>
        orto<b>send</b> <span className="tiny muted" style={{ fontWeight: 400 }}>· taller</span>
      </div>
      <div className="sp" />
      <h2>Acceso del taller</h2>
      <div className="muted">Taller de fabricación de Ortosend: entrada, diseño, fabricación, calidad y envíos.</div>
      <div className="sp" />
      <Flash error={error} ok={ok} />
      <form className="card" action={loginAction}>
        <input type="hidden" name="ambito" value="taller" />
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
      <div className="sp" />
      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Instalar como app en este equipo</summary>
        <div className="tiny" style={{ marginTop: 8, display: "grid", gap: 6 }}>
          <div>
            <b>Windows</b> — en Chrome o Edge: icono de instalar en la barra de direcciones.
          </div>
          <div>
            <b>Mac</b> — en Safari: Archivo → «Añadir al Dock». En Chrome: icono de instalar en la
            barra de direcciones.
          </div>
          <div>
            <b>Android (tablet o móvil)</b> — en Chrome: menú ⋮ → «Instalar aplicación».
          </div>
          <div>
            <b>iPhone / iPad</b> — abre esta página en Safari, toca el botón de compartir y elige
            «Añadir a pantalla de inicio».
          </div>
          <div className="muted">
            La app se abre a pantalla completa, con su propio icono, y se actualiza sola. El
            Rectificador (procesado de moldes) sigue siendo el programa aparte de los PC del taller.
          </div>
        </div>
      </details>
      <div className="tiny" style={{ marginTop: 12 }}>
        ¿Eres de una clínica? Tu app es <Link href="/equipo">ortosend.es/equipo</Link>.
      </div>
      <div className="sp2" />
    </div>
  );
}
