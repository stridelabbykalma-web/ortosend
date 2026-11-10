import { describe, expect, it } from "vitest";
import { ausenciaATramos, conflictoBloquea, tramosOcupados } from "@/lib/conector/ocupacion";
import { computeAvailability, zonedToUtc } from "@/lib/agenda";
import { cifrar, descifrar, pistaDe } from "@/lib/secretos";
import type { DfOccupied } from "@/lib/conector/docfav";

const TZ = "Europe/Madrid";
const lunes = { y: 2026, m: 11, d: 16 };
const martes = { y: 2026, m: 11, d: 17 };

function occ(over: Partial<DfOccupied>): DfOccupied {
  return { staffId: "st1", staffCalendarId: "sc1", workingHours: [], appointments: [], reservations: [], absences: [], ...over };
}

describe("ocupación de Docfav → tramos ocupados", () => {
  it("citas en cualquier sitio, reservas, sin anuladas ni copias propias", () => {
    const { tramos } = tramosOcupados({
      occupied: [
        occ({
          appointments: [
            { id: "a1", from: "2026-11-16T09:00:00Z", to: "2026-11-16T09:30:00Z", behaviour: "confirmed" },
            { id: "a2", from: "2026-11-16T10:00:00Z", to: "2026-11-16T10:30:00Z", behaviour: "cancelled" },
            { id: "propia", from: "2026-11-16T11:00:00Z", to: "2026-11-16T11:45:00Z", behaviour: "confirmed" },
          ],
          reservations: [{ id: "r1", from: "2026-11-16T12:00:00Z", to: "2026-11-16T13:00:00Z" }],
        }),
        // Mismo profesional en el domicilio: también le ocupa
        occ({ staffCalendarId: "sc2", appointments: [{ id: "a3", from: "2026-11-16T15:00:00Z", to: "2026-11-16T16:00:00Z" }] }),
        // Otro profesional: no
        occ({ staffId: "st2", appointments: [{ id: "a4", from: "2026-11-16T09:00:00Z", to: "2026-11-16T10:00:00Z" }] }),
      ],
      links: [{ professionalId: "pro1", externalStaffId: "st1", externalCalendarId: "sc1" }],
      ownIds: new Set(["propia"]),
      tz: TZ,
      from: lunes,
      to: lunes,
      respectHours: false,
    });
    expect(tramos.map((t) => [t.kind, t.externalId, t.startsAt.toISOString()])).toEqual([
      ["cita", "a1", "2026-11-16T09:00:00.000Z"],
      ["bloqueo", "r1", "2026-11-16T12:00:00.000Z"],
      ["cita", "a3", "2026-11-16T15:00:00.000Z"],
    ]);
    expect(tramos.every((t) => t.professionalId === "pro1")).toBe(true);
  });

  it("con «respetar horario» bloquea lo que queda fuera del horario de trabajo (hora local)", () => {
    const { tramos } = tramosOcupados({
      occupied: [
        occ({
          workingHours: [
            { date: "2026-11-16", from: "09:00", to: "13:00" },
            { date: "2026-11-16", from: "15:00", to: "19:00" },
          ],
        }),
      ],
      links: [{ professionalId: "pro1", externalStaffId: "st1", externalCalendarId: "sc1" }],
      ownIds: new Set(),
      tz: TZ,
      from: lunes,
      to: martes,
      respectHours: true,
    });
    const fuera = tramos.filter((t) => t.kind === "fuera_horario").map((t) => [t.startsAt.toISOString(), t.endsAt.toISOString()]);
    expect(fuera).toEqual([
      ["2026-11-15T23:00:00.000Z", "2026-11-16T08:00:00.000Z"], // 00:00–09:00
      ["2026-11-16T12:00:00.000Z", "2026-11-16T14:00:00.000Z"], // 13:00–15:00
      ["2026-11-16T18:00:00.000Z", "2026-11-16T23:00:00.000Z"], // 19:00–24:00
      ["2026-11-16T23:00:00.000Z", "2026-11-17T23:00:00.000Z"], // martes sin horario: entero
    ]);
  });

  it("el horario de otro sitio (domicilio) no abre horas en la agenda enlazada (centro)", () => {
    const { tramos } = tramosOcupados({
      occupied: [
        occ({ workingHours: [{ date: "2026-11-16", from: "09:00", to: "13:00" }] }),
        occ({ staffCalendarId: "sc-casa", workingHours: [{ date: "2026-11-16", from: "08:00", to: "20:00" }] }),
      ],
      links: [{ professionalId: "pro1", externalStaffId: "st1", externalCalendarId: "sc1" }],
      ownIds: new Set(),
      tz: TZ,
      from: lunes,
      to: lunes,
      respectHours: true,
    });
    expect(tramos.map((t) => [t.startsAt.toISOString(), t.endsAt.toISOString()])).toEqual([
      ["2026-11-15T23:00:00.000Z", "2026-11-16T08:00:00.000Z"],
      ["2026-11-16T12:00:00.000Z", "2026-11-16T23:00:00.000Z"],
    ]);
  });

  it("sin ningún horario en Docfav no bloquea por horario", () => {
    const { tramos } = tramosOcupados({
      occupied: [occ({})],
      links: [{ professionalId: "pro1", externalStaffId: "st1", externalCalendarId: "sc1" }],
      ownIds: new Set(),
      tz: TZ,
      from: lunes,
      to: martes,
      respectHours: true,
    });
    expect(tramos).toEqual([]);
  });

  it("ausencias en las formas razonables; lo desconocido se cuenta y se ignora", () => {
    expect(ausenciaATramos({ date: "2026-11-16" }, TZ)?.map((r) => r.map((d) => d.toISOString()))).toEqual([
      ["2026-11-15T23:00:00.000Z", "2026-11-16T23:00:00.000Z"],
    ]);
    expect(ausenciaATramos({ from: "2026-11-16", to: "2026-11-17" }, TZ)).toHaveLength(2);
    expect(ausenciaATramos({ date: "2026-11-16", from: "10:00", to: "12:00" }, TZ)?.[0][0].toISOString()).toBe("2026-11-16T09:00:00.000Z");
    expect(ausenciaATramos({ from: "2026-11-16T10:00:00Z", to: "2026-11-16T11:00:00Z" }, TZ)?.[0][1].toISOString()).toBe("2026-11-16T11:00:00.000Z");
    const r = tramosOcupados({
      occupied: [occ({ absences: [{ raro: true }] })],
      links: [{ professionalId: null, externalStaffId: "st1", externalCalendarId: "sc1" }],
      ownIds: new Set(),
      tz: TZ,
      from: lunes,
      to: lunes,
      respectHours: false,
    });
    expect(r.ausenciasSinEntender).toBe(1);
  });

  it("conflictos en tiempo real: copias propias no; horario solo si se respeta", () => {
    const propios = new Set(["mia"]);
    expect(conflictoBloquea({ id: "mia", type: "appointment" }, propios, true)).toBe(false);
    expect(conflictoBloquea({ id: "otra", type: "appointment" }, propios, true)).toBe(true);
    expect(conflictoBloquea({ type: "working_hours" }, propios, false)).toBe(false);
    expect(conflictoBloquea({ type: "working_hours" }, propios, true)).toBe(true);
    expect(conflictoBloquea({ type: "algo_nuevo" }, propios, false)).toBe(true);
  });
});

describe("motor de disponibilidad con ocupación externa", () => {
  it("un tramo ocupado en Docfav quita el hueco aunque la agenda tenga capacidad", () => {
    const clinic = { timezone: TZ, slotMinutes: 45, minNoticeHours: 0, bookingHorizonDays: 60, onlineBooking: true };
    const rules = [{ professionalId: null, weekday: 1, startMin: 540, endMin: 720, capacity: 3, online: true }];
    const now = new Date("2026-11-10T08:00:00Z");
    const base = computeAvailability({ clinic, rules, exceptions: [], appointments: [], from: lunes, to: lunes, mode: "online", now });
    const conBusy = computeAvailability({
      clinic,
      rules,
      exceptions: [],
      appointments: [],
      busy: [{ professionalId: null, startsAt: zonedToUtc(lunes, 585, TZ), endsAt: zonedToUtc(lunes, 600, TZ) }],
      from: lunes,
      to: lunes,
      mode: "online",
      now,
    });
    expect(base.get("2026-11-16")).toHaveLength(4);
    expect(conBusy.get("2026-11-16")).toHaveLength(3); // 09:45 desaparece
  });
});

describe("secretos", () => {
  it("cifra y descifra la clave; la pista no la revela", () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "x";
    const k = "df_pk_abcdefghijklmnopqrstuvwxyz1234";
    const c = cifrar(k);
    expect(c).not.toContain("abcdefgh");
    expect(c).not.toBe(cifrar(k));
    expect(descifrar(c)).toBe(k);
    expect(pistaDe(k)).toBe("…1234");
  });
});
