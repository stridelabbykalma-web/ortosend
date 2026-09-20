-- Flujo B: contador de invitaciones enviadas (reenvíos automáticos limitados).
ALTER TABLE "User" ADD COLUMN "inviteCount" INTEGER NOT NULL DEFAULT 0;
UPDATE "User" SET "inviteCount" = 1 WHERE "invitedAt" IS NOT NULL;
