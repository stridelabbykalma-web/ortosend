-- CreateTable
CREATE TABLE "MaquinaCnc" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "creadaPor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaquinaCnc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacaCnc" (
    "id" TEXT NOT NULL,
    "maquinaId" TEXT NOT NULL,
    "anchoMm" DOUBLE PRECISION NOT NULL,
    "largoMm" DOUBLE PRECISION NOT NULL,
    "altoMm" DOUBLE PRECISION NOT NULL,
    "puestaAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "puestaPor" TEXT NOT NULL,

    CONSTRAINT "PlacaCnc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TiradaPlaca" (
    "id" TEXT NOT NULL,
    "placaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "zonas" JSONB NOT NULL,
    "creadaPor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladaAt" TIMESTAMP(3),
    "anuladaPor" TEXT,

    CONSTRAINT "TiradaPlaca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaquinaCnc_nombre_key" ON "MaquinaCnc"("nombre");

-- CreateIndex
CREATE INDEX "PlacaCnc_maquinaId_puestaAt_idx" ON "PlacaCnc"("maquinaId", "puestaAt");

-- CreateIndex
CREATE INDEX "TiradaPlaca_placaId_idx" ON "TiradaPlaca"("placaId");

-- AddForeignKey
ALTER TABLE "PlacaCnc" ADD CONSTRAINT "PlacaCnc_maquinaId_fkey" FOREIGN KEY ("maquinaId") REFERENCES "MaquinaCnc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TiradaPlaca" ADD CONSTRAINT "TiradaPlaca_placaId_fkey" FOREIGN KEY ("placaId") REFERENCES "PlacaCnc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
