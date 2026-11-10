import { describe, expect, it } from "vitest";
import { ocupadoDeIcal } from "@/lib/conector/ical";

const TZ = "Europe/Madrid";
const ventana = { tz: TZ, desde: new Date("2026-11-01T00:00:00Z"), hasta: new Date("2027-01-31T00:00:00Z") };
const ics = (...eventos: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//ES", ...eventos, "END:VCALENDAR"].join("\r\n");
const ev = (...lineas: string[]) => ["BEGIN:VEVENT", ...lineas, "END:VEVENT"].join("\r\n");
const iso = (r: { ocupado: { startsAt: Date; endsAt: Date }[] }) =>
  r.ocupado.map((o) => [o.startsAt.toISOString(), o.endsAt.toISOString()]);

describe("lector iCal", () => {
  it("hora con TZID, en UTC y flotante (hora de la clínica)", () => {
    const r = ocupadoDeIcal(
      ics(
        ev("UID:a", "DTSTART;TZID=Europe/Madrid:20261116T100000", "DTEND;TZID=Europe/Madrid:20261116T104500"),
        ev("UID:b", "DTSTART:20261117T090000Z", "DTEND:20261117T093000Z"),
        ev("UID:c", "DTSTART:20261118T160000", "DURATION:PT1H")
      ),
      ventana
    );
    expect(iso(r)).toEqual([
      ["2026-11-16T09:00:00.000Z", "2026-11-16T09:45:00.000Z"],
      ["2026-11-17T09:00:00.000Z", "2026-11-17T09:30:00.000Z"],
      ["2026-11-18T15:00:00.000Z", "2026-11-18T16:00:00.000Z"],
    ]);
  });

  it("días enteros (vacaciones) en hora local; fin exclusivo", () => {
    const r = ocupadoDeIcal(ics(ev("UID:v", "DTSTART;VALUE=DATE:20261221", "DTEND;VALUE=DATE:20261223", "SUMMARY:Vacaciones")), ventana);
    expect(iso(r)).toEqual([["2026-12-20T23:00:00.000Z", "2026-12-22T23:00:00.000Z"]]);
  });

  it("descarta anulados, libres y los propios de Ortosend", () => {
    const r = ocupadoDeIcal(
      ics(
        ev("UID:x", "STATUS:CANCELLED", "DTSTART:20261116T090000Z", "DTEND:20261116T100000Z"),
        ev("UID:y", "TRANSP:TRANSPARENT", "DTSTART:20261116T090000Z", "DTEND:20261116T100000Z"),
        ev("UID:cita123@ortosend", "DTSTART:20261116T090000Z", "DTEND:20261116T100000Z")
      ),
      { ...ventana, ignorarUid: (u) => u.endsWith("@ortosend") }
    );
    expect(r.ocupado).toEqual([]);
  });

  it("repetición semanal con BYDAY, EXDATE y una ocurrencia movida; respeta el cambio de hora", () => {
    const r = ocupadoDeIcal(
      ics(
        ev(
          "UID:r1",
          "DTSTART;TZID=Europe/Madrid:20261019T090000",
          "DTEND;TZID=Europe/Madrid:20261019T100000",
          "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261120T000000Z",
          "EXDATE;TZID=Europe/Madrid:20261104T090000"
        ),
        ev("UID:r1", "RECURRENCE-ID;TZID=Europe/Madrid:20261111T090000", "DTSTART;TZID=Europe/Madrid:20261111T120000", "DTEND;TZID=Europe/Madrid:20261111T130000")
      ),
      { tz: TZ, desde: new Date("2026-10-19T00:00:00Z"), hasta: new Date("2026-11-30T00:00:00Z") }
    );
    const horas = [...r.ocupado]
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((o) => {
        const p = Object.fromEntries(
          new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
            .formatToParts(o.startsAt)
            .map((x) => [x.type, x.value])
        );
        return `${p.day}/${p.month}, ${p.hour}:${p.minute}`;
      });
    // Todas a las 9:00 de Madrid antes y después del 25-10 (cambio de hora);
    // sin el 04-11 (EXDATE) y el 11-11 movido a las 12:00.
    expect(horas).toEqual([
      "19/10, 09:00",
      "21/10, 09:00",
      "26/10, 09:00",
      "28/10, 09:00",
      "02/11, 09:00",
      "09/11, 09:00",
      "11/11, 12:00",
      "16/11, 09:00",
      "18/11, 09:00",
    ]);
  });

  it("COUNT, INTERVAL y mensual por «segundo martes»", () => {
    const r = ocupadoDeIcal(
      ics(
        ev("UID:d", "DTSTART:20261102T080000Z", "DTEND:20261102T083000Z", "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3"),
        ev("UID:m", "DTSTART;TZID=Europe/Madrid:20261110T180000", "DTEND;TZID=Europe/Madrid:20261110T200000", "RRULE:FREQ=MONTHLY;BYDAY=2TU")
      ),
      { tz: TZ, desde: new Date("2026-11-01T00:00:00Z"), hasta: new Date("2027-01-31T00:00:00Z") }
    );
    const d = r.ocupado.filter((o) => o.uid === "d").map((o) => o.startsAt.toISOString().slice(0, 10));
    const m = r.ocupado.filter((o) => o.uid === "m").map((o) => o.startsAt.toISOString().slice(0, 10));
    expect(d).toEqual(["2026-11-02", "2026-11-04", "2026-11-06"]);
    expect(m).toEqual(["2026-11-10", "2026-12-08", "2027-01-12"]);
  });

  it("zona de Windows de Outlook y líneas plegadas", () => {
    const r = ocupadoDeIcal(
      ics(
        [
          "BEGIN:VEVENT",
          "UID:outlook-1",
          'DTSTART;TZID="Romance Standard Time":20261116T',
          " 160000",
          'DTEND;TZID="Romance Standard Time":20261116T170000',
          "BEGIN:VALARM",
          "TRIGGER:-PT15M",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n")
      ),
      ventana
    );
    expect(iso(r)).toEqual([["2026-11-16T15:00:00.000Z", "2026-11-16T16:00:00.000Z"]]);
  });

  it("solo devuelve lo que cae en la ventana pedida", () => {
    const r = ocupadoDeIcal(
      ics(ev("UID:w", "DTSTART:20200106T090000Z", "DTEND:20200106T100000Z", "RRULE:FREQ=WEEKLY")),
      { tz: TZ, desde: new Date("2026-11-16T00:00:00Z"), hasta: new Date("2026-11-30T00:00:00Z") }
    );
    expect(r.ocupado.map((o) => o.startsAt.toISOString())).toEqual(["2026-11-16T09:00:00.000Z", "2026-11-23T09:00:00.000Z"]);
  });
});

describe("enlaces de calendario que escribe la clínica", () => {
  it("solo https/webcal hacia servicios públicos", async () => {
    const { normalizarEnlace } = await import("@/lib/conector/red");
    expect(normalizarEnlace("webcal://p01-caldav.icloud.com/published/2/abc").toString()).toBe("https://p01-caldav.icloud.com/published/2/abc");
    expect(normalizarEnlace(" https://calendar.google.com/calendar/ical/x/private-y/basic.ics ").hostname).toBe("calendar.google.com");
    for (const malo of [
      "http://calendar.google.com/x.ics",
      "https://localhost/x.ics",
      "https://127.0.0.1/x.ics",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/x.ics",
      "https://intranet/x.ics",
      "https://user:pass@calendar.google.com/x.ics",
      "file:///etc/passwd",
      "no es un enlace",
    ])
      expect(() => normalizarEnlace(malo), malo).toThrow();
  });
});
