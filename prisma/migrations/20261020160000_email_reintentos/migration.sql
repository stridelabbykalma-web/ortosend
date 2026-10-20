-- Reintentos y rebotes de los avisos por email.
ALTER TABLE "Notification"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "bouncedAt" TIMESTAMP(3);
