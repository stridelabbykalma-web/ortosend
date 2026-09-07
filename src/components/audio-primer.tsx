"use client";

// Desbloquea los pitidos del estudio de captura con el primer toque del
// usuario en cualquier pantalla (los navegadores móviles exigen un gesto para
// poder reproducir audio después sin intervención).
import { useEffect } from "react";
import { primeBeeps } from "@/lib/beeps";

export function AudioPrimer() {
  useEffect(() => {
    const onGesture = () => primeBeeps();
    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, []);
  return null;
}
