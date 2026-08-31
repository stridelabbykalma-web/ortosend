"use client";

// Formulario con autoguardado estilo Drive: cualquier pulsación o cambio se
// guarda solo (con antirrebote corto) y el chip muestra el estado. El botón
// «Continuar» sigue pasando por la acción con validación y navegación.
import { useEffect, useRef, useState } from "react";

type Estado = "inicial" | "escribiendo" | "guardando" | "guardado" | "error";

export function AutosaveForm({
  action,
  autosave,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  autosave: (formData: FormData) => Promise<{ ok: boolean }>;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const [estado, setEstado] = useState<Estado>("inicial");
  const [hora, setHora] = useState("");

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const guardar = async () => {
    const form = formRef.current;
    if (!form) return;
    if (inFlight.current) {
      dirty.current = true;
      return;
    }
    inFlight.current = true;
    setEstado("guardando");
    let ok = false;
    try {
      ok = (await autosave(new FormData(form))).ok;
    } catch {
      ok = false;
    }
    inFlight.current = false;
    if (dirty.current) {
      // Hubo más cambios mientras guardábamos: vuelve a guardar con lo último.
      dirty.current = false;
      void guardar();
      return;
    }
    if (ok) {
      setEstado("guardado");
      setHora(new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }));
    } else {
      setEstado("error");
      timer.current = setTimeout(guardar, 4000); // reintento automático
    }
  };

  const alEditar = () => {
    setEstado("escribiendo");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(guardar, 600);
  };

  const chip: Record<Estado, string> = {
    inicial: "Se guarda solo mientras escribes",
    escribiendo: "Escribiendo…",
    guardando: "Guardando…",
    guardado: `Guardado ✓ ${hora}`,
    error: "Sin conexión — reintentando…",
  };

  return (
    <form ref={formRef} action={action} onInput={alEditar}>
      <div className={`autosave-chip ${estado}`} role="status" aria-live="polite">
        {chip[estado]}
      </div>
      {children}
    </form>
  );
}
