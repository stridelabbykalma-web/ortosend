# Alta de cliente — Flujo A (reserva online)

Cómo entra un cliente en Ortosend desde la web, qué se guarda y qué pasa con los menores.
Código: `src/app/reserva/[clinicId]/page.tsx`, `src/components/reserva-form.tsx`,
`src/app/publico-actions.ts`, `src/lib/mayoria.ts`, `src/app/mayoria/page.tsx` y el
mantenimiento diario en `src/app/panel/admin-actions.ts` (`runJobs`).

## 1. Recorrido

1. **Buscar clínica** (`/buscar` o portada): solo clínicas ACTIVAS. «Reservar cita gratis» lleva
   a `/reserva/[clinicId]`.
2. **Elegir hora.** Se listan los huecos publicados por la clínica (máx. 5) que no tienen caso ni
   están bloqueados por otro navegador. Al marcar una hora se **bloquea 15 minutos** para ese
   navegador (`holdSlotAction`, cookie `ortosend_hold`, campos `Slot.holdUntil/holdKey`); los
   demás dejan de verla. Si otro la ha cogido antes, se avisa al momento.
3. **Datos.** Dos situaciones:
   - **Visitante**: nombre, móvil, email, fecha de nacimiento, motivo, contraseña y
     consentimientos. Si ya existe una cuenta con ese email o móvil se le remite a
     `/login?next=/reserva/…`.
   - **Cliente con sesión**: no vuelve a registrarse. Elige para quién es la cita (él/ella, un
     menor ya registrado u «otra persona menor a mi cargo»).
   - En ambos casos puede marcar **«Reservo para un menor de 16 años»** y rellenar nombre, fecha
     de nacimiento, email y móvil del menor.
4. **Validación en servidor** (`reservaAction`): zod + reglas propias. Móvil y email se
   normalizan (`src/lib/contacto.ts`: los españoles quedan en 9 dígitos, el email en minúsculas).
   Un titular menor de 16 no puede reservar por sí mismo; un «menor» de 16 o más debe reservar
   con su propia cuenta; el email del menor debe ser distinto del de su tutor.
5. **Transacción atómica**: `User` CLIENTE (solo si es visitante), `Patient` (con
   `isMinor`, `email`/`phone` propios y consentimientos con `CONSENT_VERSION`), `Case`
   CITA_RESERVADA flujo A con `reason` (motivo) y `appointmentAt`, y reclamo del slot condicionado
   a que siga libre o bloqueado por este navegador. Si falla el reclamo se deshace todo.
6. **Avisos**: evento en el historial del caso; confirmación por **email** siempre y por
   **WhatsApp** solo si el titular aceptó ese canal (`notifyOwner`).
7. **Sesión y panel**: el visitante queda logueado (cookie 30 días) y ve la cita en `/panel`.
   Desde el panel puede reservar otra cita, editar sus datos de acceso y gestionar las personas a
   su cargo.
8. **Recordatorio la víspera**: el cron diario (`/api/cron`, 06:00 UTC) avisa de las citas de las
   próximas 36 h y marca `Case.reminderSentAt` para no repetir.
9. **En clínica**: la agenda muestra el motivo y, si es menor, quién es su tutor. Al abrir el
   estudio el caso pasa a ESTUDIO_EN_CURSO y sigue el ciclo común.

## 2. Menores y mayoría de edad (16 años)

Base: a partir de los 16 el paciente decide sobre su salud (Ley 41/2002). Constantes en
`src/lib/edad.ts` (`EDAD_MAYORIA_SALUD`, `HANDOVER_TOKEN_DAYS`).

- Hasta los 16, el menor es un `Patient` con `isMinor = true` cuyo `ownerId` es la cuenta del
  tutor. El tutor ve sus casos, recibe los avisos y puede editar el email y el móvil del menor en
  «Personas a tu cargo».
- **El día que cumple 16**, el cron encuentra a los pacientes con `isMinor` y fecha de
  nacimiento ≤ hoy − 16 años sin aviso enviado (`enviarAvisoMayoria`):
  - Envía al **email del menor** la plantilla `mayoria_edad` con un enlace `/mayoria?token=…`
    (token JWT tipo `handover`, 30 días).
  - Envía al **tutor** `mayoria_edad_titular` (email y WhatsApp si lo aceptó) explicando que
    dejará de tener acceso cuando el menor active su cuenta.
  - Marca `Patient.handoverNoticeAt` y anota el evento en cada caso.
  - Si el menor **no tiene email**, avisa al tutor (`mayoria_edad_sin_email`, como mucho una vez
    por semana) para que lo añada en su panel; al guardarlo se envía el enlace en el acto.
- **El menor activa su cuenta** en `/mayoria` (`handoverAction`): confirma o cambia email y
  móvil (deben ser distintos de los del tutor y no estar en otra cuenta) y crea su contraseña. En
  una transacción se crea su `User` CLIENTE, el `Patient` pasa a `ownerId` = nuevo usuario,
  `isMinor = false`, `handoverAt = ahora` y se registra el traspaso en `consents`. Como el acceso
  al caso se decide por `patient.ownerId`, el tutor deja de ver el expediente automáticamente. Se
  avisa al tutor (`cuenta_traspasada`) y el menor entra en su panel ya logueado.
- Si el enlace caduca, el tutor puede **reenviar el aviso** desde su panel.
- Flujo B: la clínica puede marcar «El paciente es menor de 16» e indicar al tutor; la cuenta e
  invitación son del tutor y el contacto del menor queda en su ficha para el mismo traspaso.

## 3. Canales de aviso

`Notification` tiene `channel` (`whatsapp` | `email`), `toPhone` y `toEmail`. WhatsApp sigue
simulado. El email (`src/lib/email.ts`) se encola siempre y sale por la API de Resend si están
configurados `RESEND_API_KEY` y `EMAIL_FROM` (`sentAt` marca los enviados). Los textos de cada
plantilla están en `renderEmail`; nunca llevan contenido clínico, solo avisos y enlaces.
