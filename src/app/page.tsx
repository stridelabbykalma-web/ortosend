import Link from "next/link";
import { PRICE_LABEL } from "@/lib/format";
import { BuscadorVivo } from "@/components/buscador-vivo";

const PASOS: [string, string][] = [
  ["1. Reserva tu cita", "Gratis y sin compromiso, en la clínica que elijas."],
  ["2. Estudio completo", "Escaneo 3D, vídeos de marcha y presiones plantares."],
  [
    "3. Prescripción y pago",
    "Un profesional colegiado valida tu caso. Solo entonces pagas, online y de forma segura.",
  ],
  ["4. Recibe tus plantillas", "En 5 días laborables, en casa o en tu clínica. Revisión anual incluida."],
];

export default function Home() {
  return (
    <div className="wrap">
      <div className="hero">
        <h1>Plantillas a medida, sin sorpresas</h1>
        <p>
          Estudio completo de la pisada en una clínica cerca de ti — escáner 3D, análisis de la
          marcha y baropodometría. Solo pagas si un profesional colegiado prescribe tu tratamiento.
        </p>
        <div className="price">
          <b>{PRICE_LABEL}</b>
          <span className="muted">precio único, todo incluido</span>
        </div>
        <BuscadorVivo />
      </div>
      <div className="grid g4">
        {PASOS.map(([t, d]) => (
          <div className="card" key={t}>
            <b style={{ fontFamily: "var(--font-sora)", fontSize: 14 }}>{t}</b>
            <div className="muted" style={{ marginTop: 6 }}>
              {d}
            </div>
          </div>
        ))}
      </div>
      <div className="sp2" />
      <div className="card row between">
        <div>
          <b style={{ fontFamily: "var(--font-sora)" }}>¿Tienes una clínica?</b>
          <div className="muted">
            Únete a la red Ortosend: te cedemos el equipamiento y te enviamos pacientes.
          </div>
        </div>
        <Link href="/para-clinicas" className="btn">
          Asóciate
        </Link>
      </div>
    </div>
  );
}
