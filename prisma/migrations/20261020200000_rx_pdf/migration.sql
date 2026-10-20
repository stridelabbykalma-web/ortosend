-- PDF de la prescripción generado al firmar, con su huella SHA-256.
ALTER TABLE "Prescription"
  ADD COLUMN "pdfBytes" BYTEA,
  ADD COLUMN "pdfSha256" TEXT;
