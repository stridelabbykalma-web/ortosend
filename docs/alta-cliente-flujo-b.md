# Alta de cliente — Flujo B (lo inicia la clínica)

Cómo entra un paciente cuando el estudio empieza en la clínica, cómo activa su cuenta y qué
pasa si no lo hace. Código: `newCaseBAction` y `resendInviteAction` en
`src/app/panel/clinica-actions.ts`, `src/lib/invitacion.ts`, `src/app/activar/page.tsx`,
`activateAction` en `src/app/(auth)/actions.ts`, y el mantenimiento diario en
`src/app/panel/admin-actions.ts` (`runJobs`). El Flujo A está en `alta-cliente-flujo-a.md`.

## 1. Recorrido

1. **La clínica crea el caso** desde la agenda: nombre, móvil, email y fecha de nacimiento del
   paciente. Si es **menor de 16**, despliega «El paciente es menor» e indica nombre, móvil y
   email del tutor: la cuenta es del tutor y el contacto del menor queda en su ficha (mismo
   traspaso a los 16 que en el Flujo A). Móvil y email se normalizan y se comprueba que no
   exista ya otra cuenta.
2. **Se crea la cuenta sin contraseña** (`User` CLIENTE con `invitedAt`, `inviteCount = 1`),
   el `Patient` con los consentimientos recogidos en clínica (versión `CONSENT_VERSION`,
   `via: clinica`) y el `Case` en ESTUDIO_EN_CURSO con flujo B. La clínica pasa directamente
   al asistente de captura.
3. **Invitación** (`enviarInvitacion`): WhatsApp y email con un enlace `/activar?token=…`
   válido **72 h**. El texto nombra a la clínica y explica que en el enlace confirmará sus
   datos y creará su contraseña.
4. **Estado visible en la clínica**: en la agenda, en «Mis casos» y en el expediente aparece
   «Cuenta sin activar · enlace hasta …» o «invitación caducada», con el botón **Reenviar
   invitación** (`resendInviteAction`, queda en el historial del caso). Administración ve el
   mismo estado y el número de envíos.
5. **Activación** (`/activar`): el paciente o el tutor ve su nombre (y a quién gestiona si es
   un menor), **confirma o corrige email y móvil**, crea la contraseña y **ratifica online los
   consentimientos**: el de salud es obligatorio (confirma el firmado en clínica) y el de
   WhatsApp es opcional, y sustituyen a los recogidos en papel con `via: activacion`. Se
   comprueba que el email y el móvil no estén en otra cuenta. Queda `activatedAt`, un evento
   en cada caso, auditoría, y recibe el email de bienvenida con los datos de acceso y el
   enlace para confirmar el email (igual que en el Flujo A). Un enlace de invitación de una
   cuenta ya activada no vuelve a activarla.
6. **Si nunca activa**:
   - El cron diario reenvía las invitaciones **caducadas** de cuentas con algún caso vivo,
     como máximo **3 reenvíos automáticos** (`MAX_AUTO_RESENDS`); después solo la clínica
     puede reenviar a mano.
   - Al **firmar la prescripción**, si la cuenta sigue sin activar, el aviso de «prescripción
     lista, pago pendiente» va dentro de una invitación nueva (sin cuenta no puede pagar), y
     queda anotado en el caso. Los recordatorios de pago (días 3/7/15) hacen lo mismo.
   - El caso no se bloquea: el estudio, la prescripción y el pago siguen su curso; lo que se
     garantiza es que el paciente siempre tiene un enlace vigente para entrar a pagar.
7. **Recuperación de contraseña**: solo para cuentas activadas. `/recuperar` explica que una
   cuenta creada por la clínica se activa desde la invitación.

## 2. Profesionales

La misma página `/activar` sirve para las cuentas de profesionales que Ortosend crea al
aprobar una solicitud: confirman email y móvil y crean la contraseña, sin el bloque de
consentimientos (solo se pide a clientes).

## 3. Pendiente

- Verificación del móvil por SMS o WhatsApp (exige el canal real).
- Que el aviso de invitación caducada llegue también a la clínica (hoy se ve en la agenda).
