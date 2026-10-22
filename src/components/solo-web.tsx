"use client";

// Chrome de la web pública (barra de navegación, pie, aviso de cookies): se
// oculta en /equipo y /taller para que las apps instaladas (clínicas y
// taller) abran directas en su inicio de sesión, sin los enlaces de
// marketing. usePathname se resuelve ya en el renderizado de servidor, así
// que no hay parpadeo.
import { usePathname } from "next/navigation";

const APPS = ["/equipo", "/taller"];

export function SoloWeb({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (APPS.includes(pathname)) return null;
  return <>{children}</>;
}
