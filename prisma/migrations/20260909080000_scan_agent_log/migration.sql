-- Actividad reciente del puente, para verla en el panel sin ir al PC del escáner.
ALTER TABLE "ScanAgent" ADD COLUMN IF NOT EXISTS "lastLog" TEXT;
