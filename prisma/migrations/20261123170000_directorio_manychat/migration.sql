-- CreateTable
CREATE TABLE "manychat_contactos" (
    "telefonoHash" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manychat_contactos_pkey" PRIMARY KEY ("telefonoHash")
);
