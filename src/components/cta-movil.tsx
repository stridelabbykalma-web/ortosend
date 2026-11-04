"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// CTA flotante solo en móvil: aparece cuando el buscador del hero sale de
// pantalla, para que siempre haya una acción a mano al hacer scroll.
export function CtaMovil({ objetivo = "buscador-hero" }: { objetivo?: string }) {
  const [pasado, setPasado] = useState(false);
  const [enPie, setEnPie] = useState(false);
  useEffect(() => {
    const el = document.getElementById(objetivo);
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setPasado(!e.isIntersecting), { rootMargin: "-40px 0px 0px 0px" });
    io.observe(el);
    // Al llegar al pie (o al cierre) se retira: no debe tapar sus enlaces.
    const fin = document.querySelector(".ox-footer, .ox-cta");
    let io2: IntersectionObserver | null = null;
    if (fin) {
      io2 = new IntersectionObserver(([e]) => setEnPie(e.isIntersecting));
      io2.observe(fin);
    }
    return () => {
      io.disconnect();
      io2?.disconnect();
    };
  }, [objetivo]);
  if (!pasado || enPie) return null;
  return (
    <Link href="/buscar" className="ox-cta-movil">
      Buscar una clínica cerca
    </Link>
  );
}
