-- Trazabilidad de materiales: lotes (código de barras de cada plancha) y material usado en cada plantilla
-- (con la foto de la etiqueta, quién y cuándo). Los consumos no se borran: se anulan.

-- CreateTable
CREATE TABLE "LoteMaterial" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "gtin" TEXT,
    "lote" TEXT NOT NULL,
    "caducidad" TIMESTAMP(3),
    "materialId" TEXT,
    "creadoPor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoteMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumoMaterial" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "materialId" TEXT,
    "pies" TEXT NOT NULL DEFAULT 'par',
    "fotoId" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladoAt" TIMESTAMP(3),
    "anuladoPor" TEXT,
    "motivoAnulacion" TEXT,

    CONSTRAINT "ConsumoMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoteMaterial_codigo_key" ON "LoteMaterial"("codigo");

-- CreateIndex
CREATE INDEX "ConsumoMaterial_caseId_idx" ON "ConsumoMaterial"("caseId");

-- AddForeignKey
ALTER TABLE "LoteMaterial" ADD CONSTRAINT "LoteMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoMaterial" ADD CONSTRAINT "ConsumoMaterial_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoMaterial" ADD CONSTRAINT "ConsumoMaterial_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoMaterial" ADD CONSTRAINT "ConsumoMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================
-- Protección a nivel de base de datos (trazabilidad)
-- ============================================================
-- Ni lotes ni consumos se pueden borrar. Un consumo solo admite un cambio: anularlo (una vez, con
-- quién y por qué); el resto de sus datos no se puede modificar.
CREATE TRIGGER lote_material_no_delete BEFORE DELETE ON "LoteMaterial"
  FOR EACH ROW EXECUTE FUNCTION ortosend_append_only();
CREATE TRIGGER lote_material_no_truncate BEFORE TRUNCATE ON "LoteMaterial"
  FOR EACH STATEMENT EXECUTE FUNCTION ortosend_append_only();
CREATE TRIGGER consumo_material_no_delete BEFORE DELETE ON "ConsumoMaterial"
  FOR EACH ROW EXECUTE FUNCTION ortosend_append_only();
CREATE TRIGGER consumo_material_no_truncate BEFORE TRUNCATE ON "ConsumoMaterial"
  FOR EACH STATEMENT EXECUTE FUNCTION ortosend_append_only();

CREATE FUNCTION ortosend_consumo_solo_anular() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."anuladoAt" IS NOT NULL
     OR NEW."anuladoAt" IS NULL
     OR NEW."caseId" IS DISTINCT FROM OLD."caseId"
     OR NEW."loteId" IS DISTINCT FROM OLD."loteId"
     OR NEW."materialId" IS DISTINCT FROM OLD."materialId"
     OR NEW."pies" IS DISTINCT FROM OLD."pies"
     OR NEW."fotoId" IS DISTINCT FROM OLD."fotoId"
     OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."userName" IS DISTINCT FROM OLD."userName"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Un material registrado no se modifica: solo se puede anular una vez'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER consumo_material_solo_anular BEFORE UPDATE ON "ConsumoMaterial"
  FOR EACH ROW EXECUTE FUNCTION ortosend_consumo_solo_anular();
