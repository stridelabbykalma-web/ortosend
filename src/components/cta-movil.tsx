"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// CTA flotante solo en móvil: aparece cuando el buscador del hero sale de
// pantalla, para que siempre haya una acción a mano al hacer scroll.
export function CtaMovil({ objetivo = "buscador-hero" }: { objetivo?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = document.getElementById(objetivo);
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(!e.isIntersecting), { rootMargin: "-40px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [objetivo]);
  if (!visible) return null;
  return (
    <Link href="/buscar" className="px-cta-movil">
      Buscar una clínica cerca
    </Link>
  );
}
