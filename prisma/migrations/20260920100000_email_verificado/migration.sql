-- Flujo A: confirmación del email del cliente (enlace enviado al crear la cuenta).
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
