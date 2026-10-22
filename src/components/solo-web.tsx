"use client";

// Chrome de la web pública (barra de navegación, pie, aviso de cookies): se
// oculta en /equipo para que la app instalada de las clínicas abra directa en
// su inicio de sesión, sin los enlaces de marketing. usePathname se resuelve
// ya en el renderizado de servidor, así que no hay parpadeo.
import { usePathname } from "next/navigation";

export function SoloWeb({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/equipo") return null;
  return <>{children}</>;
}
