import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PRICE_LABEL } from "@/lib/format";
import { DOLENCIAS, DOLENCIA_IMG, dolencia } from "@/lib/dolencias";
import { Reveal } from "@/components/ox/reveal";

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

function Bloque({ titulo, items }: { titulo: string; items: string[] }) {
  return (
    <section data-mv>
      <h3>{titulo}</h3>
      <ul className="ox-ul">
        {items.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </section>
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
    <div className="oxp">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Reveal />
      <div className="ox-wrap ox-page">
        <div className="ox-guia">
          <div>
            <h1 className="ox-h2" data-mv>
              {d.nombre}
            </h1>
            <p className="ox-lead" style={{ maxWidth: "30ch" }} data-mv>
              Qué puede hacer una plantilla a medida, y qué no.
            </p>
            <div className="ox-prose" data-mv>
              {d.queEs.map((p) => (
                <p key={p.slice(0, 40)}>{p}</p>
              ))}
            </div>
            <div className="ox-note" data-mv>
              Esta guía es información general, no un diagnóstico ni una recomendación de
              tratamiento para tu caso. En el estudio, gratuito y sin compromiso, te explora el
              personal de la clínica y tu caso lo valora siempre un profesional colegiado: solo si
              prescribe el tratamiento se fabrica la plantilla, y solo entonces pagas.
            </div>
            <div className="ox-bloques">
              <Bloque titulo="Cómo suele notarse" items={d.sintomas} />
              <Bloque titulo="En qué puede ayudar" items={d.ayuda} />
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
              <figcaption className="ox-small" style={{ marginTop: 8 }}>
                En el estudio, tu marcha se graba y se analiza con visión artificial; la valora un profesional colegiado.
              </figcaption>
            </figure>
            <div className="ox-bloques" style={{ marginTop: 0 }}>
              <Bloque titulo="Qué no hace" items={d.noHace} />
              <Bloque titulo="Ve antes al médico si…" items={d.consulta} />
            </div>
            <div style={{ marginTop: 72 }} data-mv>
              <p className="ox-lead" style={{ maxWidth: "32ch" }}>
                ¿Te suena? Empieza por el estudio: {PRICE_LABEL} todo incluido, y solo si un
                profesional colegiado lo prescribe.
              </p>
              <div className="row" style={{ gap: 14 }}>
                <Link href="/buscar" className="oxb acc">
                  Buscar una clínica
                </Link>
                <Link href="/dolencias">Todas las guías</Link>
              </div>
            </div>
          </div>
          <div>
            <figure className="ox-guia-fig ox-drift" data-mv>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={DOLENCIA_IMG[d.slug]?.src ?? "/img/rx-dorsoplantar.jpg"}
                alt={DOLENCIA_IMG[d.slug]?.alt ?? ""}
                className="ox-img"
                style={DOLENCIA_IMG[d.slug]?.pos ? { objectPosition: DOLENCIA_IMG[d.slug].pos } : undefined}
                width={1400}
                height={1867}
              />
            </figure>
            <figure className="ox-guia-mini" data-mv>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/cnc-espuma.jpg"
                alt="Fresadora CNC mecanizando un bloque de espuma técnica"
                className="ox-img"
                width={1600}
                height={1200}
                loading="lazy"
              />
            </figure>
          </div>
        </div>
      </div>
    </div>
  );
}
