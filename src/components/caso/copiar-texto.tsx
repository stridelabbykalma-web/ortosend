"use client";

// Botón «Copiar» para textos que hay que teclear en otro programa (el nombre
// del proyecto en Revo Scan).
import { useState } from "react";

export function CopiarTexto({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          // sin portapapeles: se teclea a mano
        }
      }}
    >
      {copiado ? "Copiado ✓" : "Copiar"}
    </button>
  );
}
