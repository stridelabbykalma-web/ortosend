-- Alta de pacientes iniciada por el profesional con consentimiento documento a
-- documento por WhatsApp (ManyChat). Ver src/lib/alta.ts y docs/ALTA-WHATSAPP.md.

-- CreateEnum
CREATE TYPE "PatientStatus" AS ENUM ('PENDIENTE', 'ACEPTADO', 'CADUCADO', 'RECHAZADO', 'ERROR_ENVIO', 'REVOCADO');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('PRIVACIDAD', 'DATOS_SALUD', 'TRATAMIENTO', 'CONDICIONES', 'MARKETING');

-- CreateEnum
CREATE TYPE "ConsentAction" AS ENUM ('ACEPTADO', 'RECHAZADO', 'REVOCADO');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('PENDIENTE', 'ENVIADO', 'ERROR');


-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "detail" JSONB,
ADD COLUMN     "patientId" TEXT;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "accessSentAt" TIMESTAMP(3),
ADD COLUMN     "clinicId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "professionalId" TEXT,
ADD COLUMN     "status" "PatientStatus" NOT NULL DEFAULT 'ACEPTADO',
ADD COLUMN     "tutorDni" TEXT,
ADD COLUMN     "tutorEmail" TEXT,
ADD COLUMN     "tutorName" TEXT,
ADD COLUMN     "tutorPhone" TEXT,
ALTER COLUMN "ownerId" DROP NOT NULL,
ALTER COLUMN "consents" SET DEFAULT '{}';

-- Los pacientes existentes (Flujo A y cuentas anteriores) quedan ACEPTADO con
-- sus consentimientos en "consents"; los nuevos nacen PENDIENTE.
ALTER TABLE "Patient" ALTER COLUMN "status" SET DEFAULT 'PENDIENTE';

-- CreateTable
CREATE TABLE "consent_invitations" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "refHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "recipient" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "legalTextIds" JSONB NOT NULL,
    "manychatSubscriberId" TEXT,
    "manychatResponse" JSONB,
    "sendStatus" "SendStatus" NOT NULL DEFAULT 'PENDIENTE',
    "sendError" TEXT,
    "sentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "confirmPending" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_texts" (
    "id" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sha256" TEXT NOT NULL DEFAULT '',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_log" (
    "id" TEXT NOT NULL,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "patientId" TEXT NOT NULL,
    "professionalId" TEXT,
    "type" "ConsentType" NOT NULL,
    "action" "ConsentAction" NOT NULL,
    "legalTextId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorUserId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "channel" TEXT NOT NULL,
    "invitationId" TEXT,
    "externalRef" TEXT,
    "timestampUtc" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prevHash" TEXT NOT NULL DEFAULT '',
    "rowHash" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "consent_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_codes" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_manage_tokens" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_manage_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "consent_invitations_refHash_key" ON "consent_invitations"("refHash");

-- CreateIndex
CREATE INDEX "consent_invitations_toPhone_idx" ON "consent_invitations"("toPhone");

-- CreateIndex
CREATE UNIQUE INDEX "legal_texts_type_version_key" ON "legal_texts"("type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "consent_log_seq_key" ON "consent_log"("seq");

-- CreateIndex
CREATE INDEX "consent_log_patientId_type_idx" ON "consent_log"("patientId", "type");

-- CreateIndex
CREATE INDEX "access_codes_phone_createdAt_idx" ON "access_codes"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "consent_manage_tokens_tokenHash_key" ON "consent_manage_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "AuditLog_patientId_idx" ON "AuditLog"("patientId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_invitations" ADD CONSTRAINT "consent_invitations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_log" ADD CONSTRAINT "consent_log_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_log" ADD CONSTRAINT "consent_log_legalTextId_fkey" FOREIGN KEY ("legalTextId") REFERENCES "legal_texts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_log" ADD CONSTRAINT "consent_log_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "consent_invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- Protección a nivel de base de datos
-- ============================================================

-- Tablas de solo inserción: nadie (ni la propia app) puede modificar ni borrar.
CREATE FUNCTION ortosend_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción: % no permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER consent_log_no_update BEFORE UPDATE OR DELETE ON "consent_log"
  FOR EACH ROW EXECUTE FUNCTION ortosend_append_only();
CREATE TRIGGER consent_log_no_truncate BEFORE TRUNCATE ON "consent_log"
  FOR EACH STATEMENT EXECUTE FUNCTION ortosend_append_only();
CREATE TRIGGER legal_texts_no_update BEFORE UPDATE OR DELETE ON "legal_texts"
  FOR EACH ROW EXECUTE FUNCTION ortosend_append_only();
CREATE TRIGGER legal_texts_no_truncate BEFORE TRUNCATE ON "legal_texts"
  FOR EACH STATEMENT EXECUTE FUNCTION ortosend_append_only();
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION ortosend_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION ortosend_append_only();

-- Huella del texto legal: la calcula la BD, no la app.
CREATE FUNCTION legal_texts_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."sha256" := encode(sha256(convert_to(NEW."content", 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;
CREATE TRIGGER legal_texts_set_hash BEFORE INSERT ON "legal_texts"
  FOR EACH ROW EXECUTE FUNCTION legal_texts_hash();

-- consent_log: hora del reloj de la BD, orden total (seq) y cadena de hashes.
-- El candado serializa las inserciones para que la cadena no se bifurque.
CREATE SEQUENCE consent_log_seq;

CREATE FUNCTION consent_log_row_hash(r "consent_log") RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    r."prevHash", r."seq"::text, r."id", r."patientId", coalesce(r."professionalId", ''),
    r."type"::text, r."action"::text, r."legalTextId", r."actor", coalesce(r."actorUserId", ''),
    coalesce(r."ip", ''), coalesce(r."userAgent", ''), r."channel",
    coalesce(r."invitationId", ''), coalesce(r."externalRef", ''),
    to_char(r."timestampUtc" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ), 'UTF8')), 'hex');
$$;

CREATE FUNCTION consent_log_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('consent_log_chain'));
  NEW."seq" := nextval('consent_log_seq');
  NEW."timestampUtc" := clock_timestamp();
  SELECT "rowHash" INTO prev FROM "consent_log" ORDER BY "seq" DESC LIMIT 1;
  NEW."prevHash" := coalesce(prev, 'GENESIS');
  NEW."rowHash" := consent_log_row_hash(NEW);
  RETURN NEW;
END;
$$;
CREATE TRIGGER consent_log_set_chain BEFORE INSERT ON "consent_log"
  FOR EACH ROW EXECUTE FUNCTION consent_log_chain();

-- Comprobación de integridad: devuelve la primera fila alterada o fuera de cadena
-- (vacío si todo cuadra). SELECT * FROM consent_log_verify();
CREATE FUNCTION consent_log_verify() RETURNS TABLE(seq bigint, motivo text) LANGUAGE plpgsql AS $$
DECLARE r "consent_log"; prev text := 'GENESIS';
BEGIN
  FOR r IN SELECT * FROM "consent_log" ORDER BY "seq" LOOP
    IF r."prevHash" <> prev THEN
      seq := r."seq"; motivo := 'cadena rota (falta o se reordenó una fila anterior)'; RETURN NEXT; RETURN;
    END IF;
    IF r."rowHash" <> consent_log_row_hash(r) THEN
      seq := r."seq"; motivo := 'contenido alterado'; RETURN NEXT; RETURN;
    END IF;
    prev := r."rowHash";
  END LOOP;
END;
$$;

-- ============================================================
-- Textos legales v1: PLACEHOLDERS para rellenar por Ortosend.
-- Para cambiarlos NO se editan: se inserta la versión 2 (ver docs/ALTA-WHATSAPP.md).
-- ============================================================
INSERT INTO "legal_texts" ("id", "type", "version", "title", "content") VALUES
  ('legal_privacidad_v1', 'PRIVACIDAD', 1, 'Política de privacidad',
   E'[PENDIENTE] Política de privacidad completa.\n\nResponsable: [razón social, CIF, domicilio, contacto del DPD].\nFinalidad: [gestión del alta, diseño y fabricación de plantillas a medida, facturación].\nBase legal: [consentimiento expreso (art. 9.2.a RGPD) y ejecución del contrato].\nDestinatarios: [clínica/profesional, taller, proveedores encargados (alojamiento, ManyChat/WhatsApp)].\nConservación: [plazo; historia clínica mínimo 5 años].\nDerechos: [acceso, rectificación, supresión, oposición, limitación, portabilidad; reclamación ante la AEPD].'),
  ('legal_datos_salud_v1', 'DATOS_SALUD', 1, 'Consentimiento para el tratamiento de datos de salud',
   E'[PENDIENTE] Texto del consentimiento expreso para tratar datos de salud (exploración, escaneos, vídeos de marcha) con la finalidad de diseñar y fabricar las plantillas.'),
  ('legal_tratamiento_v1', 'TRATAMIENTO', 1, 'Información sobre el tratamiento con plantillas',
   E'[PENDIENTE] Información clínica del tratamiento con plantillas a medida: en qué consiste, beneficios, riesgos y alternativas.'),
  ('legal_condiciones_v1', 'CONDICIONES', 1, 'Condiciones del servicio',
   E'[PENDIENTE] Condiciones del servicio: precio, plazos, pago, envío, garantía y desistimiento.'),
  ('legal_marketing_v1', 'MARKETING', 1, 'Comunicaciones comerciales',
   E'[PENDIENTE] Consentimiento opcional para recibir comunicaciones comerciales de Ortosend por WhatsApp y email. Puedes retirarlo en cualquier momento.');
