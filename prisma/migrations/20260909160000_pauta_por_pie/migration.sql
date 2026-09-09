-- Pauta de fabricación por pie: lo que va en cada etiqueta de molde (I / D).
ALTER TABLE "Prescription" ADD COLUMN "orderLeft" TEXT;
ALTER TABLE "Prescription" ADD COLUMN "orderRight" TEXT;
