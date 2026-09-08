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
    "Solo con la prescripción firmada recibes el enlace de pago: 199,99 €, con tarjeta o Bizum, siempre a través de Ortosend. Nunca pagarás nada en la clínica. El enlace es válido 30 días.",
  ],
  [
    "Tus plantillas",
    "Fabricamos el molde a partir de tu escaneo 3D y confeccionamos tus plantillas a mano. En 5 días laborables las recibes en casa o en tu clínica. Incluyen guía de adaptación (2-3 semanas de uso progresivo) y revisión anual.",
  ],
];

export default function ComoFunciona() {
  return (
    <div className="wrap">
      <div className="sp2" />
      <h2>Cómo funciona Ortosend</h2>
      <div className="sp" />
      <div className="grid g2">
        {BLOQUES.map(([t, d]) => (
          <div className="card" key={t}>
            <b>{t}</b>
            <p className="muted" style={{ marginTop: 6 }}>
              {d}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
