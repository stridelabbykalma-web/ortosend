-- El escaneo va por la carpeta compartida de la clínica (nombre del proyecto
-- en Revo Scan); se retira el puente de escaneo y su bandeja.
DROP TABLE IF EXISTS "ScanUpload";
DROP TABLE IF EXISTS "ScanAgent";
ALTER TABLE "Case" DROP COLUMN IF EXISTS "scanWaitingAt";
