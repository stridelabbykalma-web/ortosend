-- Rebotes de email por id de Resend + índices de consulta de la cola, y
-- marcador atómico del último recordatorio de pago enviado por caso.
ALTER TABLE "Notification" ADD COLUMN "resendId" TEXT;
CREATE INDEX "Notification_template_createdAt_idx" ON "Notification"("template", "createdAt");
CREATE INDEX "Notification_resendId_idx" ON "Notification"("resendId");
CREATE INDEX "Notification_channel_sentAt_failedAt_idx" ON "Notification"("channel", "sentAt", "failedAt");
ALTER TABLE "Case" ADD COLUMN "payReminderDay" INTEGER NOT NULL DEFAULT 0;
