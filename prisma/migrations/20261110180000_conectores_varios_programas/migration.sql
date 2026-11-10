-- Varios programas de agenda por clínica (Docfav por API, calendarios iCal…):
-- la clave del conector pasa a ser opcional, cada enlace puede llevar su propio
-- enlace iCal cifrado y cada cita guarda en qué conector está su copia.
ALTER TABLE "CalendarConnector" ALTER COLUMN "apiKeyEnc" DROP NOT NULL;
ALTER TABLE "CalendarConnector" ALTER COLUMN "apiKeyHint" DROP NOT NULL;
ALTER TABLE "ConnectorLink" ADD COLUMN "secretEnc" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "externalConnectorId" TEXT;
-- Las copias existentes son todas de Docfav (único programa hasta ahora).
UPDATE "Appointment" a SET "externalConnectorId" = c."id"
FROM "CalendarConnector" c
WHERE a."externalId" IS NOT NULL AND a."externalConnectorId" IS NULL AND c."clinicId" = a."clinicId" AND c."kind" = 'DOCFAV';
