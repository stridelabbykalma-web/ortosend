"use server";

// El paciente (o su tutor) retira un consentimiento desde su perfil.
import { redirect } from "next/navigation";
import type { ConsentType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { reactivarMarketing, revocar } from "@/lib/alta";
import { ORDEN, esObligatorio } from "@/lib/consent/tipos";
import { origenPeticion } from "@/lib/rate-limit";

export async function gestionarDesdePerfilAction(formData: FormData) {
  const u = await requireRole("CLIENTE");
  const patientId = String(formData.get("patientId") ?? "");
  const type = String(formData.get("type") ?? "") as ConsentType;
  const p = await prisma.patient.findFirst({ where: { id: patientId, ownerId: u.id } });
  if (!p || !ORDEN.includes(type)) redirect("/panel");
  const { ip, userAgent } = await origenPeticion();
  const base = {
    patientId: p!.id,
    actor: p!.isMinor ? ("tutor" as const) : ("paciente" as const),
    channel: "web_perfil" as const,
    actorUserId: u.id,
    ip,
    userAgent,
  };
  if (formData.get("op") === "aceptar" && type === "MARKETING") {
    await reactivarMarketing(base);
    redirect("/panel?ok=" + encodeURIComponent("Comunicaciones comerciales activadas"));
  }
  if (esObligatorio(type) && formData.get("entiendo") !== "on")
    redirect("/panel?error=" + encodeURIComponent("Marca la casilla para confirmar que entiendes las consecuencias"));
  await revocar({ ...base, type });
  redirect("/panel?ok=" + encodeURIComponent("Consentimiento retirado. El cambio ha quedado registrado."));
}
