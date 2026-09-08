-- La migración de reparación recreó ScanUpload sin las dos columnas del mesh
-- comprimido (gzip). Idempotente.
ALTER TABLE "ScanUpload" ADD COLUMN IF NOT EXISTS "encoding" TEXT;
ALTER TABLE "ScanUpload" ADD COLUMN IF NOT EXISTS "storedBytes" INTEGER;
