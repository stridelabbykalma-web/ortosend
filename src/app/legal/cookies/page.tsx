// Política de cookies (art. 22.2 LSSI): qué usamos y cómo se controla.
import { EMPRESA, FECHA_TEXTOS } from "@/lib/legal";

export default function Cookies() {
  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <div className="sp2" />
      <h2>Política de cookies</h2>
      <div className="sp" />
      <div className="card muted" style={{ lineHeight: 1.7 }}>
        <p>
          Este sitio, titularidad de {EMPRESA.razonSocial}, utiliza únicamente las cookies y
          tecnologías siguientes:
        </p>
        <table style={{ margin: "10px 0" }}>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Finalidad</th>
              <th>Duración</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>ortosend_session</td>
              <td>Propia · técnica (exenta de consentimiento)</td>
              <td>Mantener tu sesión iniciada de forma segura</td>
              <td>30 días</td>
            </tr>
            <tr>
              <td>Preferencia de cookies</td>
              <td>Propia · técnica (almacenamiento local)</td>
              <td>Recordar tu elección sobre esta política</td>
              <td>Persistente</td>
            </tr>
            <tr>
              <td>Cookies de Google Maps</td>
              <td>De terceros (Google) · solo si las aceptas</td>
              <td>Mostrar el mapa de clínicas; Google puede recibir tu IP y fijar sus cookies</td>
              <td>Según Google</td>
            </tr>
          </tbody>
        </table>
        <p>
          El <b>mapa de Google no se carga</b> hasta que aceptas las cookies de terceros — puedes
          usar todo el buscador escribiendo tu población o código postal sin aceptarlas. Puedes
          cambiar tu elección borrando los datos del sitio en tu navegador, y gestionar o eliminar
          cookies desde la configuración del propio navegador. Más información sobre las cookies de
          Google: policies.google.com/technologies/cookies.
        </p>
        <p>
          No utilizamos cookies de publicidad ni de analítica de terceros. Si esto cambiara,
          actualizaremos esta política y volveremos a pedirte consentimiento.
        </p>
        <p className="tiny">Última actualización: {FECHA_TEXTOS}.</p>
      </div>
    </div>
  );
}
