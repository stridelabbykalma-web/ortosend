-- El móvil sirve para avisos y puede compartirse entre cuentas (pareja, familia).
-- La identidad de la cuenta es el email.
DROP INDEX "User_phone_key";
CREATE INDEX "User_phone_idx" ON "User"("phone");
