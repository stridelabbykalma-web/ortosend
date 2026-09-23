// Política de privacidad (arts. 13-14 RGPD y LOPDGDD), específica del
// funcionamiento real de la plataforma. Pendiente de revisión por abogado.
import { CONSENT_VERSION, EMPRESA, FECHA_TEXTOS } from "@/lib/legal";
import { EDAD_MAYORIA_SALUD } from "@/lib/edad";

export default function Privacidad() {
  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <div className="sp2" />
      <h2>Política de privacidad</h2>
      <div className="sp" />
      <div className="card muted" style={{ lineHeight: 1.7 }}>
        <p>
          <b>1. Responsable del tratamiento.</b> {EMPRESA.razonSocial} ({EMPRESA.nombreComercial}),
          NIF {EMPRESA.cif}, {EMPRESA.domicilio}. Contacto en materia de protección de datos:{" "}
          <a href={`mailto:${EMPRESA.email}`}>{EMPRESA.email}</a>. Las clínicas asociadas que
          realizan el estudio actúan como encargadas del tratamiento por cuenta de{" "}
          {EMPRESA.nombreComercial}, en virtud del contrato de tratamiento de datos suscrito con
          cada una.
        </p>
        <p>
          <b>2. Qué datos tratamos.</b> (a) <i>Identificativos y de contacto</i>: nombre, DNI en su
          caso, fecha de nacimiento, teléfono, email, dirección de entrega. (b){" "}
          <i>Datos de salud</i> (categoría especial, art. 9 RGPD), recogidos durante el estudio en
          la clínica: motivo de consulta y cuestionario clínico, exploración física y tests
          biomecánicos, <b>vídeos de tu forma de caminar y fotografías de tus pies</b>, análisis de
          presiones plantares, escaneo de la huella, prescripción y documentación clínica asociada.
          (c) <i>Ubicación puntual</i>: si autorizas la geolocalización en el buscador, usamos tus
          coordenadas solo para mostrarte las clínicas cercanas; no se almacenan. (d){" "}
          <i>Datos de uso y facturación</i>: estado del tratamiento, pagos e historial de
          comunicaciones del servicio.
        </p>
        <p>
          <b>3. Para qué y con qué base legal.</b> (a) Prestar el servicio: gestionar tu cita, el
          estudio, la valoración clínica, la fabricación y entrega de tus plantillas y la revisión
          anual — base: ejecución del contrato y, para los datos de salud, tu{" "}
          <b>consentimiento explícito</b> (art. 9.2.a RGPD), que puedes retirar en cualquier
          momento sin efectos retroactivos. (b) Avisos del servicio por WhatsApp o email
          (confirmaciones, recordatorios, estado del pedido): ejecución del contrato; los mensajes
          nunca incluyen contenido clínico, solo avisos y enlaces a tu panel privado. (c)
          Obligaciones legales sanitarias, fiscales y de consumo. No usamos tus datos para
          publicidad ni los vendemos a terceros.
        </p>
        <p>
          <b>4. Análisis automatizado de apoyo.</b> La plataforma genera de forma automática
          mediciones y hallazgos <b>orientativos</b> a partir de los vídeos y fotos del estudio
          (puntos de referencia corporales, ángulos, informe preliminar de marcha). El análisis de
          imagen se ejecuta en el propio dispositivo de captura y su resultado es una herramienta
          de apoyo: <b>ninguna decisión con efectos para ti se toma de forma automatizada</b> — la
          valoración, el diagnóstico y la prescripción corresponden siempre a un profesional
          sanitario colegiado (art. 22 RGPD).
        </p>
        <p>
          <b>5. Menores.</b> Los estudios de menores de {EDAD_MAYORIA_SALUD} años se gestionan a
          través de la cuenta de su padre, madre o tutor legal, que otorga los consentimientos en su
          nombre y es quien recibe los avisos del servicio. Al cumplir los {EDAD_MAYORIA_SALUD} años
          (edad a partir de la cual el paciente decide sobre su salud, art. 9 de la Ley 41/2002),
          enviamos al email propio del menor —facilitado por su tutor— un enlace para que cree su
          contraseña y confirme su email y su móvil; desde ese momento <b>solo el propio paciente
          accede a su expediente</b> y su tutor deja de tener acceso, de lo que se le informa. Si no
          disponemos del email del menor, se lo pedimos a su tutor. Los menores de 14 años no
          pueden consentir por sí mismos el tratamiento de sus datos.
        </p>
        <p>
          <b>6. Destinatarios y encargados.</b> Tus datos se alojan en la Unión Europea
          (Frankfurt). Prestadores que tratan datos por nuestra cuenta con contrato del art. 28
          RGPD: <b>Vercel Inc.</b> (alojamiento de la aplicación) y <b>Neon Inc.</b> (base de
          datos), ambos con infraestructura en la UE y garantías de transferencia (cláusulas
          contractuales tipo / EU-U.S. Data Privacy Framework) para el soporte desde EE. UU.;
          las <b>clínicas asociadas</b> donde se realiza tu estudio; y, cuando se activen, el
          proveedor de pagos (Stripe), de mensajería (WhatsApp Business a través de un proveedor
          autorizado — a Meta solo llega tu número y el aviso, nunca contenido clínico), de
          almacenamiento de archivos clínicos (en región UE), de envíos y de email. El buscador de
          la portada utiliza <b>Google Maps</b> (previa aceptación de cookies) y el geocodificador
          de <b>OpenStreetMap/Nominatim</b>, que recibe únicamente la población o código postal
          buscado, sin ningún dato que te identifique.
        </p>
        <p>
          <b>7. Plazos de conservación.</b> La documentación clínica (estudio, prescripción) se
          conserva un mínimo de <b>5 años</b> conforme a la normativa de documentación clínica; los
          datos de facturación, los plazos fiscales; el resto, mientras dure la relación y los
          plazos de prescripción de responsabilidades. Después se suprimen o anonimizan.
        </p>
        <p>
          <b>8. Seguridad.</b> Cifrado en tránsito, contraseñas cifradas, acceso restringido por
          rol (cada clínica solo accede a sus casos; el taller no accede a tu historia, solo a la
          orden de trabajo), <b>registro de accesos a los datos de salud</b>, y re-autenticación
          para consultar documentos clínicos. En caso de brecha de seguridad con riesgo para tus
          derechos, la notificaremos a la AEPD en 72 horas y te informaremos cuando proceda.
        </p>
        <p>
          <b>9. Tus derechos.</b> Puedes ejercer los derechos de acceso, rectificación, supresión,
          limitación, portabilidad y oposición, y retirar tus consentimientos, escribiendo a{" "}
          <a href={`mailto:${EMPRESA.email}`}>{EMPRESA.email}</a> (adjunta un medio de
          identificación). También puedes reclamar ante la Agencia Española de Protección de Datos
          (aepd.es). La supresión no alcanza a la documentación clínica que la ley obliga a
          conservar durante su plazo.
        </p>
        <p className="tiny">
          Última actualización: {FECHA_TEXTOS}. Versión de consentimientos vigente: {CONSENT_VERSION}. Texto
          pendiente de revisión final por asesoría jurídica.
        </p>
      </div>
    </div>
  );
}
