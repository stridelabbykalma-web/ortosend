import Link from "next/link";
import { Reveal } from "@/components/ox/reveal";
import { PRICE_LABEL } from "@/lib/format";

const BLOQUES: [string, string][] = [
  [
    "El estudio",
    "En tu clínica asociada te hacen un estudio completo: escaneo 3D de ambos pies, cuestionario y exploración física, vídeos de tu marcha desde atrás, de frente, de lado y en plano general, y análisis de presiones plantares. Dura unos 45 minutos. Trae tu calzado habitual.",
  ],
  [
    "La prescripción",
    "Un podólogo o médico colegiado — de tu clínica o de nuestro equipo — valora tu estudio y firma tu prescripción, explicando qué necesitas y por qué. Si necesita aclarar algo, te llamará. Y si no está indicado el tratamiento, te lo diremos con la misma claridad: no pagas nada.",
  ],
  [
    "El pago",
    `Solo con la prescripción firmada recibes el enlace de pago: ${PRICE_LABEL}, con tarjeta o Bizum, siempre a través de Ortosend en la pasarela segura de Stripe. Nunca pagarás nada en la clínica. El enlace es válido 30 días.`,
  ],
  [
    "Tus plantillas",
    "Fabricamos el molde a partir de tu escaneo 3D y confeccionamos tus plantillas a mano. En 5 días laborables las recibes en casa o en tu clínica. Incluyen guía de adaptación (2-3 semanas de uso progresivo) y revisión incluida.",
  ],
];

export default function ComoFunciona() {
  return (
    <div className="oxp">
      <Reveal />
      <div className="ox-wrap ox-page">
        <div className="ox-guia">
          <div>
            <h1 className="ox-h2" data-mv>
              Cómo funciona
            </h1>
            <p className="ox-lead" style={{ maxWidth: "34ch" }} data-mv>
              Del estudio en tu clínica a las plantillas en tu casa, con una regla fija: sin firma
              colegiada, no pagas.
            </p>
            <div className="ox-bloques">
              {BLOQUES.slice(0, 2).map(([t, d]) => (
                <section key={t} data-mv>
                  <h3>{t}</h3>
                  <p className="ox-prose">{d}</p>
                </section>
              ))}
            </div>
            <figure className="ox-band-img ox-drift" data-mv>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/captura-movimiento.jpg"
                alt="Estudio de captura de movimiento: la marcha convertida en un esqueleto digital"
                className="ox-img"
                width={1600}
                height={1071}
                loading="lazy"
              />
            </figure>
            <div className="ox-bloques" style={{ marginTop: 0 }}>
              {BLOQUES.slice(2).map(([t, d]) => (
                <section key={t} data-mv>
                  <h3>{t}</h3>
                  <p className="ox-prose">{d}</p>
                </section>
              ))}
            </div>
            <div style={{ marginTop: 64 }} data-mv>
              <p className="ox-lead" style={{ maxWidth: "30ch" }}>
                Empieza por el estudio: gratis y sin compromiso.
              </p>
              <Link href="/buscar" className="oxb acc">
                Buscar una clínica cerca
              </Link>
            </div>
          </div>
          <div>
            <figure className="ox-guia-fig ox-drift" data-mv>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/cnc-espuma.jpg"
                alt="Fresadora CNC mecanizando un bloque de espuma técnica, como las de nuestro taller"
                className="ox-img"
                width={1600}
                height={1200}
              />
            </figure>
            <figure className="ox-guia-mini" data-mv>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/rx-lateral.jpg"
                alt="Radiografía lateral de un pie"
                className="ox-img"
                width={1920}
                height={962}
                loading="lazy"
              />
            </figure>
          </div>
        </div>
      </div>
    </div>
  );
}
