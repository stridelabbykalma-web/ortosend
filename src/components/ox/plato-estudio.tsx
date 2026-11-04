"use client";

import Link from "next/link";
import { useState } from "react";

// «El estudio»: plato cuadrado con las tres pruebas como pestañas de texto.
// La imagen y la descripción cambian con la pestaña; los anillos dibujados
// sobre la foto son el motivo del mapa de presiones (en la paleta, en código).
const PRUEBAS = [
  {
    id: "escaner",
    tab: "Escáner 3D",
    titulo: "Un molde digital exacto",
    des: "Escaneamos ambos pies en tres dimensiones, sin escayolas ni esperas. De ahí sale el molde con el que el taller fabrica cada plantilla: la izquierda como tu pie izquierdo, la derecha como el derecho.",
    img: "/img/horma-madera.jpg",
    alt: "Horma de madera de zapatero, pieza de museo (Museums Victoria)",
    cap: "La horma: así se copiaba un pie antes del escáner 3D",
  },
  {
    id: "marcha",
    tab: "Tu marcha",
    titulo: "Cómo caminas de verdad",
    des: "Grabamos tu marcha en vídeo y la analizamos con apoyo de visión artificial: ángulo de paso, apoyo del talón, línea de progresión. La valoración final es siempre de un profesional colegiado.",
    img: "/img/marcha-muybridge.jpg",
    alt: "Secuencia fotográfica de un hombre caminando, de Eadweard Muybridge (1887)",
    cap: "Muybridge, 1887: el primer análisis de la marcha",
  },
  {
    id: "presiones",
    tab: "Tus presiones",
    titulo: "Dónde carga tu pisada",
    des: "La plataforma de presiones mide cómo pisas parado y caminando: presiones pico por zona, reparto entre talón y antepié, tiempos de apoyo. Las descargas de tu plantilla se fabrican sobre esos puntos exactos.",
    img: "/img/pies-andando.jpg",
    alt: "Pies descalzos caminando por el borde de una piscina",
    cap: "El estudio dura 45 minutos y es gratuito",
  },
];

export function PlatoEstudio() {
  const [i, setI] = useState(0);
  const p = PRUEBAS[i];
  return (
    <div className="ox-plate-grid">
      <figure className="ox-plate-fig" data-mv>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.img} alt={p.alt} className="ox-img" width={1100} height={1100} />
        <svg className="ox-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="43" fill="none" stroke="#0e7490" strokeWidth="0.9" opacity="0.85" />
          <circle cx="50" cy="50" r="28" fill="none" stroke="#0e7490" strokeWidth="0.7" opacity="0.6" />
          <circle cx="50" cy="50" r="2.4" fill="#0e7490" />
        </svg>
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
