// Campo trampa (invisible para las personas) y, si hay clave, el widget de Cloudflare Turnstile.
// Va dentro de cada formulario público; lo comprueba `pareceBot` en el servidor.
import Script from "next/script";
import { CAMPO_TRAMPA } from "@/lib/antibot";

export function AntiBot() {
  const sitio = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return (
    <>
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          No rellenes este campo
          <input type="text" name={CAMPO_TRAMPA} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      {sitio && (
        <>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
          <div className="cf-turnstile" data-sitekey={sitio} data-language="es" style={{ margin: "10px 0" }} />
        </>
      )}
    </>
  );
}
