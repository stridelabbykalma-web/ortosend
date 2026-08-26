import type { CaseState } from "@prisma/client";
import { STATE_COLOR, STATE_LABEL } from "@/lib/format";

export function StatePill({ state }: { state: CaseState }) {
  return <span className={`pill ${STATE_COLOR[state]}`}>{STATE_LABEL[state]}</span>;
}

// Mensaje de resultado de una acción de servidor (?error= / ?ok=)
export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (!error && !ok) return null;
  return (
    <>
      <div className={`note ${error ? "r" : "g"}`}>{error ?? ok}</div>
      <div className="sp" />
    </>
  );
}

export function Kpi({ v, l }: { v: React.ReactNode; l: string }) {
  return (
    <div className="kpi">
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}

export function CheckLine({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`checkline ${ok ? "ok" : ""}`}>
      <span>{ok ? "✓" : "○"}</span>
      {children}
    </div>
  );
}

// Línea de tiempo del paciente (7 hitos visibles de los 11 estados internos)
const STEPS: { key: string; label: string; states: CaseState[] }[] = [
  { key: "cita", label: "Cita", states: ["CITA_RESERVADA"] },
  { key: "estudio", label: "Estudio", states: ["ESTUDIO_EN_CURSO", "ESTUDIO_COMPLETO", "DEVUELTO_CLINICA"] },
  { key: "rx", label: "Prescripción", states: ["EN_PRESCRIPCION", "EN_CONTACTO", "NO_PRESCRITO"] },
  { key: "pago", label: "Pago", states: ["PENDIENTE_PAGO", "NO_CONVERTIDO"] },
  { key: "fab", label: "Fabricación", states: ["ENTRADA_TALLER", "DISENO", "FABRICACION", "CALIDAD"] },
  { key: "envio", label: "Envío", states: ["ENVIADO"] },
  { key: "entrega", label: "Entrega", states: ["ENTREGADO", "CERRADO"] },
];

export function Steps({ state }: { state: CaseState }) {
  const current = STEPS.findIndex((s) => s.states.includes(state));
  return (
    <div className="steps">
      {STEPS.map((s, i) => (
        <div key={s.key} className={`step ${i < current ? "done" : i === current ? "cur" : ""}`}>
          <div className="dot" />
          <div className="lb">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
