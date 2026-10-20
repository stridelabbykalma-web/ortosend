-- Respaldo por email del alta por WhatsApp: enlace web de aceptación con token
-- propio (independiente del ref de ManyChat) y registro del envío por email.
ALTER TABLE "consent_invitations"
  ADD COLUMN "webTokenHash" TEXT,
  ADD COLUMN "toEmail" TEXT,
  ADD COLUMN "emailSentAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "consent_invitations_webTokenHash_key" ON "consent_invitations"("webTokenHash");
