import Link from "next/link";
import { PRICE_LABEL } from "@/lib/format";
import { BuscadorVivo } from "@/components/buscador-vivo";
import { CtaMovil } from "@/components/cta-movil";
import { Reveal } from "@/components/ox/reveal";
import { PlatoEstudio } from "@/components/ox/plato-estudio";
import { DolenciasLista } from "@/components/ox/dolencias-lista";
import { MapaPresiones } from "@/components/ox/mapa-presiones";
import { DOLENCIAS } from "@/lib/dolencias";

// Recibo del proceso: la fila con «val» vacío solo lleva texto.
const RECIBO: [string, [string, string][]][] = [
  ["Hoy", [["Reserva online en la clínica que elijas", "0 €"]]],
  [
    "El día de tu cita",
    [
      ["Escáner 3D de ambos pies", "45 min"],
      ["Vídeos de tu marcha y presiones plantares", "incl."],
      ["Exploración física con tests biomecánicos", "incl."],
    ],
  ],
  [
    "En 48 h laborables",
    [
      ["Valoración y firma de un profesional colegiado", "incl."],
      ["Si no está indicado, no pagas nada", "0 €"],
    ],
  ],
  [
    "Tras tu pago",
    [
      ["Fabricación a medida en nuestro taller", "5 días"],
      ["Envío a casa o recogida en tu clínica", "incl."],
      ["Guía de adaptación y ajustes sin coste", "incl."],
    ],
  ],
];

// Lo que deja medido el estudio (nombres reales; sin logos ni inventos).
const MEDIMOS: [string, string[]][] = [
  ["Escáner 3D", ["Molde digital de cada pie", "Longitud y anchura", "Altura del arco", "Talla real de calzado"]],
  ["Marcha en vídeo", ["Ángulo de paso", "Apoyo del retropié", "Línea de progresión", "Cadencia"]],
  ["Presiones plantares", ["Presiones pico por zona", "Reparto talón–antepié", "Tiempos de apoyo", "Huella estática y dinámica"]],
  ["Exploración", ["Movilidad del tobillo", "Posición del calcáneo", "Tests biomecánicos", "Fórmula digital"]],
];

const FAQ: [string, string][] = [
  [
    "¿Cuánto cuesta? ¿Hay sorpresas después?",
    "El precio es único: 199,99 €, IVA incluido. Comprende el estudio, la prescripción, la fabricación a medida, el envío, la guía de adaptación y una revisión incluida. El estudio en la clínica es gratuito: si el tratamiento no está indicado, no pagas nada.",
  ],
  [
    "¿Por qué son tan baratas siendo a medida?",
    "Porque el circuito es nuestro de punta a punta: la red de clínicas comparte el equipamiento, el taller es propio y no hay intermediarios. Por eso unas plantillas ortopédicas a medida con estudio clínico cuestan 199,99 € en vez de los 300-480 € habituales por separado. Baratas en precio, no en proceso: las pruebas y la firma colegiada son las mismas.",
  ],
  [
    "¿Cuándo y cómo pago?",
    "Solo después de que un podólogo o médico colegiado firme tu prescripción. Recibes un enlace válido 30 días y pagas online con tarjeta o Bizum, en la pasarela segura de Stripe. Nunca pagarás nada en la clínica.",
  ],
  [
    "¿Pueden hacerse el estudio los niños?",
    "Sí. Los estudios de menores de 16 años se gestionan desde la cuenta de su padre, madre o tutor, que recibe los avisos y autoriza el tratamiento. Como el pie de un niño crece rápido, en menores de 14 te avisamos cada 6 meses para revisar la plantilla en tu clínica.",
  ],
  [
    "¿Y si no puedo ir a mi cita?",
    "Puedes cambiarla o anularla desde tu panel en cualquier momento, sin coste. También te enviamos un recordatorio la víspera.",
  ],
  [
    "¿Puedo devolver las plantillas?",
    "Al ser un producto sanitario fabricado a medida para ti, no existe derecho de desistimiento (art. 103.c de la Ley de Consumidores). A cambio: los ajustes del periodo de adaptación son sin coste, cualquier prueba que haya que repetir se repite gratis y tienes las garantías legales frente a defectos de fabricación.",
  ],
  [
    "¿Tienes una clínica?",
    "Únete a la red Ortosend: te cedemos el equipamiento del estudio y te enviamos pacientes de tu zona. Escríbenos desde la página Para clínicas y te contactamos.",
  ],
];

export default function Home() {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "MedicalBusiness",
      name: "Ortosend",
      url: "https://ortosend.es",
      email: "hola@ortosend.es",
      description:
        "Plantillas ortopédicas a medida con estudio completo de la pisada en clínicas asociadas y prescripción de profesionales colegiados.",
      areaServed: "España",
      priceRange: PRICE_LABEL,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map(([q, a]) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ];

  return (
    <div className="oxp">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Reveal />
      <CtaMovil />

      {/* Escenario partido: la foto fija acompaña al hero, el recibo y las medidas */}
      <div className="ox-split">
        <div className="ox-stage">
          <figure className="ox-mapa" aria-label="Mapa de presiones plantares de los dos pies, con las zonas de carga y los datos del estudio (gráfico ilustrativo)">
            <MapaPresiones modo="mapa" />
            <figcaption>El mapa de presiones de tu pisada: la salida real del estudio</figcaption>
          </figure>
        </div>

        <div className="ox-flow">
          <section className="ox-hero" aria-label="Ortosend, plantillas a medida">
            <p className="ox-lead" data-mv>
              Plantillas a medida: {PRICE_LABEL} todo incluido.
            </p>
            <p className="ox-sub" data-mv>
              Con estudio clínico completo en una clínica cerca de ti: escáner 3D, análisis de la
              marcha y presiones plantares. Solo pagas si un profesional colegiado prescribe tu
              tratamiento.
            </p>
            <div className="ox-heroname">
              <h1 className="ox-name">ortosend</h1>
            </div>
            <div className="ox-busca" id="buscador-hero" data-mv style={{ ["--d" as string]: "0.1s" }}>
              <div className="card">
                <BuscadorVivo />
              </div>
            </div>
          </section>

          <section className="ox-recibo-sec" aria-labelledby="t-recibo">
            <h2 className="ox-h2" id="t-recibo" data-mv>
              Del estudio a tus pies
            </h2>
            <div className="ox-field" data-mv style={{ ["--d" as string]: "0.08s" }}>
              <p>
                El recorrido entero, con sus tiempos. El total solo existe si un profesional
                colegiado firma tu prescripción.
              </p>
              <div className="ox-recibo">
                {RECIBO.map(([cuando, filas]) => (
                  <div key={cuando}>
                    <h3>{cuando}</h3>
                    {filas.map(([que, val]) => (
                      <div className="ox-recibo-row" key={que}>
                        <span className="que">{que}</span>
                        <span className="dots" />
                        <span className="val">{val}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <p className="ox-small" style={{ margin: "14px 0 12px" }}>
                  Con revisión incluida: al año, o cada 6 meses en menores de 14.
                </p>
                <div className="ox-recibo-total">
                  <span>Todo incluido, IVA incluido</span>
                  <span className="val">{PRICE_LABEL}</span>
                </div>
              </div>
            </div>
          </section>

          <section aria-labelledby="t-medimos">
            <h2 className="ox-h2" id="t-medimos" data-mv>
              Lo que medimos
            </h2>
            <p data-mv>
              El estudio deja tu pisada medida, no estimada. Estas son las medidas con las que el
              profesional valora tu caso y el taller fabrica tu par.
            </p>
            <ul className="ox-names" data-mv style={{ ["--d" as string]: "0.08s" }}>
              {MEDIMOS.map(([kind, items]) => (
                <li key={kind}>
                  <span className="kind">{kind}</span>
                  {items.map((m) => (
                    <span key={m} style={{ display: "block" }}>
                      {m}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {/* El estudio: plato cuadrado con pestañas */}
      <section className="ox-plate" aria-labelledby="t-estudio">
        <div className="ox-wrap">
          <h2 className="ox-h2" id="t-estudio" data-mv>
            El estudio, en 45 minutos
          </h2>
          <PlatoEstudio />
        </div>
      </section>

      {/* Dolencias: foto fija + lista activa */}
      <section className="ox-dol" aria-labelledby="t-dol">
        <div className="ox-wrap">
          <h2 className="ox-h2" id="t-dol" data-mv>
            ¿Qué te duele?
          </h2>
          <p className="muted" style={{ maxWidth: "52ch", marginBottom: 34 }}>
            Guías honestas, sin diagnóstico: qué puede hacer una plantilla a medida por cada
            dolencia y qué no. Tu caso lo valora siempre un profesional colegiado en el estudio.
          </p>
          <DolenciasLista dolencias={DOLENCIAS.map(({ slug, nombre, sintomas }) => ({ slug, nombre, sintomas }))} />
        </div>
      </section>

      {/* La carta: precios como un menú */}
      <section className="ox-menu" aria-labelledby="t-carta">
        <div className="ox-wrap">
          <div className="ox-menu-grid">
            <div>
              <h2 className="ox-h2" id="t-carta" data-mv>
                La carta, sin letra pequeña
              </h2>
              <p className="muted" style={{ maxWidth: "26ch" }}>
                Un único precio con todo dentro, frente a lo que cuesta por separado en el circuito
                tradicional.
              </p>
              <figure className="ox-menu-fig ox-drift" data-mv>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/img/cnc-espuma.jpg"
                  alt="Fresadora CNC de sobremesa mecanizando un bloque de espuma técnica"
                  className="ox-img"
                  width={1600}
                  height={1200}
                  loading="lazy"
                />
              </figure>
            </div>
            <div className="ox-menu-cols" data-mv>
              <div className="ox-menu-group">
                <h3>Con Ortosend — {PRICE_LABEL}</h3>
                {[
                  ["Estudio completo de la pisada", "incluido", "Escáner 3D, marcha, presiones y exploración, en tu clínica."],
                  ["Prescripción colegiada", "incluida", "Firmada por podólogo o médico; sin firma, no pagas."],
                  ["Par fabricado a medida", "incluido", "Cada pie con su molde, en nuestro taller, en 5 días laborables."],
                  ["Envío y guía de adaptación", "incluidos", "A casa o a tu clínica, con pauta progresiva de 2-3 semanas."],
                  ["Ajustes de adaptación", "sin coste", "Si algo molesta, tu clínica te cita y se ajusta."],
                  ["Revisión incluida", "incluida", "Al año; cada 6 meses en menores de 14, porque el pie crece."],
                ].map(([n, p, d]) => (
                  <div className="ox-menu-item" key={n}>
                    <div className="fila">
                      <span>{n}</span>
                      <span className="p">{p}</span>
                    </div>
                    <div className="des">{d}</div>
                  </div>
                ))}
              </div>
              <div className="ox-menu-group">
                <h3>Por separado, de media</h3>
                {[
                  ["Estudio biomecánico", "50–80 €", "Precio orientativo habitual del mercado en España."],
                  ["Plantillas a medida", "250–400 €", "Según materiales y centro."],
                  ["Ajustes y revisiones", "según centro", "Con frecuencia, con coste aparte."],
                ].map(([n, p, d]) => (
                  <div className="ox-menu-item" key={n}>
                    <div className="fila">
                      <span>{n}</span>
                      <span className="p">{p}</span>
                    </div>
                    <div className="des">{d}</div>
                  </div>
                ))}
                <p className="ox-small">Rangos orientativos; varían según el centro.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ sobre campo oscuro */}
      <section className="ox-faq" aria-labelledby="t-faq">
        <div className="ox-wrap">
          <div className="ox-faq-grid">
            <div>
              <h2 className="ox-h2" id="t-faq" data-mv>
                Dudas frecuentes
              </h2>
              <ul className="ox-faq-facts" data-mv>
                <li>
                  <b>{PRICE_LABEL}</b> — precio único, IVA incluido
                </li>
                <li>
                  <b>45 minutos</b> — dura el estudio, gratuito y sin compromiso
                </li>
                <li>
                  <b>5 días laborables</b> — de tu pago a tus plantillas
                </li>
              </ul>
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <div className="resp">
                    {a}
                    {q.includes("clínica") && (
                      <>
                        {" "}
                        <Link href="/para-clinicas">Para clínicas</Link>
                      </>
                    )}
                  </div>
                </details>
              ))}
              <div style={{ marginTop: 30 }}>
                <Link href="/buscar" className="oxb light">
                  Buscar una clínica
                </Link>
              </div>
            </div>
            <div className="ox-faq-figs" data-mv>
              <figure className="alta ox-drift">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/img/rx-oblicua.jpg"
                  alt="Radiografía de un pie en proyección oblicua"
                  className="ox-img"
                  width={1077}
                  height={2029}
                  loading="lazy"
                />
              </figure>
              <figure className="cuad">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/img/captura-movimiento.jpg"
                  alt="Estudio de captura de movimiento: el esqueleto digital en pantalla"
                  className="ox-img"
                  width={1600}
                  height={1071}
                  loading="lazy"
                  style={{ objectFit: "cover" }}
                />
              </figure>
            </div>
          </div>
        </div>
      </section>

      {/* Cierre casi vacío */}
      <section className="ox-cta" aria-label="Empezar">
        <div className="ox-wrap">
          <h2>
            Si el profesional no firma tu prescripción, el estudio no te cuesta <b>nada</b>.
          </h2>
          <Link href="/buscar" className="oxb acc">
            Buscar una clínica cerca
          </Link>
        </div>
      </section>
    </div>
  );
}
