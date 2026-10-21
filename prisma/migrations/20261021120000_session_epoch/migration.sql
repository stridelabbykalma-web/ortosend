-- Cerrar sesion invalida los tokens de todos los dispositivos.
ALTER TABLE "User" ADD COLUMN "sessionEpoch" INTEGER NOT NULL DEFAULT 0;
