"use client";

// Calendario de reserva: mes con los días que tienen hueco, horas del día
// elegido y, si la clínica lo permite, elección de profesional. Se usa dentro
// de un <form> del servidor: deja la elección en inputs ocultos `startsAt`
// (ISO UTC) y `professionalId` ("" = cualquiera, "clinica" = agenda de la
// clínica, o el id del profesional).
import { useEffect, useMemo, useState } from "react";
import type { DisponibilidadResponse } from "@/app/api/disponibilidad/route";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["L", "M", "X", "J", "V", "S", "D"];

function key(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function todayKey() {
  const t = new Date();
  return key(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

export function Calendario({
  clinicId,
  mode = "online",
  compact = false,
}: {
  clinicId: string;
  mode?: "online" | "staff";
  compact?: boolean;
}) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [pro, setPro] = useState<string>("");
  const [data, setData] = useState<DisponibilidadResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);

  const from = key(cursor.y, cursor.m, 1);
  const lastDay = new Date(cursor.y, cursor.m, 0).getDate();
  const to = key(cursor.y, cursor.m, lastDay);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ clinicId, from, to });
        if (pro) qs.set("pro", pro);
        if (mode === "staff") qs.set("mode", "staff");
        const res = await fetch(`/api/disponibilidad?${qs}`);
        if (!res.ok) throw new Error("bad");
        const json = (await res.json()) as DisponibilidadResponse;
        if (!alive) return;
        setData(json);
        // Si el día elegido ya no tiene huecos (p. ej. al cambiar de profesional), se deselecciona.
        setDay((d) => (d && json.days[d] ? d : null));
        setTime(null);
      } catch {
        if (alive) setError("No se pudo cargar la disponibilidad. Inténtalo de nuevo.");
      } finally {
        if (alive) setBusy(false);
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [clinicId, from, to, pro, mode]);

  const fmtHora = useMemo(
    () =>
      new Intl.DateTimeFormat("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: data?.timezone ?? "Europe/Madrid",
      }),
    [data?.timezone]
  );

  // Rejilla del mes (lunes primero)
  const first = new Date(cursor.y, cursor.m - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: lastDay }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const tk = todayKey();
  const horizon = data?.horizonEnd ?? null;

  const canPrev = cursor.y > now.getFullYear() || (cursor.y === now.getFullYear() && cursor.m > now.getMonth() + 1);
  const canNext = !horizon || key(cursor.y, cursor.m, lastDay) < horizon;

  const slots = day && data ? data.days[day] ?? [] : [];
  const chosen = slots.find((s) => s.t === time) ?? null;
  const showPro = !!data && data.patientPicksPro && data.professionals.length > 0;

  // Agenda que se reservará: la elegida por el paciente, o la primera que ofrezca esa hora.
  const professionalValue = pro ? pro : chosen ? (chosen.pros.find((p) => p !== null) ?? "clinica") : "";

  return (
    <div className={`cal ${compact ? "cal-compact" : ""}`}>
      <input type="hidden" name="startsAt" value={time ?? ""} />
      <input type="hidden" name="professionalId" value={time ? (pro ? pro : "") : ""} readOnly />
      {showPro && (
        <div style={{ marginBottom: 10 }}>
          <label style={{ marginTop: 0 }}>Profesional</label>
          <select value={pro} onChange={(e) => setPro(e.target.value)}>
            <option value="">Cualquiera (primer hueco libre)</option>
            {data!.professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {mode === "staff" && <option value="clinica">Agenda de la clínica</option>}
          </select>
        </div>
      )}
      <div className="cal-grid-wrap">
        <div className="cal-head">
          <button type="button" onClick={() => canPrev && setCursor(prevMonth(cursor))} disabled={!canPrev} aria-label="Mes anterior">
            ‹
          </button>
          <b>
            {MESES[cursor.m - 1]} {cursor.y}
          </b>
          <button type="button" onClick={() => canNext && setCursor(nextMonth(cursor))} disabled={!canNext} aria-label="Mes siguiente">
            ›
          </button>
        </div>
        <div className="cal-grid">
          {DIAS.map((d) => (
            <div key={d} className="cal-dow">
              {d}
            </div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const k = key(cursor.y, cursor.m, d);
            const has = !!data?.days[k]?.length;
            const past = k < tk;
            return (
              <button
                type="button"
                key={k}
                className={`cal-day ${has ? "has" : ""} ${day === k ? "sel" : ""} ${k === tk ? "today" : ""}`}
                disabled={!has || past}
                onClick={() => {
                  setDay(k);
                  setTime(null);
                }}
              >
                {d}
              </button>
            );
          })}
        </div>
        <div className="tiny" style={{ marginTop: 6 }}>
          {busy ? "Cargando disponibilidad…" : error ? error : data && Object.keys(data.days).length === 0 ? "No hay huecos este mes." : "Elige un día con hueco (en verde)."}
        </div>
      </div>
      <div className="cal-times">
        {day ? (
          <>
            <div className="muted" style={{ marginBottom: 8 }}>
              Horas para el {fmtDia(day)}
            </div>
            <div className="cal-times-grid">
              {slots.map((s) => (
                <button
                  type="button"
                  key={s.t}
                  className={`slotlabel ${time === s.t ? "on" : ""}`}
                  onClick={() => setTime(s.t)}
                >
                  {fmtHora.format(new Date(s.t))}
                </button>
              ))}
            </div>
            {chosen && (
              <div className="note g" style={{ marginTop: 10 }}>
                Cita elegida: {fmtDia(day)} a las {fmtHora.format(new Date(chosen.t))}
                {showPro && (
                  <>
                    {" "}
                    ·{" "}
                    {professionalValue === "clinica"
                      ? "agenda de la clínica"
                      : (data!.professionals.find((p) => p.id === professionalValue)?.name ?? "profesional disponible")}
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="muted">Selecciona un día para ver las horas.</div>
        )}
      </div>
    </div>
  );
}

function prevMonth(c: { y: number; m: number }) {
  return c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 };
}
function nextMonth(c: { y: number; m: number }) {
  return c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 };
}
function fmtDia(k: string) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}
