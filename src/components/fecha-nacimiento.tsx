"use client";

// Campo de fecha de nacimiento que se escribe a mano (dd/mm/aaaa): el
// type="date" nativo obligaba a usar el calendarito y no dejaba teclear.
// Pone las barras solo y valida el formato; el servidor lo parsea con
// parseBirth (acepta dd/mm/aaaa e ISO).
export function formatearFecha(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

export function FechaNacimiento({
  name,
  id,
  required,
  value,
  onChange,
  defaultValue,
}: {
  name: string;
  id?: string;
  required?: boolean;
  value?: string;
  onChange?: (v: string) => void;
  defaultValue?: string;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="bday"
      placeholder="dd/mm/aaaa"
      maxLength={10}
      pattern="\d{2}/\d{2}/\d{4}"
      title="Escribe la fecha como día/mes/año, p. ej. 04/06/2002"
      name={name}
      id={id}
      required={required}
      {...(onChange !== undefined
        ? { value: value ?? "", onChange: (ev) => onChange(formatearFecha(ev.target.value)) }
        : {
            defaultValue,
            onChange: (ev) => {
              ev.target.value = formatearFecha(ev.target.value);
            },
          })}
    />
  );
}
