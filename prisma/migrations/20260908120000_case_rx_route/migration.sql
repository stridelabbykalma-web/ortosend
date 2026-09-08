-- Quién receta el caso, elegido por la clínica al enviar el estudio
-- (CLINICA | ORTOSEND | REVISION), y quién lo envió.
ALTER TABLE "Case" ADD COLUMN "rxRoute" TEXT;
ALTER TABLE "Case" ADD COLUMN "rxRequestedBy" TEXT;
