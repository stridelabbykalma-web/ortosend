-- Confección en el taller: catálogo de materiales, hoja de confección del par (proceso, capas,
-- tiempos y coste) y ajustes de coste. Lo usan el panel del taller y el Rectificador (programa del taller).

-- CreateEnum
CREATE TYPE "TipoMaterial" AS ENUM ('BASE', 'REFUERZO', 'FORRO', 'ADHESIVO', 'OTRO');

-- CreateEnum
CREATE TYPE "ProcesoConfeccion" AS ENUM ('TERMOFORMADO', 'CAPAS');

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoMaterial" NOT NULL DEFAULT 'BASE',
    "grosorMm" DOUBLE PRECISION,
    "dureza" TEXT,
    "planchaAnchoMm" INTEGER,
    "planchaLargoMm" INTEGER,
    "precioCents" INTEGER NOT NULL DEFAULT 0,
    "paresPorPlancha" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HojaConfeccion" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "proceso" "ProcesoConfeccion" NOT NULL DEFAULT 'TERMOFORMADO',
    "capas" JSONB NOT NULL DEFAULT '[]',
    "notas" TEXT,
    "minutosCnc" INTEGER NOT NULL DEFAULT 0,
    "minutosConfeccion" INTEGER NOT NULL DEFAULT 0,
    "costeMaterialCents" INTEGER NOT NULL DEFAULT 0,
    "costeFresadoCents" INTEGER NOT NULL DEFAULT 0,
    "costeManoObraCents" INTEGER NOT NULL DEFAULT 0,
    "costeTotalCents" INTEGER NOT NULL DEFAULT 0,
    "actualizadoPor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HojaConfeccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AjustesTaller" (
    "id" TEXT NOT NULL DEFAULT 'taller',
    "precioHoraCents" INTEGER NOT NULL DEFAULT 2000,
    "costeCncMinutoCents" INTEGER NOT NULL DEFAULT 20,
    "costeMoldeCents" INTEGER NOT NULL DEFAULT 300,
    "minutosCnc" INTEGER NOT NULL DEFAULT 30,
    "minutosConfeccion" INTEGER NOT NULL DEFAULT 45,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AjustesTaller_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HojaConfeccion_caseId_key" ON "HojaConfeccion"("caseId");

-- AddForeignKey
ALTER TABLE "HojaConfeccion" ADD CONSTRAINT "HojaConfeccion_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Materiales de ejemplo (precios orientativos: el taller los cambia desde el Rectificador).
INSERT INTO "Material" ("id", "nombre", "tipo", "grosorMm", "dureza", "planchaAnchoMm", "planchaLargoMm", "precioCents", "paresPorPlancha", "orden", "updatedAt") VALUES
  ('mat_eva_3_45', 'EVA 3 mm', 'BASE', 3, '45 Shore A', 1000, 1500, 2500, 20, 10, CURRENT_TIMESTAMP),
  ('mat_eva_5_30', 'EVA 5 mm', 'BASE', 5, '30 Shore A', 1000, 1500, 3200, 20, 20, CURRENT_TIMESTAMP),
  ('mat_pp_2', 'Polipropileno 2 mm', 'REFUERZO', 2, NULL, 1000, 2000, 3000, 25, 30, CURRENT_TIMESTAMP),
  ('mat_resina_15', 'Resina termoplástica 1,5 mm', 'REFUERZO', 1.5, NULL, 500, 1000, 4500, 6, 40, CURRENT_TIMESTAMP),
  ('mat_forro_piel', 'Forro piel sintética', 'FORRO', 1, NULL, 1000, 1400, 1800, 18, 50, CURRENT_TIMESTAMP),
  ('mat_forro_micro', 'Forro microfibra', 'FORRO', 1.2, NULL, 1000, 1400, 2200, 18, 60, CURRENT_TIMESTAMP),
  ('mat_cola', 'Cola de contacto', 'ADHESIVO', NULL, NULL, NULL, NULL, 1500, 40, 70, CURRENT_TIMESTAMP);

INSERT INTO "AjustesTaller" ("id", "updatedAt") VALUES ('taller', CURRENT_TIMESTAMP);
