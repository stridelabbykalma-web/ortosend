import type { Metadata, Viewport } from "next";
import { destinoSeguro } from "@/lib/navegacion";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/(auth)/actions";
import { getSessionUser } from "@/lib/auth";
import { Flash } from "@/components/ui";
import { listaPedidos } from "@/lib/taller-pedidos";
import { Refrescar } from "@/components/taller/refrescar";
import { COLUMNAS_TALLER, PostIt, type PedidoResumen } from "@/components/taller/postits";

export const dynamic = "force-dynamic";

// Entrada del taller de fabricación y su app (el manifest del taller solo se
// enlaza desde aquí, igual que el de clínicas en /equipo). Sin sesión: la
// entrada del taller. Con la sesión de una persona del taller: los pedidos como
// post-its por columnas, en el orden en que deben salir (se actualiza sola).
export const metadata: Metadata = {
  title: "Ortosend Taller — Acceso del taller",
  robots: { index: false },
  manifest: "/manifest-taller.webmanifest",
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Taller", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#0e7490" };

export default async function TallerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; next?: string; col?: string }>;
}) {
  const { error, ok, next, col } = await searchParams;
  const dest = next ? destinoSeguro(next, "") : "";
  const user = await getSessionUser();
  if (user && user.role !== "TALLER" && user.role !== "ADMIN") redirect("/panel");
  if (user && dest && dest !== "/taller") redirect(dest);
  if (user) return <TallerMovil nombre={user.name} col={col} ok={ok} />;
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
        <input type="hidden" name="next" value={dest || "/taller"} />
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

async function TallerMovil({ nombre, col, ok }: { nombre: string; col?: string; ok?: string }) {
  const pedidos = (await listaPedidos()) as PedidoResumen[];
  const actual = COLUMNAS_TALLER.find(([k]) => k === col) ?? COLUMNAS_TALLER[0];
  const visibles = pedidos.filter(actual[2]);
  return (
    <main className="wrap" style={{ maxWidth: 560, padding: "12px 12px 40px" }}>
      <Refrescar segundos={20} />
      <div className="row between">
        <h2 style={{ margin: "4px 0" }}>Taller</h2>
        <span className="tiny">{nombre}</span>
      </div>
      {ok && <div className="note g">{ok}</div>}
      <div className="row" style={{ gap: 6, margin: "10px 0" }}>
        {COLUMNAS_TALLER.map(([k, t, esta]) => (
          <Link key={k} href={`/taller?col=${k}`} className={`btn ${k === actual[0] ? "pri" : ""}`} style={{ padding: "6px 10px" }}>
            {t} · {pedidos.filter(esta).length}
          </Link>
        ))}
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {visibles.length === 0 && <p className="muted">No hay pedidos en «{actual[1]}».</p>}
        {visibles.map((p) => (
          <PostIt key={p.id} p={p} />
        ))}
      </div>
    </main>
  );
}
