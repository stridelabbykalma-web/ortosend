"use server";

import { redirect } from "next/navigation";
import type { ConsentType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { reactivarMarketing, revocar } from "@/lib/alta";
import { ORDEN, esObligatorio } from "@/lib/consent/tipos";
import { hashSecreto } from "@/lib/consent/tokens";
import { origenPeticion } from "@/lib/rate-limit";
import { pacientesDelTelefono } from "./datos";

// Retirar (o volver a aceptar marketing) desde el enlace de gestión, sin cuenta.
export async function gestionarDesdeEnlaceAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const back = `/consentimientos/${encodeURIComponent(token)}`;
  const t = await prisma.consentManageToken.findUnique({ where: { tokenHash: hashSecreto(token) } });
  if (!t || t.expiresAt <= new Date()) redirect(back);
  const patientId = String(formData.get("patientId") ?? "");
  const type = String(formData.get("type") ?? "") as ConsentType;
  if (!ORDEN.includes(type)) redirect(back);
  const p = (await pacientesDelTelefono(t!.phone)).find((x) => x.id === patientId);
  if (!p) redirect(back);
  const { ip, userAgent } = await origenPeticion();
  const base = { patientId, actor: p!.isMinor ? ("tutor" as const) : ("paciente" as const), channel: "web_gestion" as const, ip, userAgent };
  if (formData.get("op") === "aceptar" && type === "MARKETING") await reactivarMarketing(base);
  else {
    if (esObligatorio(type) && formData.get("entiendo") !== "on") redirect(back);
    await revocar({ ...base, type });
  }
  redirect(back + "?ok=" + encodeURIComponent("Hecho. El cambio ha quedado registrado."));
}
