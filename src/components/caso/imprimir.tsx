"use client";

// Botón de imprimir (la hoja de trabajo y las etiquetas van al papel).
export function Imprimir({ children = "Imprimir" }: { children?: React.ReactNode }) {
  return (
    <button type="button" className="pri" onClick={() => window.print()}>
      {children}
    </button>
  );
}
