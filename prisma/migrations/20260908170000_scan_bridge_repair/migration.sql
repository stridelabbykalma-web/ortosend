-- Reparación: la migración 20260908150000_scan_bridge se aplicó en producción
-- en una versión anterior (Case.scanCode) antes de quedar en su forma final
-- (Case.scanWaitingAt + ScanUpload). Esta migración lleva cualquier base al
-- estado final y es idempotente: no hace nada donde ya esté todo.

ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "scanWaitingAt" TIMESTAMP(3);
DROP INDEX IF EXISTS "Case_scanCode_key";
ALTER TABLE "Case" DROP COLUMN IF EXISTS "scanCode";

CREATE TABLE IF NOT EXISTS "ScanAgent" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Puente de escaneo',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ScanAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ScanUpload" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "agentId" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storage" TEXT NOT NULL,
    "key" TEXT,
    "bytes" BYTEA,
    "status" TEXT NOT NULL DEFAULT 'pendiente',
    "receivedAt" TIMESTAMP(3),
    "caseId" TEXT,
    "mediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScanUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ScanUpload_mediaId_key" ON "ScanUpload"("mediaId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ScanAgent_clinicId_fkey') THEN
    ALTER TABLE "ScanAgent" ADD CONSTRAINT "ScanAgent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ScanUpload_clinicId_fkey') THEN
    ALTER TABLE "ScanUpload" ADD CONSTRAINT "ScanUpload_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ScanUpload_agentId_fkey') THEN
    ALTER TABLE "ScanUpload" ADD CONSTRAINT "ScanUpload_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ScanAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
