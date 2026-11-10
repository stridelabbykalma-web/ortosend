// Adaptador de calendario iCal (solo lectura). Cada agenda de Ortosend recibe
// el enlace iCal privado del calendario del profesional: Google Calendar,
// Outlook/Microsoft 365, Apple iCloud o cualquier programa de gestión que
// publique su agenda en ese formato. Todo lo que esté ocupado allí deja de
// ofrecerse en Ortosend. No apunta citas: para eso hace falta un programa con
// API (Docfav…) o suscribir en ese calendario el enlace iCal de Ortosend.
import { addDays, zonedToUtc } from "../agenda";
import { ocupadoDeIcal } from "./ical";
import { descargarTexto, EnlaceNoValido } from "./red";
import type { Tramo } from "./ocupacion";
import type { ProveedorIcal } from "./tipos";

export const ICAL: ProveedorIcal = {
  kind: "ICAL",
  modo: "ical",
  nombre: "Calendario iCal (Google, Outlook, Apple u otro programa)",
  corto: "su calendario",
  ayuda:
    "Pega el enlace iCal privado del calendario de cada profesional. Google Calendar: Configuración del calendario → «Dirección secreta en formato iCal». Outlook: Configuración → Calendario → Calendarios compartidos → Publicar calendario → enlace ICS. Apple iCloud: compartir calendario como público. Otros programas: busca «exportar», «suscribir» o «iCal».",

  async leer(ctx) {
    const desde = zonedToUtc(ctx.desde, 0, ctx.tz);
    const hasta = zonedToUtc(addDays(ctx.hasta, 1), 0, ctx.tz);
    const tramos: Tramo[] = [];
    const avisos: string[] = [];
    const enlacesFallidos: string[] = [];
    // Un fallo en un calendario no impide leer los demás.
    await Promise.all(
      ctx.enlaces.map(async (e) => {
        if (!e.secreto) return;
        try {
          const texto = await descargarTexto(e.secreto);
          if (!/BEGIN:VCALENDAR/i.test(texto)) throw new EnlaceNoValido("El enlace no devuelve un calendario iCal");
          // Las citas de Ortosend que el calendario ya tenga (suscripción a nuestro feed) no cuentan dos veces.
          const r = ocupadoDeIcal(texto, { tz: ctx.tz, desde, hasta, ignorarUid: (uid) => uid.endsWith("@ortosend") });
          for (const o of r.ocupado)
            tramos.push({ professionalId: e.professionalId, startsAt: o.startsAt, endsAt: o.endsAt, kind: "cita", externalId: o.uid || null });
          if (r.descartados) avisos.push(`${e.externalName}: ${r.descartados} eventos con un formato no reconocido no se han tenido en cuenta`);
        } catch (err) {
          avisos.push(`${e.externalName}: ${ICAL.explicarError(err)}`);
          enlacesFallidos.push(e.id);
        }
      })
    );
    return { tramos, avisos, enlacesFallidos };
  },

  explicarError(e) {
    if (e instanceof EnlaceNoValido) return e.message;
    return e instanceof Error ? e.message : String(e);
  },
};
