// Lectura y validación de la hora elegida en el calendario (formularios de
// reserva del visitante, del cliente y del panel de clínica).
import { z } from "zod";
import { AgendaError } from "./agenda-db";

// Hora elegida en el calendario: ISO UTC y agenda ("" cualquiera · "clinica" · id)
const slotSchema = z.object({
  startsAt: z.string().min(1, "Elige un día y una hora en el calendario"),
  professionalId: z.string().optional(),
});

export type SlotOk = { ok: true; startsAt: Date; professionalId: string | null | undefined };
export type SlotChoice = { ok: false; error: string } | SlotOk;

export function parseSlot(formData: FormData): SlotChoice {
  const parsed = slotSchema.safeParse({ startsAt: formData.get("startsAt"), professionalId: formData.get("professionalId") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const startsAt = new Date(parsed.data.startsAt);
  if (isNaN(+startsAt) || startsAt < new Date()) return { ok: false, error: "Elige un día y una hora en el calendario" };
  const p = parsed.data.professionalId ?? "";
  const professionalId = p === "" ? undefined : p === "clinica" ? null : p;
  return { ok: true, startsAt, professionalId };
}

// Mensaje para el usuario cuando la reserva falla por agenda.
export function agendaErrorMessage(e: unknown) {
  if (e instanceof AgendaError) {
    if (e.message === "NO_DISPONIBLE") return "Esa hora acaba de ser reservada por otra persona. Elige otra.";
    return e.message;
  }
  throw e;
}
