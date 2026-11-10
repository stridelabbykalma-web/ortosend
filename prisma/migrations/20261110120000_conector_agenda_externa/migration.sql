-- Conector con el programa de gestión de la clínica (Docfav): clave cifrada,
-- enlaces entre agendas, tramos ocupados externos, ficha del paciente en el
-- programa y estado de la copia de cada cita.

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "externalAt" TIMESTAMP(3),
ADD COLUMN     "externalError" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalState" TEXT;

-- CreateTable
CREATE TABLE "CalendarConnector" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "apiKeyEnc" TEXT NOT NULL,
    "apiKeyHint" TEXT NOT NULL,
    "externalClinicId" TEXT,
    "externalClinicName" TEXT,
    "serviceName" TEXT NOT NULL DEFAULT 'Ortosend',
    "serviceId" TEXT,
    "respectHours" BOOLEAN NOT NULL DEFAULT true,
    "pushAppointments" BOOLEAN NOT NULL DEFAULT true,
    "syncedFrom" TIMESTAMP(3),
    "syncedTo" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "syncingAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorLink" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "professionalId" TEXT,
    "externalCalendarId" TEXT NOT NULL,
    "externalPlaceId" TEXT NOT NULL,
    "externalStaffId" TEXT NOT NULL,
    "externalName" TEXT NOT NULL,

    CONSTRAINT "ConnectorLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalBusy" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "professionalId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT,

    CONSTRAINT "ExternalBusy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientExternalRef" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnector_clinicId_kind_key" ON "CalendarConnector"("clinicId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorLink_connectorId_externalCalendarId_key" ON "ConnectorLink"("connectorId", "externalCalendarId");

-- CreateIndex
CREATE INDEX "ExternalBusy_clinicId_startsAt_idx" ON "ExternalBusy"("clinicId", "startsAt");

-- CreateIndex
CREATE INDEX "ExternalBusy_connectorId_startsAt_idx" ON "ExternalBusy"("connectorId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatientExternalRef_patientId_connectorId_key" ON "PatientExternalRef"("patientId", "connectorId");

-- AddForeignKey
ALTER TABLE "CalendarConnector" ADD CONSTRAINT "CalendarConnector_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorLink" ADD CONSTRAINT "ConnectorLink_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "CalendarConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalBusy" ADD CONSTRAINT "ExternalBusy_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "CalendarConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientExternalRef" ADD CONSTRAINT "PatientExternalRef_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientExternalRef" ADD CONSTRAINT "PatientExternalRef_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "CalendarConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

