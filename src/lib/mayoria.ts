// Traspaso de la cuenta al cumplir la mayoría de edad sanitaria (16 años).
// El cron diario detecta a los menores que ya la han cumplido y les envía por
// email un enlace para crear su contraseña y confirmar su email y su móvil;
// al titular (padre/madre/tutor) se le avisa de que dejará de tener acceso.
// El titular puede reenviar el aviso desde su panel si el enlace caduca.
import type { Patient, User } from "@prisma/client";
import { prisma } from "./db";
import { createHandoverToken } from "./auth";
import { notifyEmail, notifyOwner, pushEvent } from "./cases";
import { EDAD_MAYORIA_SALUD, HANDOVER_TOKEN_DAYS, edadEn } from "./edad";

export type AvisoMayoria = "enviado" | "sin_email" | "no_procede";

// Envía (o reenvía) el aviso al paciente. Devuelve qué ha pasado.
export async function enviarAvisoMayoria(patient: Patient, owner: User): Promise<AvisoMayoria> {
  if (!patient.isMinor || patient.handoverAt || !patient.birthDate) return "no_procede";
  const edad = edadEn(patient.birthDate);
  if (edad < EDAD_MAYORIA_SALUD) return "no_procede";
  const base = { paciente: patient.name, edad, titular: owner.name };
  if (!patient.email) {
    // Sin email del menor no hay a quién enviar el enlace: se pide al titular
    // (como mucho una vez por semana, el cron pasa cada día).
    const hace7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const reciente = await prisma.notification.findFirst({
      where: { template: "mayoria_edad_sin_email", createdAt: { gt: hace7d }, payload: { path: ["patientId"], equals: patient.id } },
    });
    if (!reciente)
      await notifyOwner(owner, patient.consents, "mayoria_edad_sin_email", {
        ...base,
        patientId: patient.id,
        nombre: owner.name,
        enlace: "/panel",
      });
    return "sin_email";
  }
  const token = await createHandoverToken(patient.id, HANDOVER_TOKEN_DAYS);
  await notifyEmail(patient.email, "mayoria_edad", {
    ...base,
    nombre: patient.name,
    enlace: `/mayoria?token=${token}`,
    validez: `${HANDOVER_TOKEN_DAYS} días`,
  });
  await notifyOwner(owner, patient.consents, "mayoria_edad_titular", {
    ...base,
    nombre: owner.name,
    emailPaciente: patient.email,
  });
  await prisma.patient.update({ where: { id: patient.id }, data: { handoverNoticeAt: new Date() } });
  const cases = await prisma.case.findMany({ where: { patientId: patient.id }, select: { id: true } });
  for (const c of cases)
    await pushEvent(c.id, `Paciente con ${edad} años: aviso enviado para que gestione su propia cuenta`, "sistema");
  return "enviado";
}
