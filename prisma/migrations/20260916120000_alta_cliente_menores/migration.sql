-- Alta de cliente (Flujo A): motivo de la reserva, recordatorio de la víspera,
-- bloqueo de hueco durante la reserva, menores con contacto propio y traspaso
-- de la cuenta a los 16 años, y cola de avisos con canal email.
ALTER TABLE "Slot" ADD COLUMN "holdKey" TEXT;

ALTER TABLE "Patient" ADD COLUMN "email" TEXT;
ALTER TABLE "Patient" ADD COLUMN "phone" TEXT;
ALTER TABLE "Patient" ADD COLUMN "handoverNoticeAt" TIMESTAMP(3);
ALTER TABLE "Patient" ADD COLUMN "handoverAt" TIMESTAMP(3);

ALTER TABLE "Case" ADD COLUMN "reason" TEXT;
ALTER TABLE "Case" ADD COLUMN "reminderSentAt" TIMESTAMP(3);

ALTER TABLE "Notification" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE "Notification" ADD COLUMN "toEmail" TEXT;
ALTER TABLE "Notification" ALTER COLUMN "toPhone" DROP NOT NULL;
