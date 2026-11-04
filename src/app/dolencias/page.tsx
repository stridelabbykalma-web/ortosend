import Link from "next/link";
import type { Metadata } from "next";
import { DOLENCIAS } from "@/lib/dolencias";
import { Reveal } from "@/components/ox/reveal";

export const metadata: Metadata = {
  title: "Guías de dolencias del pie",
  description:
    "Fascitis plantar, espolón, metatarsalgia, pie plano infantil, juanetes: qué son, cuándo consultar y en qué puede ayudar una plantilla a medida. Información sin diagnóstico.",
  alternates: { canonical: "/dolencias" },
};

export default function DolenciasPage() {
  return (
    <div className="oxp">
      <Reveal />
      <div className="ox-wrap ox-page">
        <div className="ox-guia">
          <div>
            <h1 className="ox-h2" data-mv>
              Guías de dolencias
            </h1>
            <p className="ox-lead" style={{ maxWidth: "36ch" }} data-mv>
              Qué puede hacer una plantilla a medida por cada dolencia y, con la misma claridad, qué
              no.
            </p>
            <p style={{ maxWidth: "60ch" }}>
              Estas guías no son un diagnóstico: en el estudio te explora el personal de la clínica
              y te valora siempre un profesional colegiado. Si el tratamiento no está indicado, no
              pagas nada.
            </p>
            <ul className="ox-indice" data-mv>
              {DOLENCIAS.map((d, k) => (
                <li key={d.slug} data-mv style={{ ["--d" as string]: `${k * 0.06}s` }}>
                  <Link href={`/dolencias/${d.slug}`}>
                    <span>{d.nombre}</span>
                    <span className="peek">{d.sintomas[0]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <figure className="ox-guia-fig ox-drift" data-mv>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/rx-dorsoplantar.jpg"
                alt="Radiografía dorsoplantar de un pie"
                className="ox-img"
                width={1061}
                height={2431}
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
            <figure className="ox-guia-mini" data-mv>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/captura-movimiento.jpg"
                alt="Estudio de captura de movimiento con el esqueleto digital en pantalla"
                className="ox-img"
                width={1600}
                height={1071}
                loading="lazy"
              />
            </figure>
          </div>
        </div>
      </div>
    </div>
  );
}
