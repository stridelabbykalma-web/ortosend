"use server";

// Aceptación web de los documentos del alta (respaldo del flujo de WhatsApp).
// Registra documento a documento con canal «web_alta» y abre la ficha clínica
// igual que el webhook de ManyChat.
import { redirect } from "next/navigation";
import type { ConsentAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashSecreto } from "@/lib/consent/tokens";
import { OBLIGATORIOS, ORDEN, SLUG, esObligatorio } from "@/lib/consent/tipos";
import { registrar } from "@/lib/consent/registro";
import { abrirFichaTrasAceptar } from "@/lib/alta";
import { origenPeticion, permitirPublico } from "@/lib/rate-limit";

export async function aceptarAltaWebAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const back = (msg: string): never => redirect(`/alta/${encodeURIComponent(token)}?error=` + encodeURIComponent(msg));
  if (!(await permitirPublico("alta-web"))) back("Demasiadas peticiones. Espera un minuto.");
  const inv = await prisma.consentInvitation.findUnique({ where: { webTokenHash: hashSecreto(token) } });
  if (!inv || inv.invalidatedAt) back("Este enlace ya no es válido. Pide a tu clínica que te lo reenvíe.");
  if (inv!.completedAt) redirect(`/alta/${encodeURIComponent(token)}`);
  if (inv!.expiresAt <= new Date()) back("El enlace ha caducado. Pide a tu clínica que te lo reenvíe.");

  // Validación de las casillas (el navegador ya las exige, pero nunca se confía en él).
  for (const t of OBLIGATORIOS) if (formData.get(`acepto_${SLUG[t]}`) !== "on") back("Para continuar debes aceptar los cuatro documentos obligatorios.");
  const marketing = formData.get("marketing");
  if (marketing !== "acepto" && marketing !== "rechazo") back("Indica si aceptas o no las comunicaciones comerciales.");

  const { ip, userAgent } = await origenPeticion();
  await prisma.$transaction(async (tx) => {
    // Serializa con el webhook de WhatsApp (el paciente podría tener ambos abiertos).
    await tx.$executeRaw`SELECT 1 FROM "consent_invitations" WHERE "id" = ${inv!.id} FOR UPDATE`;
    const vigente = await tx.consentInvitation.findUniqueOrThrow({ where: { id: inv!.id } });
    if (vigente.completedAt || vigente.invalidatedAt) return;
    const patient = await tx.patient.findUniqueOrThrow({ where: { id: vigente.patientId } });
    const textos = vigente.legalTextIds as Record<string, string>;
    const ya = await tx.consentLog.findMany({ where: { invitationId: vigente.id }, orderBy: { seq: "asc" } });
    const ultimas: Partial<Record<string, ConsentAction>> = {};
    for (const r of ya) ultimas[r.type] = r.action;
    for (const t of ORDEN) {
      const action: ConsentAction = esObligatorio(t) ? "ACEPTADO" : marketing === "acepto" ? "ACEPTADO" : "RECHAZADO";
      if (ultimas[t] === action) continue; // ya registrado igual por WhatsApp
      await registrar(tx, {
        patientId: patient.id,
        professionalId: patient.professionalId,
        type: t,
        action,
        legalTextId: textos[t],
        actor: vigente.recipient === "tutor" ? "tutor" : "paciente",
        channel: "web_alta",
        invitationId: vigente.id,
        ip,
        userAgent,
      });
    }
    await tx.consentInvitation.update({ where: { id: vigente.id }, data: { completedAt: new Date(), startedAt: vigente.startedAt ?? new Date() } });
    await tx.patient.update({ where: { id: patient.id }, data: { status: "ACEPTADO" } });
    await abrirFichaTrasAceptar(tx, patient, "web");
  });
  redirect(`/alta/${encodeURIComponent(token)}`);
}
