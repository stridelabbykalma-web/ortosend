# Alta de cliente — Flujo B (lo inicia la clínica)

La clínica no crea la cuenta del paciente: solo emite una **invitación con los datos
esenciales**. El paciente (o su tutor, si es menor de 16) la recibe al momento, crea su cuenta,
revisa sus datos y acepta los consentimientos, y en ese instante nacen su ficha y el caso.
Así todo queda registrado por el propio paciente. Código: `invitePatientAction`,
`resendInvitationAction` y `cancelInvitationAction` en `src/app/panel/clinica-actions.ts`,
`src/lib/invitacion.ts`, `src/app/invitacion/page.tsx`, `acceptInvitationAction` en
`src/app/(auth)/actions.ts`, y el mantenimiento diario en `src/app/panel/admin-actions.ts`.
El Flujo A está en `alta-cliente-flujo-a.md`.

## 1. Recorrido

1. **La clínica invita** desde la agenda («Invitar a un paciente»): nombre, móvil, email y
   fecha de nacimiento. Si es **menor de 16**, despliega «El paciente es menor» e indica nombre,
   móvil y email del tutor: la invitación va al tutor y el contacto del menor queda guardado
   para el aviso a los 16. Móvil y email se normalizan. Se guarda una fila `Invitation`
   (`pendiente`, token secreto, caducidad 72 h, quién la emitió) y **no se crea nada más**:
   ni usuario, ni paciente, ni caso.
2. **Envío inmediato** por WhatsApp y email con el enlace `/invitacion?token=…`. El texto
   nombra a la clínica y explica que en el enlace creará su cuenta y aceptará los
   consentimientos.
3. **En la agenda de la clínica** aparece «Invitaciones pendientes de aceptar» con cada una:
   a quién se envió, cuántas veces, hasta cuándo vale, y los botones **Abrir aquí** (para que
   el paciente acepte en la tablet de la clínica si no tiene el móvil a mano), **Copiar**
   enlace, **Reenviar** (token y caducidad nuevos) y **Cancelar**. Un enlace reenviado deja sin
   efecto el anterior.
4. **El paciente acepta** en `/invitacion`: ve quién le invita y los datos registrados
   (paciente, fecha de nacimiento, tutor si lo hay), **revisa o corrige email y móvil**, crea
   su contraseña y acepta los consentimientos: el de salud es obligatorio (con declaración de
   tutor si es un menor) y el de WhatsApp opcional. Todo se guarda con `via: invitacion` y la
   versión vigente. En una sola transacción se crean el `User` CLIENTE (activado), el
   `Patient` (menor con su contacto propio si procede) y el `Case` en ESTUDIO_EN_CURSO flujo B
   con su `Capture`; la invitación pasa a `aceptada` enlazada al caso. Queda evento en el caso,
   auditoría, y recibe el email de bienvenida con el enlace para confirmar el email.
   - **Si ya tiene cuenta** (por el Flujo A o por otra invitación), inicia sesión desde el
     enlace y acepta con ella: no se pide contraseña y el caso cuelga de su ficha (o de un
     menor nuevo a su cargo).
   - **Desde la tablet de la clínica** (sesión profesional): se crea la cuenta pero no se abre
     la sesión del paciente; la clínica conserva la suya y ve el estudio en la agenda.
   - Una invitación no se puede aceptar dos veces (reclamo atómico).
5. **La clínica ve el estudio en la agenda** en cuanto se acepta, con «Menor · tutor: …» si
   procede, y abre el asistente de captura. A partir de ahí el ciclo es el común.
6. **Si no acepta**: el enlace caduca a las 72 h. El cron diario reenvía las caducadas como
   máximo **3 veces** (`MAX_AUTO_RESENDS`); después solo la clínica puede reenviar a mano o
   cancelar. Sin aceptación no hay caso, así que no queda nada a medias en el sistema.

## 2. Diferencias con el Flujo A

- En A el cliente elige hora y crea la cuenta antes de la visita; en B la clínica invita
  durante la visita y el paciente crea la cuenta al aceptar.
- En A el caso nace en CITA_RESERVADA; en B nace en ESTUDIO_EN_CURSO al aceptar.
- En ambos el consentimiento lo da el propio paciente online, con la misma versión de textos,
  y la cuenta nace ya activada; después comparten recuperación de contraseña, confirmación
  del email, datos de acceso, menores y traspaso a los 16.

## 3. Profesionales

Las cuentas de profesionales las crea Ortosend al aprobar una solicitud y se activan en
`/activar` (enlace de 72 h): confirman email y móvil y crean la contraseña.

## 4. Pendiente

- Verificación del móvil por SMS o WhatsApp (exige el canal real).
- Código QR del enlace en la agenda para escanear con el móvil del paciente (hoy: «Abrir
  aquí» y «Copiar»).
