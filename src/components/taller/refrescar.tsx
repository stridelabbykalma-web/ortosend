"use client";

// Vuelve a pedir la página al servidor cada pocos segundos (y al volver a la pestaña), para ver al
// momento lo que hacen los demás en el taller.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function Refrescar({ segundos = 20 }: { segundos?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, segundos * 1000);
    const alVolver = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [router, segundos]);
  return null;
}
