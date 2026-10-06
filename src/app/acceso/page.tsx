import type { Metadata } from "next";
import Link from "next/link";
import { Flash } from "@/components/ui";
import { leerAccesoPendiente } from "@/lib/auth";
import { CODIGO_INTENTOS, CODIGO_MINUTOS } from "@/lib/consent/tokens";
import { crearCuentaAction, solicitarCodigoAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false }, title: "Crea tu contraseña · Ortosend" };

// Acceso al perfil del paciente: DNI + móvil → código por WhatsApp → contraseña.
export default async function AccesoPage({ searchParams }: { searchParams: Promise<{ paso?: string; error?: string }> }) {
  const { paso, error } = await searchParams;
  const pendiente = paso === "codigo" ? await leerAccesoPendiente() : null;
  return (
    <div className="wrap" style={{ maxWidth: 460 }}>
      <div className="sp2" />
      <h2>Crea tu contraseña</h2>
      <div className="sp" />
      <Flash error={error} />
      {!pendiente ? (
        <form className="card" action={solicitarCodigoAction}>
          <p className="muted">
            Escribe tu DNI o NIE y tu móvil. Si tu profesional ya ha preparado tu perfil, te enviaremos un código
            de 6 cifras por WhatsApp. Si gestionas el perfil de un menor, usa <b>tus</b> datos.
          </p>
          <label htmlFor="dni">DNI o NIE</label>
          <input id="dni" name="dni" autoComplete="off" autoCapitalize="characters" placeholder="12345678Z" required />
          <label htmlFor="telefono">Móvil</label>
          <input id="telefono" name="telefono" type="tel" autoComplete="tel" placeholder="+34 600 112 233" required />
          <div className="sp" />
          <button type="submit" className="pri wfull">
            Enviarme el código
          </button>
        </form>
      ) : (
        <form className="card" action={crearCuentaAction}>
          <p className="muted">
            Si los datos son correctos, te acabamos de enviar un código por WhatsApp al {pendiente.telefono}. Caduca
            en {CODIGO_MINUTOS} minutos y tienes {CODIGO_INTENTOS} intentos.
          </p>
          <label htmlFor="codigo">Código</label>
          <input id="codigo" name="codigo" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required />
          <label htmlFor="password">Contraseña (mínimo 10 caracteres)</label>
          <input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required />
          <label htmlFor="password2">Repite la contraseña</label>
          <input id="password2" name="password2" type="password" minLength={10} autoComplete="new-password" required />
          <div className="sp" />
          <button type="submit" className="pri wfull">
            Crear mi contraseña
          </button>
          <div className="tiny" style={{ marginTop: 8 }}>
            ¿No te ha llegado? <Link href="/acceso">Vuelve a pedirlo</Link> (espera un minuto entre envíos).
          </div>
        </form>
      )}
      <div className="sp" />
      <div className="tiny">
        ¿Ya tienes contraseña? <Link href="/login">Entra aquí</Link>.
      </div>
    </div>
  );
}
