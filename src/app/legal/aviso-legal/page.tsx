// Aviso legal (art. 10 LSSI-CE): identificación del titular del sitio.
import { EMPRESA, FECHA_TEXTOS } from "@/lib/legal";

export default function AvisoLegal() {
  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <div className="sp2" />
      <h2>Aviso legal</h2>
      <div className="sp" />
      <div className="card muted" style={{ lineHeight: 1.7 }}>
        <p>
          En cumplimiento del artículo 10 de la Ley 34/2002, de Servicios de la Sociedad de la
          Información y de Comercio Electrónico (LSSI-CE), se informa de que el titular de este
          sitio web es:
        </p>
        <p>
          <b>{EMPRESA.razonSocial}</b> ({EMPRESA.nombreComercial})
          <br />
          NIF: {EMPRESA.cif}
          <br />
          Domicilio: {EMPRESA.domicilio}
          <br />
          {EMPRESA.registro}
          <br />
          Contacto: <a href={`mailto:${EMPRESA.email}`}>{EMPRESA.email}</a>
        </p>
        <p>
          <b>Objeto.</b> Este sitio permite reservar un estudio de la pisada en clínicas asociadas
          y, si un profesional sanitario colegiado lo prescribe, contratar la fabricación de
          plantillas ortopédicas a medida. Las plantillas son productos sanitarios a medida
          fabricados bajo prescripción de un profesional facultado.
        </p>
        <p>
          <b>Condiciones de uso.</b> El acceso al sitio atribuye la condición de usuario e implica
          la aceptación de este aviso legal, de la{" "}
          <a href="/legal/privacidad">política de privacidad</a>, de la{" "}
          <a href="/legal/cookies">política de cookies</a> y de los{" "}
          <a href="/legal/terminos">términos de venta</a>. El usuario se compromete a hacer un uso
          diligente del sitio y a facilitar información veraz en los formularios.
        </p>
        <p>
          <b>Propiedad intelectual.</b> Los contenidos de este sitio (textos, diseño, logotipos,
          software) pertenecen a su titular o cuentan con licencia de uso, y no pueden reproducirse
          sin autorización. La cartografía se muestra mediante Google Maps conforme a sus
          condiciones.
        </p>
        <p>
          <b>Responsabilidad.</b> El titular no responde de los daños derivados del mal uso del
          sitio ni de la información introducida por terceros, y trabaja por mantener el servicio
          disponible sin poder garantizar la ausencia de interrupciones. La información orientativa
          que la plataforma genera automáticamente sobre los estudios no constituye diagnóstico:
          toda decisión clínica corresponde a un profesional sanitario colegiado.
        </p>
        <p>
          <b>Legislación aplicable.</b> La relación con los usuarios se rige por la legislación
          española. Para consumidores, serán competentes los juzgados de su domicilio.
        </p>
        <p className="tiny">Última actualización: {FECHA_TEXTOS}.</p>
      </div>
    </div>
  );
}
