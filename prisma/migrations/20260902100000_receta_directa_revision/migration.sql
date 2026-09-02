-- Receta directa: elección al crear el caso y revisión opcional (opinión de Ortosend)
ALTER TABLE "Case" ADD COLUMN "rxMode" TEXT;
ALTER TABLE "Case" ADD COLUMN "reviewQuestion" TEXT;
ALTER TABLE "Case" ADD COLUMN "reviewRequestedAt" TIMESTAMP(3);
ALTER TABLE "Case" ADD COLUMN "reviewAnswer" TEXT;
ALTER TABLE "Case" ADD COLUMN "reviewAnsweredBy" TEXT;
ALTER TABLE "Case" ADD COLUMN "reviewAnsweredAt" TIMESTAMP(3);
