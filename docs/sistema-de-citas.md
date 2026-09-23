# Sistema de citas: agenda por centro y por profesional

Sustituye a los «huecos sueltos» (`Slot`, máximo 5 por clínica) por una agenda real:
horario semanal por clínica y por profesional, cierres y aperturas por fechas, citas con
estado, reserva online con calendario, reprogramación y anulación desde el panel del
cliente, agenda semanal en el panel de clínica, recordatorio 24 h y suscripción iCal.

## Por qué desarrollo propio y no un producto externo

Se valoraron Cal.com, Microsoft Bookings, Calendly, SimplyBook.me/Timify y Doctoralia.
Ninguno encaja bien porque:

- La reserva crea en una sola transacción usuario, paciente con consentimiento RGPD de
  datos de salud versionado y caso en `CITA_RESERVADA`. Con un SaaS eso pasa a ser un
  webhook posterior y dos formularios.
- Es multicentro con personal externo (cada clínica es otra empresa). Los SaaS cobran por
  asiento y obligan a meter a esos profesionales en la organización de Ortosend.
- El canal es WhatsApp con avisos propios; el recordatorio 24 h ya estaba previsto en el cron.
- El proveedor sería encargado de tratamiento de datos de salud y varios alojan fuera de la UE.

La lógica de disponibilidad son ~300 líneas sin dependencias (`src/lib/agenda.ts`). Lo que
sí se ofrece hacia fuera es un **feed iCal** por profesional y por clínica, para que cada
centro vea sus citas de Ortosend en su Outlook, Google Calendar o Apple Calendar sin pagar
asientos.

## Conceptos

**Agenda (recurso).** Cada clínica tiene la *agenda de la clínica* (la sala o el equipo,
con capacidad: cuántas citas a la vez) y una *agenda por profesional*. Una cita pertenece a
una sola agenda (`Appointment.professionalId`, `null` = agenda de la clínica).

**Horario semanal (`AvailabilityRule`).** Franjas recurrentes por día de la semana
(ISO 1 lunes … 7 domingo), en minutos de reloj local (`540` = 09:00): agenda, `startMin`,
`endMin`, `capacity` (solo tiene sentido en la agenda de la clínica) y `online` (si es
`false`, la franja existe pero no se publica en la web: solo la clínica da esas citas).

**Excepciones (`AvailabilityException`).** Por rango de fechas inclusivo:

- `CIERRE`: festivo, vacaciones, baja. Sin horas = todo el día; con horas, se recorta esa
  franja. Con `professionalId = null` tapa **todas** las agendas de la clínica; con un
  profesional, solo la suya.
- `APERTURA`: franja extra fuera del horario semanal (siempre con horas). Solo se añade a la
  agenda a la que pertenece.

**Ajustes de la clínica (`Clinic`).** `timezone` (Europe/Madrid), `slotMinutes` (duración de
la cita, 45 por defecto), `minNoticeHours` (antelación mínima online, 24), `bookingHorizonDays`
(hasta cuántos días vista se reserva, 45), `onlineBooking` (publicar o no la agenda) y
`patientPicksPro` (si el paciente elige profesional o se le asigna el primero libre).

**Cita (`Appointment`).** `kind` (ESTUDIO, REPETICION, REVISION, AJUSTE), `status`
(RESERVADA, CONFIRMADA, COMPLETADA, CANCELADA, NO_PRESENTADO), `startsAt`/`endsAt` en UTC,
`source` (web, clinica, cliente), quién la dio, notas internas, datos de anulación y
`reminderSentAt`. Un caso puede tener varias citas a lo largo de su vida; la vigente se
refleja en `Case.appointmentAt` (desnormalizado, lo mantiene `syncCaseAppointment`).

## Cómo se calcula la disponibilidad

`computeAvailability()` en `src/lib/agenda.ts` (puro, sin base de datos), por cada día del
rango y por cada agenda:

1. Ventanas del horario semanal de ese día de la semana.
2. Menos los cierres que cubren la fecha (los de toda la clínica y los de esa agenda).
3. Más las aperturas de esa agenda en esa fecha.
4. En modo `online` solo cuentan las ventanas `online`; en modo `staff` (panel de clínica)
   todas.
5. Cada ventana se trocea en citas de `slotMinutes` desde su inicio.
6. Se descartan los huecos anteriores a `ahora + minNoticeHours` (online) y los días más allá
   del horizonte (online).
7. Se descartan los huecos donde el número de citas activas (RESERVADA o CONFIRMADA) de esa
   agenda que se solapan ya alcanza la capacidad de la ventana.

El resultado va por día (`YYYY-MM-DD` en hora local) con la hora UTC y la agenda que ofrece
cada hueco. Una misma hora puede salir por varias agendas; la web las agrupa y, si el
paciente no elige profesional, `findSlot()` prefiere una agenda personal antes que la de la
clínica.

La zona horaria se resuelve con `Intl` (sin librerías): `zonedToUtc()` convierte «este día
local a estos minutos» a UTC de forma correcta también en los cambios de hora.

## Reserva sin dobles reservas

`bookAppointment()` en `src/lib/agenda-db.ts` se ejecuta dentro de una transacción y hace:

1. `pg_advisory_xact_lock(hashtext('agenda:<clinicId>'))`: serializa las reservas de la misma
   clínica. Dos reservas simultáneas del mismo hueco entran una detrás de otra.
2. Si es una reprogramación, cancela la cita anterior (`replaceAppointmentId`).
3. Recarga horario, excepciones y citas del día y recalcula con `findSlot()`. Si el hueco ya
   no está, lanza `NO_DISPONIBLE` y el usuario ve «Esa hora acaba de ser reservada por otra
   persona».
4. Personal de clínica con «fuera de horario» (`force`): se salta el horario, pero exige que la
   agenda elegida no tenga otra cita solapada.
5. Crea la cita y sincroniza `Case.appointmentAt`.

## Flujos

**Web pública (`/reserva/[clinicId]`).**

- Visitante: calendario (mes con días en verde, horas del día, selector de profesional si la
  clínica lo permite) + datos + contraseña + consentimientos. En una transacción se crean
  `User`, `Patient`, `Case` (CITA_RESERVADA, flujo A) y la cita. Aviso `cita_confirmada`.
- Cliente con sesión: reserva para sí mismo o para otra persona a su cargo (crea el `Patient`)
  sin volver a registrarse. Un paciente no puede tener dos estudios abiertos.
- Cliente con sesión y `?caso=`: cambia la cita de un caso suyo en `CITA_RESERVADA` (estudio) o
  `DEVUELTO_CLINICA` (repetir prueba). La anterior se cancela en la misma transacción.
- Personal de clínica: se le remite a la agenda del panel.
- El login acepta `?next=/reserva/…` para volver a la reserva tras identificarse.

**Panel del cliente.** En «Cita reservada» aparecen *Cambiar la hora* y *Anular la cita*. Si
anula, el caso sigue en `CITA_RESERVADA` sin hora y el panel muestra *Reservar hora*. En
«Devuelto a clínica» puede reservar él mismo la visita para repetir la prueba (tipo REPETICION).

**Panel de clínica → Agenda.** Semana (lunes a domingo, navegable) con las citas de todas las
agendas o filtradas por una; cada cita despliega caso, notas, *Abrir caso*, *Cambiar hora*,
*Anular* (con motivo) y *No vino* (solo si ya pasó). Debajo: casos *pendientes de cita*
(anuladas o devueltos sin hora), formulario *Dar cita* (caso, tipo, nota, hora del calendario en
modo staff o fecha y hora a mano con «fuera de horario»), el alta de Flujo B de siempre y los
enlaces iCal. Al empezar el estudio de un caso con cita ese día, la cita pasa a COMPLETADA.

**Panel de clínica → Disponibilidad.** Ajustes de la reserva (solo administrador de la
clínica), horario semanal por agenda con alta y baja de franjas (el profesional solo toca la
suya), cierres y aperturas por fechas, y vista previa de los huecos publicados en los próximos
14 días. Cualquier cambio se refleja al instante en la web.

**Automatizaciones (`runJobs`, `/api/cron`).** Además de la caducidad y los recordatorios de
pago, encola `recordatorio_24h` para las citas activas que empiezan en las próximas 25 h y
marca `reminderSentAt` para no repetirlo.

**iCal (`/api/ical/[token]`).** Token privado por usuario (`User.calendarToken`) o por clínica
(`Clinic.calendarToken`), generado o renovado desde la pestaña Agenda. Devuelve un `VCALENDAR`
con las citas desde hace 30 días (canceladas como `STATUS:CANCELLED`) con fecha, hora, tipo,
nombre del paciente y número de caso. Nunca contenido clínico. Renovar el enlace invalida el
anterior.

## Notificaciones nuevas (cola WhatsApp)

`cita_confirmada` (con `direccion` y `fecha`), `cita_cambiada`, `cita_cancelada`,
`recordatorio_24h`. Solo avisos y enlaces, nunca contenido clínico.

## Migración

`prisma/migrations/20260920100000_sistema_de_citas`: crea enums y tablas, añade los ajustes a
`Clinic` y los tokens iCal, migra los datos y borra `Slot`:

- `Slot` con `caseId` → `Appointment` (RESERVADA si el caso sigue en CITA_RESERVADA, si no
  COMPLETADA), duración 45 min.
- `Slot` libre y futuro → `AvailabilityException` de tipo APERTURA en la agenda de la clínica,
  en hora local de Madrid, para que la clínica no pierda lo que tenía publicado hasta que
  configure su horario semanal.

Probado en local sobre una base con `Slot` reales antes de aplicar la migración.

## Ficheros

| Fichero | Qué hace |
|---|---|
| `prisma/schema.prisma` | Modelos `AvailabilityRule`, `AvailabilityException`, `Appointment`; ajustes en `Clinic`; tokens iCal |
| `src/lib/agenda.ts` | Motor puro: zona horaria, ventanas, cálculo de huecos, `findSlot` |
| `src/lib/agenda-db.ts` | Carga de la agenda, reserva atómica, cancelación, sincronización del caso |
| `src/lib/reserva-form.ts` | Lectura del hueco elegido en los formularios |
| `src/app/api/disponibilidad/route.ts` | Huecos por días para el calendario (online y staff) |
| `src/app/api/ical/[token]/route.ts` | Feed iCal privado |
| `src/components/reserva/calendario.tsx` | Calendario (cliente) reutilizado en web y panel |
| `src/app/reserva/[clinicId]/page.tsx` | Reserva web: visitante, cliente y reprogramación |
| `src/app/publico-actions.ts` | `reservaAction`, `reservaClienteAction` |
| `src/app/panel/cliente-actions.ts` | `reprogramarCitaAction`, `cancelarCitaAction` |
| `src/app/panel/agenda-actions.ts` | Citas, horario, excepciones, ajustes e iCal del panel de clínica |
| `src/components/panels/clinica-agenda.tsx` | Pestaña Agenda |
| `src/components/panels/clinica-disponibilidad.tsx` | Pestaña Disponibilidad |
| `src/app/panel/admin-actions.ts` | Recordatorio 24 h en `runJobs` |

## Pendiente / ideas

- Confirmación de asistencia desde el recordatorio (estado `CONFIRMADA` ya existe).
- Lista de espera por hueco: avisar cuando se libere una hora.
- Que las citas de las agendas personales consuman también la capacidad de la sala/equipo
  cuando la clínica tenga menos escáneres que profesionales.
- Adjuntar `.ics` en el aviso de confirmación cuando exista el canal de email.
