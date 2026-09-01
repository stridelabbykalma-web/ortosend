# Ortosend — Aplicación web

Plataforma de plantillas ortopédicas a medida (199,99 € precio único) con red de clínicas
asociadas. Stack: **Next.js (App Router, server actions) + PostgreSQL (Prisma)**.

## Estado actual — qué está implementado y verificado

**Web pública**
- Home con propuesta de valor y buscador de clínicas por población/CP (`/buscar`).
- «Cómo funciona», «Para clínicas» (solicitud de alta) y lista de espera de zonas sin cobertura.
- **Flujo A**: reserva online con huecos reales (reclamo atómico del slot, sin dobles reservas),
  alta de cuenta del cliente con consentimientos RGPD versionados.
- Textos legales provisionales (privacidad y términos).

**Autenticación y roles**
- Sesión con cookie firmada (jose) + bcrypt. 6 roles: ADMIN, ADMIN_CLINICA, PROFESIONAL,
  RECETADOR, TALLER, CLIENTE.
- **Flujo B**: la clínica crea el caso y el paciente recibe invitación (enlace de activación 72 h,
  `/activar`).
- Capa sensible: ver el documento clínico exige **re-confirmar la contraseña** (token de lectura
  de 10 min) y queda registrado en `AuditLog` (RGPD).

**Panel clínica**
- Agenda (citas Flujo A + casos Flujo B), disponibilidad (máx. 5 huecos), profesionales y
  formación 5/5, liquidaciones (placeholder).
- **Asistente de captura** de 6 pasos con guardado continuo: cuestionario clínico completo
  (motivo/dolor, actividad y datos físicos, calzado, antecedentes y tratamientos previos —
  visible entero en el expediente que llega al prescriptor), exploración biomecánica con tests
  podológicos (Silfverskiöld, lunge, FPI-6, Jack, navicular drop, heel rise), dismetría valorada
  con nivel pélvico y láminas calibradas, y análisis observacional de la marcha,
  vídeos de marcha (4: desde atrás, de frente, de lado y plano general, grabados con la
  cámara guiada por silueta), baropodometría Podisense (estática + dinámica múltiple) y
  escaneo de las espumas fenólicas como último paso — estas tres se hacen en su propia
  plataforma y aquí solo se marcan como hechas; el informe llega desde Podisense y no se
  adjunta. **Checklist bloqueante**: sin todo en verde no hay envío.

**Prescripción**
- Cola del prescriptor de clínica y **cola central Ortosend** (clínicas sin prescriptor) con
  **reparto automático** por antigüedad: al abrir un caso queda asociado; se libera al soltarlo,
  cerrar sesión o a los 45 min de inactividad.
- Firma solo por prescriptor con **colegiación verificada** (guarda dura). Salidas: prescribir
  (→ pago), contactar con el paciente (asignación pegajosa), devolver a clínica para repetir
  prueba (sin coste), no prescribir (el cliente no paga) y guardar borrador.

**Pago y panel del cliente**
- Sin prescripción no hay pago; enlace válido 30 días con caducidad → NO_CONVERTIDO y
  reactivación blanda hasta 6 meses (admin).
- Pago **simulado** (elige tarjeta/Bizum y entrega domicilio/clínica). La integración real de
  Stripe + webhook está preparada en el modelo (`Payment`) y pendiente de conectar.
- Línea de tiempo del tratamiento (7 hitos) con textos por estado.

**Taller**
- «Siguiente caso» + tablero por fases. Aceptación técnica (guardas: prescripción + pago),
  diseño (CAD archivado), fabricación **mecanizado CNC → confección a mano** (lote y material
  para trazabilidad), **calidad con foto del par obligatoria**, envío con seguimiento y entrega.
- Incidencias: captura inválida (→ devolver a clínica sin coste) y rehacer por defecto.
- Hoja de trabajo del caso (diagnóstico + pauta de fabricación).

**Administración Ortosend**
- KPIs, solicitudes de clínicas (aprobar → alta), red de clínicas (activar/suspender),
  profesionales con estado de colegiación, todos los casos (cerrar con revisión anual,
  reactivar pagos), lista de espera y **cola de WhatsApp simulada** (solo avisos + enlace,
  nunca contenido clínico).
- Mantenimiento (`/api/cron` o botón): caducidad de enlaces de pago y recordatorios d3/7/15.

**Modelo de datos y máquina de estados**
- `prisma/schema.prisma`: modelo completo (11 estados + excepciones, capturas con confirmación
  de servidor, prescripción inmutable, pagos, envíos, incidencias, liquidaciones, auditoría).
- `src/lib/states.ts`: transiciones permitidas por rol y guardas (sin prescripción no hay pago;
  sin pago no se fabrica).

Todo el ciclo de vida está verificado con un E2E de navegador real (reserva → captura →
prescripción → pago → taller → entrega → cierre, más cola central, guardas y captación).

## Puesta en marcha (desarrollo)

```bash
npm install
cp .env.example .env      # rellenar DATABASE_URL y AUTH_SECRET como mínimo
npx prisma migrate deploy # o `migrate dev` si cambias el esquema
npx prisma db seed        # datos de demo (3 clínicas, todos los roles, 2 casos)
npm run dev
```

Cuentas de demo (contraseña `ortosend123`):
`admin@` · `clinica@` · `profesionalreceta@` · `profesionalnoreceta@` · `tecnico.cassa@` ·
`recetador@` · `taller@` (todas `…@ortosend.com`), y clientes `jordi@demo.com` y `pere@demo.com`.

## Pendiente (siguientes fases)

- **Stripe real** (PaymentIntent + webhook; Bizum) y facturas.
- **Subida real de media** por fragmentos a Cloudflare R2/S3 con URLs firmadas; grabación de
  vídeo con getUserMedia + MediaRecorder; visor del escaneo 3D.
- **WhatsApp Business API** (360dialog/Twilio) para la cola de `Notification`; email de respaldo.
- Mapa Leaflet/OSM con radio 50 km real en `/buscar` (lat/lng ya en el modelo).
- Envíos (Sendcloud/Packlink) con webhook de entrega; PDF real de la prescripción.
- i18n ES/CA, passkeys, PWA offline del asistente de captura.
- Recordatorio de cita 24 h, seguimiento de adaptación d20 y revisión anual como cron real.
- Onboarding completo de clínicas (contrato, cesión de equipamiento, formación bloqueante).

## Despliegue en Vercel + Neon (sin terminal, ~5 min)

El repo ya está preparado: `vercel-build` aplica las migraciones en cada deploy,
`vercel.json` programa el cron diario y `/api/seed` carga los datos de demo.

1. **Neon** — entra en [neon.tech](https://neon.tech) (cuenta gratis, región UE),
   crea un proyecto «ortosend» y copia la **connection string** (`postgresql://…`).
2. **Vercel** — entra en [vercel.com](https://vercel.com) con tu GitHub, «Add New →
   Project», importa `stridelabbykalma-web/ortosend` y elige la rama a desplegar.
3. En **Environment Variables** añade:
   - `DATABASE_URL` → la cadena de Neon
   - `AUTH_SECRET` → un texto largo aleatorio
4. **Deploy**. Al terminar tendrás una URL `https://….vercel.app`.
5. Visita **`https://tu-url/api/seed`** una vez: carga clínicas, cuentas de demo y
   dos casos (solo funciona con la base de datos vacía; después queda inerte).
   Ya puedes entrar en `/login` con las cuentas de demo.

Producción real más adelante: dominio ortosend.com, `CRON_SECRET`, Cloudflare R2
para media, Stripe con Bizum y WhatsApp Business API (iniciar la verificación de
Meta cuanto antes).

## Requisitos legales a preparar en paralelo

Consentimientos y textos RGPD definitivos (datos de salud, retención 5 años), contrato de
encargado de tratamiento con cada clínica, licencia sanitaria del taller como fabricante de
producto sanitario a medida, y términos de venta.

---

`docs/prototipo.html` conserva el prototipo navegable original que sirvió como especificación
visual y funcional.
