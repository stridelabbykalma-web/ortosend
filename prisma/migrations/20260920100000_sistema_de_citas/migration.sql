-- Sistema de citas: agenda por clínica y por profesional (horario semanal,
-- excepciones), citas con estado y ajustes de reserva online. Sustituye a los
-- huecos sueltos (Slot). Los huecos reservados pasan a ser citas del caso y los
-- huecos libres futuros se conservan como aperturas puntuales, para que la
-- clínica no pierda lo que tenía publicado hasta que configure su horario.


-- CreateEnum
CREATE TYPE "ExceptionKind" AS ENUM ('CIERRE', 'APERTURA');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('RESERVADA', 'CONFIRMADA', 'COMPLETADA', 'CANCELADA', 'NO_PRESENTADO');

-- CreateEnum
CREATE TYPE "AppointmentKind" AS ENUM ('ESTUDIO', 'REPETICION', 'REVISION', 'AJUSTE');

-- DropForeignKey
ALTER TABLE "Slot" DROP CONSTRAINT "Slot_clinicId_fkey";

-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "bookingHorizonDays" INTEGER NOT NULL DEFAULT 45,
ADD COLUMN     "calendarToken" TEXT,
ADD COLUMN     "minNoticeHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "onlineBooking" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "patientPicksPro" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slotMinutes" INTEGER NOT NULL DEFAULT 45,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "calendarToken" TEXT;

-- CreateTable
CREATE TABLE "AvailabilityRule" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "professionalId" TEXT,
    "weekday" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "online" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityException" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "professionalId" TEXT,
    "kind" "ExceptionKind" NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "startMin" INTEGER,
    "endMin" INTEGER,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "online" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "professionalId" TEXT,
    "caseId" TEXT NOT NULL,
    "kind" "AppointmentKind" NOT NULL DEFAULT 'ESTUDIO',
    "status" "AppointmentStatus" NOT NULL DEFAULT 'RESERVADA',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "bookedBy" TEXT,
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AvailabilityRule_clinicId_weekday_idx" ON "AvailabilityRule"("clinicId", "weekday");

-- CreateIndex
CREATE INDEX "AvailabilityException_clinicId_startsOn_endsOn_idx" ON "AvailabilityException"("clinicId", "startsOn", "endsOn");

-- CreateIndex
CREATE INDEX "Appointment_clinicId_startsAt_idx" ON "Appointment"("clinicId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_professionalId_startsAt_idx" ON "Appointment"("professionalId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_caseId_idx" ON "Appointment"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_calendarToken_key" ON "Clinic"("calendarToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_calendarToken_key" ON "User"("calendarToken");

-- AddForeignKey
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityException" ADD CONSTRAINT "AvailabilityException_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityException" ADD CONSTRAINT "AvailabilityException_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Migración de datos: Slot → Appointment / AvailabilityException
INSERT INTO "Appointment" ("id", "clinicId", "caseId", "kind", "status", "startsAt", "endsAt", "source", "createdAt")
SELECT s."id", s."clinicId", s."caseId", 'ESTUDIO', 
       CASE WHEN c."state" = 'CITA_RESERVADA' THEN 'RESERVADA'::"AppointmentStatus" ELSE 'COMPLETADA'::"AppointmentStatus" END,
       s."startsAt", s."startsAt" + INTERVAL '45 minutes', 'web', CURRENT_TIMESTAMP
FROM "Slot" s JOIN "Case" c ON c."id" = s."caseId"
WHERE s."caseId" IS NOT NULL;

INSERT INTO "AvailabilityException" ("id", "clinicId", "kind", "startsOn", "endsOn", "startMin", "endMin", "capacity", "online", "note", "createdAt")
SELECT 'slot_' || s."id", s."clinicId", 'APERTURA',
       (s."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid')::date,
       (s."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid')::date,
       EXTRACT(HOUR FROM (s."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid'))::int * 60
         + EXTRACT(MINUTE FROM (s."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid'))::int,
       EXTRACT(HOUR FROM (s."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid'))::int * 60
         + EXTRACT(MINUTE FROM (s."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid'))::int + 45,
       1, true, 'Hueco publicado antes del sistema de citas', CURRENT_TIMESTAMP
FROM "Slot" s
WHERE s."caseId" IS NULL AND s."startsAt" > CURRENT_TIMESTAMP;

-- DropTable
DROP TABLE "Slot";
