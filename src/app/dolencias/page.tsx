import Link from "next/link";
import type { Metadata } from "next";
import { DOLENCIAS } from "@/lib/dolencias";

export const metadata: Metadata = {
  title: "Guías de dolencias del pie",
  description:
    "Fascitis plantar, espolón, metatarsalgia, pie plano infantil, juanetes: qué son, cuándo consultar y en qué puede ayudar una plantilla a medida. Información sin diagnóstico.",
  alternates: { canonical: "/dolencias" },
};

export default function DolenciasPage() {
  return (
    <div className="wrap">
      <div className="px-sec">
        <div className="px-kicker">Guías informativas</div>
        <h2 className="px-h2">Dolencias del pie, explicadas con honestidad</h2>
        <p className="muted" style={{ maxWidth: 640 }}>
          Qué es cada dolencia, en qué puede ayudar una plantilla a medida y —con la misma
          claridad— en qué no. Estas guías no son un diagnóstico: en el estudio te explora y te
          valora un profesional colegiado, y si el tratamiento no está indicado, no pagas nada.
        </p>
        <div className="sp" />
        <div className="grid g2">
          {DOLENCIAS.map((d) => (
            <Link href={`/dolencias/${d.slug}`} key={d.slug} className="card px-lift px-dol-card">
              <div className="px-card-t">{d.nombre}</div>
              <div className="muted" style={{ marginTop: 6 }}>
                {d.sintomas[0]}
              </div>
              <div className="px-dol-mas">Leer la guía →</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
