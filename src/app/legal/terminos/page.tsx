// Términos de venta del servicio y del producto sanitario a medida.
// Pendiente de revisión por abogado.
import { EMPRESA, FECHA_TEXTOS } from "@/lib/legal";
import { PRICE_LABEL } from "@/lib/format";

export default function Terminos() {
  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <div className="sp2" />
      <h2>Términos de venta</h2>
      <div className="sp" />
      <div className="card muted" style={{ lineHeight: 1.7 }}>
        <p>
          <b>1. Quién vende.</b> {EMPRESA.razonSocial} ({EMPRESA.nombreComercial}), NIF{" "}
          {EMPRESA.cif}, {EMPRESA.domicilio} — <a href={`mailto:${EMPRESA.email}`}>{EMPRESA.email}</a>.
        </p>
        <p>
          <b>2. El servicio.</b> (a) El <b>estudio de la pisada</b> en una clínica asociada es{" "}
          <b>gratuito y sin compromiso</b>. (b) Un profesional sanitario colegiado valora el
          estudio; <b>solo si firma la prescripción</b> se genera la posibilidad de compra. Si el
          tratamiento no está indicado, se te comunica y no pagas nada. (c) Con la prescripción
          firmada recibes un enlace de pago válido durante <b>30 días</b>; el pago se realiza
          siempre a través de {EMPRESA.nombreComercial} (tarjeta o Bizum) — las clínicas nunca
          cobran al paciente.
        </p>
        <p>
          <b>3. Precio.</b> {PRICE_LABEL}, IVA incluido, precio único que comprende el estudio, la
          prescripción, la fabricación a medida, el envío (a domicilio o a tu clínica), la guía de
          adaptación y una revisión anual. Recibirás factura por medios electrónicos.
        </p>
        <p>
          <b>4. Producto sanitario a medida.</b> Las plantillas se fabrican individualmente a
          partir de tu estudio y bajo prescripción de un profesional facultado, como producto
          sanitario a medida (Reglamento (UE) 2017/745). Plazo de entrega: <b>5 días laborables</b>{" "}
          desde el pago, salvo incidencias que se te comunicarían.
        </p>
        <p>
          <b>5. Derecho de desistimiento.</b> Al tratarse de un bien{" "}
          <b>confeccionado conforme a tus especificaciones y claramente personalizado</b>, no
          existe derecho de desistimiento (art. 103.c del Real Decreto Legislativo 1/2007, Ley
          General para la Defensa de los Consumidores y Usuarios). Quedas informado de ello antes
          del pago.
        </p>
        <p>
          <b>6. Adaptación, incidencias y garantía.</b> La adaptación es progresiva (2-3 semanas).
          Si una prueba del estudio debe repetirse, se repite <b>sin coste</b>. Los ajustes del
          periodo de adaptación y los defectos de fabricación se resuelven sin coste conforme al
          protocolo de incidencias; además dispones de las garantías legales frente a faltas de
          conformidad del producto. Nada de lo anterior limita tus derechos como consumidor.
        </p>
        <p>
          <b>7. Cuenta y uso.</b> El seguimiento del tratamiento se hace desde tu panel personal.
          Eres responsable de custodiar tu contraseña; los documentos clínicos requieren
          re-confirmación de identidad para su consulta.
        </p>
        <p>
          <b>8. Atención al cliente y reclamaciones.</b> {EMPRESA.email}. Ley española; para
          consumidores, juzgados de tu domicilio. Plataforma europea de resolución de litigios:
          ec.europa.eu/consumers/odr.
        </p>
        <p className="tiny">Última actualización: {FECHA_TEXTOS}. Pendiente de revisión final por asesoría jurídica.</p>
      </div>
    </div>
  );
}
