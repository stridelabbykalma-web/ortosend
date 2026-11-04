"use client";

import Link from "next/link";
import { useState } from "react";
import { MapaPresiones } from "@/components/ox/mapa-presiones";

// «El estudio»: plato cuadrado con las tres pruebas como pestañas de texto.
// El escáner y las presiones se muestran con el gráfico propio (dibujado en
// código, en la paleta); la marcha, con una foto real de captura de movimiento.
const PRUEBAS = [
  {
    id: "escaner",
    tab: "Escáner 3D",
    titulo: "Un molde digital exacto",
    des: "Escaneamos ambos pies en tres dimensiones, sin escayolas ni esperas. De ahí sale el molde con el que el taller fabrica cada plantilla: la izquierda como tu pie izquierdo, la derecha como el derecho.",
    cap: "El molde digital, dibujado: así trabaja el escáner",
  },
  {
    id: "marcha",
    tab: "Tu marcha",
    titulo: "Cómo caminas de verdad",
    des: "Grabamos tu marcha en vídeo y la analizamos con apoyo de visión artificial: ángulo de paso, apoyo del talón, línea de progresión. La valoración final es siempre de un profesional colegiado.",
    img: "/img/captura-movimiento.jpg",
    alt: "Estudio de captura de movimiento con el esqueleto digital en pantalla",
    cap: "Captura de movimiento: tu marcha, convertida en datos",
  },
  {
    id: "presiones",
    tab: "Tus presiones",
    titulo: "Dónde carga tu pisada",
    des: "La plataforma de presiones mide cómo pisas parado y caminando: presiones pico por zona, reparto entre talón y antepié, tiempos de apoyo. Las descargas de tu plantilla se fabrican sobre esos puntos exactos.",
    cap: "El estudio dura 45 minutos y es gratuito",
  },
];

export function PlatoEstudio() {
  const [i, setI] = useState(0);
  const p = PRUEBAS[i];
  return (
    <div className="ox-plate-grid">
      <figure className="ox-plate-fig" data-mv>
        {p.img ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={p.img} alt={p.alt} className="ox-img" width={1600} height={1071} />
        ) : (
          <div className="ox-plate-svg" aria-hidden="true">
            <MapaPresiones modo={p.id === "escaner" ? "malla" : "mapa"} />
          </div>
        )}
      </figure>
      <div className="ox-plate-col">
        <div className="ox-tabs" aria-label="Pruebas del estudio">
          {PRUEBAS.map((t, k) => (
            <button key={t.id} type="button" aria-pressed={k === i} onClick={() => setI(k)}>
              {t.tab}
            </button>
          ))}
        </div>
        <div>
          <h3 className="ox-plate-t">{p.titulo}</h3>
          <p className="des">{p.des}</p>
          <p className="ox-small">{p.cap}</p>
        </div>
        <div className="ox-plate-cells">
          <Link href="/buscar" className="c1">
            Reservar mi estudio
          </Link>
          <Link href="/como-funciona" className="c2">
            Cómo funciona
          </Link>
        </div>
      </div>
    </div>
  );
}
