"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DOLENCIA_IMG as IMG, type Dolencia } from "@/lib/dolencias";

// Lista activa de dolencias con la foto fija que cambia con la fila
// (blueprint «Sticky photograph, active list»). En móvil, la imagen queda
// pegada arriba y la fila se activa al tocar.

export function DolenciasLista({ dolencias }: { dolencias: Pick<Dolencia, "slug" | "nombre" | "sintomas">[] }) {
  const [on, setOn] = useState(0);
  const rows = useRef<(HTMLLIElement | null)[]>([]);

  // En pantallas con ratón también activa la fila que cruza el centro al hacer scroll.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (e.isIntersecting) {
            const k = rows.current.indexOf(e.target as HTMLLIElement);
            if (k >= 0) setOn(k);
          }
        }
      },
      { rootMargin: "-46% 0px -46% 0px" }
    );
    rows.current.forEach((r) => r && io.observe(r));
    return () => io.disconnect();
  }, []);

  const srcs = Array.from(new Set(dolencias.map((d) => IMG[d.slug]?.src).filter(Boolean)));
  const act = IMG[dolencias[on]?.slug];

  return (
    <div className="ox-dol-grid">
      <figure className="ox-dol-fig" aria-hidden="true">
        {srcs.map((s) => (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={s}
            src={s}
            alt=""
            className={`ox-img${act?.src === s ? " on" : ""}`}
            style={act?.src === s && act?.pos ? { objectPosition: act.pos } : undefined}
            width={900}
            height={1125}
            loading="lazy"
          />
        ))}
      </figure>
      <ul className="ox-dol-list">
        {dolencias.map((d, k) => (
          <li
            key={d.slug}
            className={`ox-dol-row${k === on ? " on" : ""}`}
            ref={(el) => {
              rows.current[k] = el;
            }}
          >
            <button type="button" aria-expanded={k === on} onClick={() => setOn(k)}>
              <span>{d.nombre}</span>
              <span className="peek">guía</span>
            </button>
            {k === on && (
              <div className="ox-dol-des">
                {d.sintomas[0]}{" "}
                <Link href={`/dolencias/${d.slug}`}>Leer la guía completa</Link>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
