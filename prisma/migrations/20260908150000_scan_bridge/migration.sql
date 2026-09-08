-- Puente de escaneo: el PC del escáner (RevoScan) sube cada modelo 3D a la
-- bandeja de la clínica y se asocia al caso que está esperando el escaneo.
ALTER TABLE "Case" ADD COLUMN "scanWaitingAt" TIMESTAMP(3);

CREATE TABLE "ScanAgent" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Puente de escaneo',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ScanAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScanUpload" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "agentId" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "encoding" TEXT,
    "storedBytes" INTEGER,
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

CREATE UNIQUE INDEX "ScanUpload_mediaId_key" ON "ScanUpload"("mediaId");

ALTER TABLE "ScanAgent" ADD CONSTRAINT "ScanAgent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScanUpload" ADD CONSTRAINT "ScanUpload_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScanUpload" ADD CONSTRAINT "ScanUpload_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "ScanAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
