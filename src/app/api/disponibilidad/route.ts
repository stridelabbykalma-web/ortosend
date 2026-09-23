// Huecos disponibles de una clínica por días (hora local de la clínica).
// Público en modo `online` (reserva web y panel del cliente); el personal de
// la clínica puede pedir `mode=staff` para ver todo el horario.
//   GET /api/disponibilidad?clinicId=…&from=YYYY-MM-DD&to=YYYY-MM-DD[&pro=<id|clinica>][&mode=staff]
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { addDays, compareDates, dateKey, parseDateKey, todayLocal } from "@/lib/agenda";
import { agendaResources, availabilityOf, loadClinicAgenda } from "@/lib/agenda-db";

export const dynamic = "force-dynamic";

const MAX_DAYS = 62;

export type DisponibilidadResponse = {
  timezone: string;
  slotMinutes: number;
  from: string;
  to: string;
  horizonEnd: string | null;
  patientPicksPro: boolean;
  professionals: { id: string; name: string }[];
  // Por día: horas de inicio (ISO UTC) y qué agendas la ofrecen (null = clínica).
  days: Record<string, { t: string; pros: (string | null)[] }[]>;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clinicId = searchParams.get("clinicId") ?? "";
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
  if (!clinic || clinic.status !== "ACTIVA") return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  let mode: "online" | "staff" = "online";
  if (searchParams.get("mode") === "staff") {
    const u = await getSessionUser();
    const staff = u && (u.role === "PROFESIONAL" || u.role === "ADMIN_CLINICA") && u.clinicId === clinicId;
    if (!staff && u?.role !== "ADMIN") return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    mode = "staff";
  }

  const today = todayLocal(clinic.timezone);
  let from = parseDateKey(searchParams.get("from")) ?? today;
  let to = parseDateKey(searchParams.get("to")) ?? addDays(from, 27);
  if (compareDates(from, today) < 0) from = today;
  if (compareDates(to, from) < 0) to = from;
  if (compareDates(to, addDays(from, MAX_DAYS - 1)) > 0) to = addDays(from, MAX_DAYS - 1);

  const proParam = searchParams.get("pro");
  const professionalId = !proParam ? undefined : proParam === "clinica" ? null : proParam;

  const agenda = await loadClinicAgenda(prisma, clinicId, from, to);
  const map = availabilityOf(agenda, from, to, mode, professionalId);

  const days: DisponibilidadResponse["days"] = {};
  for (const [key, slots] of map) {
    const byTime = new Map<string, (string | null)[]>();
    for (const s of slots) {
      const t = s.startsAt.toISOString();
      const list = byTime.get(t) ?? [];
      list.push(s.professionalId);
      byTime.set(t, list);
    }
    days[key] = [...byTime.entries()].map(([t, pros]) => ({ t, pros }));
  }

  // Profesionales con agenda propia (para el selector, si la clínica lo permite)
  const professionals = agendaResources(agenda)
    .filter((r): r is { id: string; name: string } => r.id !== null)
    .map((r) => ({ id: r.id, name: r.name }));

  const body: DisponibilidadResponse = {
    timezone: clinic.timezone,
    slotMinutes: clinic.slotMinutes,
    from: dateKey(from),
    to: dateKey(to),
    horizonEnd: mode === "online" ? dateKey(addDays(today, clinic.bookingHorizonDays)) : null,
    patientPicksPro: mode === "staff" ? true : clinic.patientPicksPro,
    professionals,
    days,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
