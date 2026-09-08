-- CreateTable
CREATE TABLE "ProfessionalApplication" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "degree" TEXT NOT NULL,
    "canPrescribe" BOOLEAN NOT NULL DEFAULT false,
    "collegiateNum" TEXT,
    "college" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'recibida',
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalApplication_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProfessionalApplication" ADD CONSTRAINT "ProfessionalApplication_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
