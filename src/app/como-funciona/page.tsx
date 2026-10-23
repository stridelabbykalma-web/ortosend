import Link from "next/link";

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
    "Solo con la prescripción firmada recibes el enlace de pago: 199,99 €, con tarjeta o Bizum, siempre a través de Ortosend en la pasarela segura de Stripe. Nunca pagarás nada en la clínica. El enlace es válido 30 días.",
  ],
  [
    "Tus plantillas",
    "Fabricamos el molde a partir de tu escaneo 3D y confeccionamos tus plantillas a mano. En 5 días laborables las recibes en casa o en tu clínica. Incluyen guía de adaptación (2-3 semanas de uso progresivo) y revisión anual.",
  ],
];

export default function ComoFunciona() {
  return (
    <div className="wrap">
      <div className="px-sec" style={{ paddingTop: 56 }}>
        <div className="px-kicker">Paso a paso</div>
        <h2 className="px-h2">Cómo funciona Ortosend</h2>
        <div className="px-tl">
          {BLOQUES.map(([t, d]) => (
            <div className="px-tl-item" key={t}>
              <div className="px-card-t">{t}</div>
              <p className="muted" style={{ marginTop: 6, maxWidth: 680 }}>
                {d}
              </p>
            </div>
          ))}
        </div>
        <div className="sp2" />
        <div className="px-cta-dark row between">
          <div>
            <b style={{ fontFamily: "var(--font-sora)", fontSize: 18, color: "#fff" }}>
              Empieza por el estudio: gratis y sin compromiso
            </b>
            <div className="px-dim" style={{ marginTop: 4 }}>
              Busca tu clínica asociada más cercana y elige la hora que te venga bien.
            </div>
          </div>
          <Link href="/buscar" className="btn">
            Buscar clínica
          </Link>
        </div>
        <div className="sp2" />
      </div>
    </div>
  );
}
