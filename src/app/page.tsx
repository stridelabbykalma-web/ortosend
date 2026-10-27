import Link from "next/link";
import { PRICE_LABEL } from "@/lib/format";
import { BuscadorVivo } from "@/components/buscador-vivo";

// Iconos lineales propios (trazo 1.5), sin librerías externas.
const ICO = {
  calendario: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4M8.5 14h2.5M13.5 14h2M8.5 17h2.5" />
    </svg>
  ),
  escaner: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M9.5 3.5c3 0 4.5 2.4 4.5 5.2 0 2.2-.9 3.4-.9 5.3 0 1.6.6 2.4.6 3.9 0 1.7-1.3 2.6-2.7 2.6-1.6 0-2.6-1.1-2.9-2.8-.4-2.3-1.6-3.2-1.6-6.3 0-4 1-7.9 3-7.9Z" />
      <path d="M17 7h4M19 5v4" opacity=".9" />
    </svg>
  ),
  firma: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 20c3-.5 3.5-5 5.5-5s1 3 2.5 3 1.8-2 3-2 1 1.5 2.5 1.5H20" />
      <path d="m13.5 10 5-5a1.77 1.77 0 1 1 2.5 2.5l-5 5-3.4.9.9-3.4Z" />
    </svg>
  ),
  caja: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16V8Z" />
      <path d="M3.5 8 12 12.5m0 0L20.5 8M12 12.5v8" />
    </svg>
  ),
  check: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  ),
};

const PASOS: [React.ReactNode, string, string, string][] = [
  [ICO.calendario, "01", "Reserva tu cita", "Gratis y sin compromiso, en la clínica asociada que elijas."],
  [ICO.escaner, "02", "Estudio completo", "Escaneo 3D de ambos pies, vídeos de tu marcha y presiones plantares. 45 minutos."],
  [ICO.firma, "03", "Prescripción y pago", "Un profesional colegiado valida tu caso. Solo entonces pagas, online y de forma segura."],
  [ICO.caja, "04", "Recibe tus plantillas", "En 5 días laborables, en casa o en tu clínica. Revisión anual incluida."],
];

const INCLUYE: [string, string][] = [
  ["Escáner 3D", "Molde digital exacto de ambos pies, sin escayolas ni esperas."],
  ["Análisis de la marcha", "Vídeos de cómo caminas, analizados con apoyo de visión artificial y valorados por un profesional."],
  ["Presiones plantares", "Baropodometría estática y dinámica: cómo pisas de verdad, paso a paso."],
  ["Exploración completa", "Cuestionario clínico y exploración física con tests biomecánicos."],
];

const FAQ: [string, string][] = [
  [
    "¿Cuánto cuesta? ¿Hay sorpresas después?",
    "El precio es único: 199,99 €, IVA incluido. Comprende el estudio, la prescripción, la fabricación a medida, el envío, la guía de adaptación y una revisión anual. El estudio en la clínica es gratuito: si el tratamiento no está indicado, no pagas nada.",
  ],
  [
    "¿Cuándo y cómo pago?",
    "Solo después de que un podólogo o médico colegiado firme tu prescripción. Recibes un enlace válido 30 días y pagas online con tarjeta o Bizum, en la pasarela segura de Stripe. Nunca pagarás nada en la clínica.",
  ],
  [
    "¿Pueden hacerse el estudio los niños?",
    "Sí. Los estudios de menores de 16 años se gestionan desde la cuenta de su padre, madre o tutor, que recibe los avisos y autoriza el tratamiento. Al cumplir los 16, el paciente pasa a gestionar su propia cuenta.",
  ],
  [
    "¿Y si no puedo ir a mi cita?",
    "Puedes cambiarla o anularla desde tu panel en cualquier momento, sin coste. También te enviamos un recordatorio la víspera.",
  ],
  [
    "¿Puedo devolver las plantillas?",
    "Al ser un producto sanitario fabricado a medida para ti, no existe derecho de desistimiento (art. 103.c de la Ley de Consumidores). A cambio: los ajustes del periodo de adaptación son sin coste, cualquier prueba que haya que repetir se repite gratis y tienes las garantías legales frente a defectos de fabricación.",
  ],
];

export default function Home() {
  return (
    <>
      <div className="px-hero">
        <div className="wrap">
          <h1>
            Plantillas a medida,
            <br />
            sin sorpresas
          </h1>
          <p className="px-sub">
            Estudio completo de la pisada en una clínica cerca de ti — escáner 3D, análisis de la
            marcha y baropodometría. Solo pagas si un profesional colegiado prescribe tu
            tratamiento.
          </p>
          <div className="px-price">
            <b>{PRICE_LABEL}</b>
            <span>precio único · todo incluido</span>
          </div>
          <div className="px-trust">
            <span>{ICO.check} Producto sanitario a medida (Reglamento UE 2017/745)</span>
            <span>{ICO.check} Prescrito siempre por profesionales colegiados</span>
            <span>{ICO.check} Estudio gratuito y sin compromiso</span>
          </div>
          <div className="px-search">
            <BuscadorVivo />
          </div>
        </div>
      </div>

      <div className="wrap">
        <div className="px-sec">
          <div className="px-kicker">Así de simple</div>
          <h2 className="px-h2">De la cita a tus plantillas en cuatro pasos</h2>
          <div className="grid g4">
            {PASOS.map(([ico, n, t, d]) => (
              <div className="card px-lift px-step" key={n}>
                <span className="n">PASO {n}</span>
                <div className="px-ico">{ico}</div>
                <div className="px-card-t">{t}</div>
                <div className="muted" style={{ marginTop: 6 }}>
                  {d}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-sec">
          <div className="px-kicker">El estudio</div>
          <h2 className="px-h2">Tecnología de clínica, mirada de especialista</h2>
          <div className="grid g4">
            {INCLUYE.map(([t, d]) => (
              <div className="card px-lift" key={t}>
                <div className="px-card-t">{t}</div>
                <div className="muted" style={{ marginTop: 6 }}>
                  {d}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-sec">
          <div className="px-band">
            <div>
              <b>Sin prescripción, no pagas</b>
              <div className="px-dim">La decisión clínica siempre es de un profesional colegiado.</div>
            </div>
            <div>
              <b>5 días laborables</b>
              <div className="px-dim">De tu pago a tus plantillas, fabricadas en nuestro taller.</div>
            </div>
            <div>
              <b>Revisión anual incluida</b>
              <div className="px-dim">Y guía de adaptación progresiva de 2-3 semanas.</div>
            </div>
            <div>
              <b>Repeticiones sin coste</b>
              <div className="px-dim">Si una prueba del estudio debe repetirse, no pagas nada más.</div>
            </div>
          </div>
        </div>

        <div className="px-sec">
          <div className="px-kicker">Dudas frecuentes</div>
          <h2 className="px-h2">Lo que nos preguntan antes de empezar</h2>
          <div className="px-faq">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <div className="px-a">{a}</div>
              </details>
            ))}
          </div>
        </div>

        <div className="px-sec">
          <div className="px-cta-dark row between">
            <div>
              <b style={{ fontFamily: "var(--font-sora)", fontSize: 18, color: "#fff" }}>
                ¿Tienes una clínica?
              </b>
              <div className="px-dim" style={{ marginTop: 4 }}>
                Únete a la red Ortosend: te cedemos el equipamiento y te enviamos pacientes.
              </div>
            </div>
            <Link href="/para-clinicas" className="btn">
              Asóciate
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
