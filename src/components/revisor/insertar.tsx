"use client";

// Chip/botón que añade un texto al final de un textarea del formulario de
// prescripción (por id). Sirve para volcar la síntesis en la valoración y para
// las pautas frecuentes de fabricación. Nunca sustituye lo escrito: añade.
export function Insertar({
  target,
  text,
  children,
  className = "rev-chip",
}: {
  target: string;
  text: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        const el = document.getElementById(target) as HTMLTextAreaElement | null;
        if (!el) return;
        const cur = el.value.trimEnd();
        if (cur.includes(text.trim())) {
          el.focus();
          return;
        }
        el.value = cur ? `${cur}\n${text}` : text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.focus();
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }}
    >
      {children}
    </button>
  );
}
