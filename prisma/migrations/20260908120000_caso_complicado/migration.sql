-- Caso marcado como complicado: pide una segunda opinión al resto de prescriptores
ALTER TABLE "Case" ADD COLUMN "hardAt" TIMESTAMP(3);
ALTER TABLE "Case" ADD COLUMN "hardBy" TEXT;
ALTER TABLE "Case" ADD COLUMN "hardByName" TEXT;
ALTER TABLE "Case" ADD COLUMN "hardNote" TEXT;
