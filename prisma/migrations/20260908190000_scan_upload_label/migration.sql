-- Nombre del proyecto en Revo Scan: lo teclea el profesional al crear el
-- proyecto y sirve para asociar el escaneo al paciente sin tener el caso abierto.
ALTER TABLE "ScanUpload" ADD COLUMN IF NOT EXISTS "label" TEXT;
