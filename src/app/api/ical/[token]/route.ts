// Feed iCal privado (suscripción desde Outlook, Google Calendar o Apple
// Calendar). El token identifica a un profesional (sus citas) o a una clínica
// (todas sus citas). Solo avisos: nombre del paciente y tipo de cita, nunca
// contenido clínico. Se regenera desde el panel; el anterior deja de valer.
import { prisma } from "@/lib/db";
import { APPOINTMENT_KIND_LABEL } from "@/lib/agenda";

export const dynamic = "force-dynamic";

function icsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 16) return new Response("Not found", { status: 404 });

  const [user, clinic] = await Promise.all([
    prisma.user.findUnique({ where: { calendarToken: token }, include: { clinic: true } }),
    prisma.clinic.findUnique({ where: { calendarToken: token } }),
  ]);
  if (!user && !clinic) return new Response("Not found", { status: 404 });
  if (user && (!user.active || !user.clinicId)) return new Response("Not found", { status: 404 });

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const appointments = await prisma.appointment.findMany({
    where: user
      ? { professionalId: user.id, startsAt: { gte: since } }
      : { clinicId: clinic!.id, startsAt: { gte: since } },
    include: { case: { include: { patient: true } }, professional: { select: { name: true } }, clinic: true },
    orderBy: { startsAt: "asc" },
  });

  const calName = user ? `Ortosend — ${user.name}` : `Ortosend — ${clinic!.name}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ortosend//Agenda//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calName)}`,
    "X-WR-TIMEZONE:Europe/Madrid",
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
  ];
  for (const a of appointments) {
    const cancelled = a.status === "CANCELADA" || a.status === "NO_PRESENTADO";
    const kind = APPOINTMENT_KIND_LABEL[a.kind] ?? a.kind;
    const summary = `${cancelled ? "[Anulada] " : ""}${kind} — ${a.case.patient.name} (#${a.case.number})`;
    const desc = [
      `Caso #${a.case.number} · ${kind}`,
      a.professional ? `Profesional: ${a.professional.name}` : "Agenda de la clínica",
      a.notes ?? "",
      "Detalle en el panel de Ortosend.",
    ]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${a.id}@ortosend`,
      `DTSTAMP:${icsDate(a.createdAt)}`,
      `DTSTART:${icsDate(a.startsAt)}`,
      `DTEND:${icsDate(a.endsAt)}`,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(desc)}`,
      `LOCATION:${esc(`${a.clinic.name}, ${a.clinic.address}`)}`,
      `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  const body = lines.map((l) => foldLine(l)).join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="ortosend.ics"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

// RFC 5545: líneas de máximo 75 octetos, continuación con espacio.
function foldLine(line: string) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  let first = true;
  while (i < bytes.length) {
    const max = first ? 75 : 74;
    let end = Math.min(i + max, bytes.length);
    // No partir un carácter UTF-8 multibyte
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((first ? "" : " ") + bytes.subarray(i, end).toString("utf8"));
    i = end;
    first = false;
  }
  return out.join("\r\n");
}
