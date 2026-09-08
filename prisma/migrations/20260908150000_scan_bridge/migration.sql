-- Puente de escaneo: código de carpeta por caso (RevoScan guarda ahí el
-- modelo 3D) y agente local autorizado por clínica.
ALTER TABLE "Case" ADD COLUMN "scanCode" TEXT;

CREATE UNIQUE INDEX "Case_scanCode_key" ON "Case"("scanCode");

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

ALTER TABLE "ScanAgent" ADD CONSTRAINT "ScanAgent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
