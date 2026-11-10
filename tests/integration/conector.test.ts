// Conector con Docfav: lectura de la ocupación, comprobación al reservar y copia
// de las citas (alta del paciente con los datos de su cuenta, servicio
// «Ortosend», anulación y cambio de hora). Docfav va en memoria (FakeDocfav).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { usarDocfav } from "@/lib/conector/docfav";
import { leerOcupacion, mantenimientoConectores, sincronizarCaso } from "@/lib/conector";
import { availabilityOf, bookAppointment, cancelAppointment, loadClinicAgenda, TX_RESERVA, AgendaError } from "@/lib/agenda-db";
import { addDays, dateKey, isoWeekday, todayLocal, zonedToUtc, type LocalDate } from "@/lib/agenda";
import { cifrar } from "@/lib/secretos";
import { FakeDocfav } from "../fake-docfav";

const TZ = "Europe/Madrid";
let df: FakeDocfav;
let n = 0;

// Próximo lunes con al menos 2 días de margen.
function proximoLunes(): LocalDate {
  let d = addDays(todayLocal(TZ), 2);
  while (isoWeekday(d) !== 1) d = addDays(d, 1);
  return d;
}
const LUNES = proximoLunes();
const a = (min: number, day = LUNES) => zonedToUtc(day, min, TZ);

async function escenario(opts: { serviceName?: string } = {}) {
  n++;
  const clinic = await prisma.clinic.create({
    data: {
      name: `Clínica ${n}`,
      address: "C/ Major 1",
      town: "Cassà",
      postalCode: "17244",
      status: "ACTIVA",
      slotMinutes: 45,
      minNoticeHours: 0,
      bookingHorizonDays: 60,
    },
  });
  const pro = await prisma.user.create({ data: { role: "PROFESIONAL", name: `Abraham ${n}`, clinicId: clinic.id, email: `pro${n}@conector.test` } });
  await prisma.availabilityRule.createMany({
    data: [1, 2, 3, 4, 5].map((weekday) => ({ clinicId: clinic.id, professionalId: pro.id, weekday, startMin: 540, endMin: 780 })),
  });
  const connector = await prisma.calendarConnector.create({
    data: {
      clinicId: clinic.id,
      kind: "DOCFAV",
      apiKeyEnc: cifrar("df_pk_test_0123456789abcdef"),
      apiKeyHint: "…cdef",
      externalClinicId: "dfc-1",
      externalClinicName: "Centre Kalma",
      serviceName: opts.serviceName ?? "Ortosend",
      respectHours: false,
      links: {
        create: [
          {
            professionalId: pro.id,
            externalCalendarId: "sc-abraham-centro",
            externalPlaceId: "lugar-centro",
            externalStaffId: "staff-abraham",
            externalName: "Abraham Ramirez · Centre Kalma",
          },
        ],
      },
    },
  });
  return { clinic, pro, connector };
}

async function paciente(clinicId: string, datos: { name: string; lastName?: string; phone: string; email: string }) {
  const owner = await prisma.user.create({ data: { role: "CLIENTE", name: `${datos.name} ${datos.lastName ?? ""}`.trim(), phone: datos.phone, email: datos.email } });
  const p = await prisma.patient.create({
    data: { ownerId: owner.id, name: datos.name, lastName: datos.lastName ?? null, status: "ACEPTADO", consents: {}, clinicId },
  });
  return p;
}

async function caso(clinicId: string, patientId: string) {
  return prisma.case.create({ data: { clinicId, patientId, state: "CITA_RESERVADA", flow: "A" } });
}

function reservar(clinicId: string, caseId: string, startsAt: Date, extra: { professionalId?: string | null; replace?: string } = {}) {
  return prisma.$transaction(
    (tx) =>
      bookAppointment(tx, {
        clinicId,
        caseId,
        startsAt,
        professionalId: extra.professionalId,
        kind: "ESTUDIO",
        source: "web",
        mode: "online",
        replaceAppointmentId: extra.replace ?? null,
      }),
    TX_RESERVA
  );
}

beforeEach(() => {
  df = new FakeDocfav();
  usarDocfav(() => df);
});
afterAll(() => usarDocfav(null));

describe("copia de las citas en Docfav", () => {
  it("al reservar crea la ficha con los datos de la cuenta y la cita con el servicio «Ortosend», sin recordatorio de Docfav", async () => {
    const { clinic } = await escenario();
    const p = await paciente(clinic.id, { name: "Ana", lastName: "Pérez Gil", phone: "633999001", email: "ana1@conector.test" });
    const k = await caso(clinic.id, p.id);
    const appt = await reservar(clinic.id, k.id, a(585));
    await sincronizarCaso(k.id);

    expect(df.clientes).toEqual([expect.objectContaining({ firstname: "Ana", lastname: "Pérez Gil", phone: "+34633999001", email: "ana1@conector.test" })]);
    expect(df.citas).toHaveLength(1);
    expect(df.citas[0]).toMatchObject({ serviceId: "srv-ortosend", staffCalendarId: "sc-abraham-centro", behaviour: "confirmed" });
    expect(df.citas[0].note).toBe(`Ortosend · caso #${k.number} · Estudio de la pisada`);
    expect(df.citas[0].from.getTime()).toBe(appt.startsAt.getTime());
    const guardada = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(guardada).toMatchObject({ externalId: df.citas[0].id, externalState: "creada", externalError: null });
    expect(await prisma.patientExternalRef.count({ where: { patientId: p.id } })).toBe(1);
  });

  it("no duplica la ficha: reutiliza la guardada y encuentra la que ya existía en Docfav por móvil y nombre", async () => {
    const { clinic } = await escenario();
    df.clientes.push({ id: "cli-previo", firstname: "Joan", lastname: "Puig", phone: "+34 633 999 002", email: null });
    const p = await paciente(clinic.id, { name: "Joan Puig", phone: "633999002", email: "joan2@conector.test" });
    const k1 = await caso(clinic.id, p.id);
    await reservar(clinic.id, k1.id, a(540));
    await sincronizarCaso(k1.id);
    const k2 = await caso(clinic.id, p.id);
    await reservar(clinic.id, k2.id, a(540, addDays(LUNES, 1)));
    await sincronizarCaso(k2.id);
    expect(df.clientes).toHaveLength(1);
    expect(df.citas.map((c) => c.clientId)).toEqual(["cli-previo", "cli-previo"]);
    expect(df.llamadas.filter((l) => l.startsWith("createClient"))).toEqual([]);
  });

  it("si el email ya es de otra ficha (p. ej. la del padre), crea la del paciente sin email", async () => {
    const { clinic } = await escenario();
    df.clientes.push({ id: "cli-padre", firstname: "Pere", lastname: "Soler", phone: "+34633999003", email: "familia3@conector.test" });
    const p = await paciente(clinic.id, { name: "Laia Soler", phone: "633999999", email: "familia3@conector.test" });
    const k = await caso(clinic.id, p.id);
    await reservar(clinic.id, k.id, a(585));
    await sincronizarCaso(k.id);
    expect(df.clientes).toHaveLength(2);
    expect(df.clientes[1]).toMatchObject({ firstname: "Laia", lastname: "Soler", email: null });
  });

  it("anular en Ortosend la anula en Docfav; cambiar la hora anula la vieja y apunta la nueva", async () => {
    const { clinic } = await escenario();
    const p = await paciente(clinic.id, { name: "Marta", lastName: "Roca", phone: "633999004", email: "m4@conector.test" });
    const k = await caso(clinic.id, p.id);
    const vieja = await reservar(clinic.id, k.id, a(630));
    await sincronizarCaso(k.id);
    const nueva = await reservar(clinic.id, k.id, a(675), { replace: vieja.id });
    await sincronizarCaso(k.id);
    expect(df.citas.map((c) => [c.from.getTime(), c.behaviour])).toEqual([
      [a(630).getTime(), "cancelled"],
      [a(675).getTime(), "confirmed"],
    ]);
    await cancelAppointment(prisma, nueva.id, null, "No puede venir");
    await sincronizarCaso(k.id);
    expect(df.citas.map((c) => c.behaviour)).toEqual(["cancelled", "cancelled"]);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: nueva.id } })).externalState).toBe("cancelada");
  });

  it("si Docfav ya tiene esa hora ocupada (cita puesta después de la última lectura), la reserva se rechaza", async () => {
    const { clinic } = await escenario();
    const p = await paciente(clinic.id, { name: "Pau", phone: "633999005", email: "p5@conector.test" });
    const k = await caso(clinic.id, p.id);
    df.conflictos = [{ id: "ajena", type: "appointment", from: a(720).toISOString(), to: a(750).toISOString() }];
    await expect(reservar(clinic.id, k.id, a(720))).rejects.toThrow(AgendaError);
    expect(await prisma.appointment.count({ where: { caseId: k.id } })).toBe(0);
  });

  it("sin servicio válido la cita queda en error y el cron la apunta cuando la clínica lo crea", async () => {
    const { clinic } = await escenario({ serviceName: "Estudio Ortosend" });
    const p = await paciente(clinic.id, { name: "Rita", phone: "633999006", email: "r6@conector.test" });
    const k = await caso(clinic.id, p.id);
    const appt = await reservar(clinic.id, k.id, a(540, addDays(LUNES, 2)));
    await sincronizarCaso(k.id);
    const conError = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(conError.externalState).toBe("error");
    expect(conError.externalError).toMatch(/servicio activo llamado «Estudio Ortosend»/);
    df.servicios.push({ id: "srv-nuevo", name: "Estudio Ortosend", active: true, minutes: 45 });
    await mantenimientoConectores();
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).externalState).toBe("creada");
    expect(df.citas[0].serviceId).toBe("srv-nuevo");
  });
});

describe("ocupación de Docfav en la disponibilidad", () => {
  it("las citas ajenas de Docfav quitan huecos; las copias de Ortosend no cuentan dos veces", async () => {
    const { clinic, pro } = await escenario();
    const p = await paciente(clinic.id, { name: "Nil", phone: "633999007", email: "n7@conector.test" });
    const k = await caso(clinic.id, p.id);
    const propia = await reservar(clinic.id, k.id, a(540));
    await sincronizarCaso(k.id);
    const idPropia = (await prisma.appointment.findUniqueOrThrow({ where: { id: propia.id } })).externalId!;
    // Docfav devuelve su copia de la cita de Ortosend + una cita suya a las 10:30
    // en el domicilio (el mismo profesional) + una de otro profesional.
    df.ocupado = {
      "lugar-centro": [
        {
          staffId: "staff-abraham",
          staffCalendarId: "sc-abraham-centro",
          workingHours: [],
          appointments: [{ id: idPropia, from: a(540).toISOString(), to: a(585).toISOString(), behaviour: "confirmed" }],
          reservations: [],
          absences: [],
        },
        {
          staffId: "otro",
          staffCalendarId: "sc-otro",
          workingHours: [],
          appointments: [{ id: "x", from: a(585).toISOString(), to: a(630).toISOString(), behaviour: "confirmed" }],
          reservations: [],
          absences: [],
        },
      ],
      "lugar-casa": [
        {
          staffId: "staff-abraham",
          staffCalendarId: "sc-abraham-casa",
          workingHours: [],
          appointments: [{ id: "domicilio", from: a(630).toISOString(), to: a(660).toISOString(), behaviour: "confirmed" }],
          reservations: [],
          absences: [],
        },
      ],
    };
    const r = await leerOcupacion((await prisma.calendarConnector.findFirstOrThrow({ where: { clinicId: clinic.id } })).id);
    expect(r).toMatchObject({ ok: true, tramos: 1 });
    const agenda = await loadClinicAgenda(prisma, clinic.id, LUNES, LUNES);
    const horas = (availabilityOf(agenda, LUNES, LUNES, "online", pro.id).get(dateKey(LUNES)) ?? []).map((s) =>
      s.startsAt.toLocaleTimeString("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })
    );
    // 09:00 la ocupa la cita de Ortosend; 10:30 la de Docfav en el domicilio.
    expect(horas).toEqual(["09:45", "11:15", "12:00"]);
  });
});
