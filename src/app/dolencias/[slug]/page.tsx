import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PRICE_LABEL } from "@/lib/format";
import { DOLENCIAS, dolencia } from "@/lib/dolencias";

export function generateStaticParams() {
  return DOLENCIAS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = dolencia((await params).slug);
  if (!d) return {};
  return {
    title: d.titulo,
    description: d.descripcion,
    alternates: { canonical: `/dolencias/${d.slug}` },
    openGraph: { title: `${d.titulo} — Ortosend`, description: d.descripcion, url: `/dolencias/${d.slug}` },
  };
}

function Lista({ titulo, items, tono }: { titulo: string; items: string[]; tono?: "aviso" }) {
  return (
    <div className={`card px-lift px-dol-bloque${tono === "aviso" ? " px-dol-aviso" : ""}`}>
      <div className="px-card-t">{titulo}</div>
      <ul className="px-dol-ul">
        {items.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

export default async function DolenciaPage({ params }: { params: Promise<{ slug: string }> }) {
  const d = dolencia((await params).slug);
  if (!d) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MedicalWebPage",
    name: d.titulo,
    description: d.descripcion,
    inLanguage: "es",
    about: { "@type": "MedicalCondition", name: d.nombre },
    lastReviewed: "2026-11-04",
    url: `https://ortosend.es/dolencias/${d.slug}`,
  };

  return (
    <div className="wrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="px-sec">
        <div className="px-kicker">
          <Link href="/dolencias" style={{ color: "inherit" }}>
            Guías informativas
          </Link>
        </div>
        <h2 className="px-h2">{d.titulo}</h2>
        {d.queEs.map((p) => (
          <p className="muted px-dol-p" key={p.slice(0, 40)}>
            {p}
          </p>
        ))}
        <div className="note px-dol-nota">
          Esta guía es información general, no un diagnóstico ni una recomendación de tratamiento
          para tu caso. En el estudio —gratuito y sin compromiso— te explora el personal de la
          clínica y tu caso lo valora siempre un profesional colegiado: solo si prescribe el
          tratamiento se fabrica la plantilla, y solo entonces pagas.
        </div>
        <div className="sp" />
        <div className="grid g2">
          <Lista titulo="Cómo suele notarse" items={d.sintomas} />
          <Lista titulo="En qué puede ayudar una plantilla a medida" items={d.ayuda} />
          <Lista titulo="Qué NO hace una plantilla" items={d.noHace} />
          <Lista titulo="Consulta a tu médico sin esperar si…" items={d.consulta} tono="aviso" />
        </div>
        <div className="sp" />
        <div className="px-cta-dark row between">
          <div>
            <b style={{ fontFamily: "var(--font-sora)", fontSize: 18, color: "#fff" }}>
              ¿Te suena? Empieza por el estudio
            </b>
            <div className="px-dim" style={{ marginTop: 4 }}>
              Estudio completo de la pisada en una clínica cerca de ti. {PRICE_LABEL} todo
              incluido, y solo si un profesional colegiado lo prescribe.
            </div>
          </div>
          <Link href="/buscar" className="btn">
            Buscar clínica
          </Link>
        </div>
      </div>
    </div>
  );
}
