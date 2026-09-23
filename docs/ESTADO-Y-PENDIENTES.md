# Ortosend — Estado del proyecto y problemas pendientes

> Última actualización: 23 de septiembre de 2026.
> Producción: **https://ortosend-five.vercel.app** · Rama de producción: `claude/hazlo-0argrv`
> (cada push a esa rama despliega automáticamente en Vercel).

## 1. Qué hay hecho y funcionando en producción

- **Aplicación completa** del ciclo de vida: reserva online (Flujo A) o alta desde clínica
  (Flujo B) → estudio de la pisada guiado (cuestionario, exploración y tests, vídeos y fotos
  con MediaPipe, baropodometría, escaneo de espumas por OneDrive) → prescripción (propia,
  Ortosend o con segunda opinión; firma solo con colegiación verificada) → pago (simulado)
  → taller (aceptación, diseño, CNC + confección, calidad con foto, envío, entrega) →
  seguimiento y revisión anual. Máquina de estados con guardas en `src/lib/states.ts`:
  sin prescripción no hay pago, sin pago no se fabrica.
- **Portada con buscador en vivo y mapa de Google Maps**: geolocalización automática
  (si acepta → clínicas a 50 km sin tocar nada; si escribe CP/población → manda el texto;
  si deniega → nada hasta que busque), icono de diana en el campo, resultados sin cambiar
  de página, lista de espera para zonas sin cobertura. Mapa gated por el banner de cookies.
- **Solicitudes de alta de profesionales**: el admin de clínica solicita el alta con ficha
  completa (nombre, DNI, titulación, nº colegiado, colegio) y Ortosend aprueba (cuenta +
  invitación 72 h) o rechaza con nota.
- **Paquete legal publicado**: aviso legal, privacidad, términos, cookies (`/legal/*`),
  consentimiento de salud v2 con vídeos/fotos y menores, banner de cookies (Maps solo tras
  consentir), AuditLog de accesos a datos de salud, re-autenticación para ver la
  prescripción.
- **Rendimiento del buscador**: funciones Vercel en `fra1` (junto a Neon Frankfurt) +
  warmup de la BD al cargar la portada (`/api/clinicas?warm=1`). Medido: ~2,3 s en frío,
  0,4–0,65 s en caliente.
- **E2E verificado** (navegador real): ciclo completo de los dos flujos, cola central,
  guardas y captación; también verificado el ciclo completo sobre producción.

Cuentas de demo (contraseña `ortosend123`): `admin@`, `clinica@`, `profesionalreceta@`,
`profesionalnoreceta@`, `tecnico.cassa@`, `recetador@`, `taller@` (todas `…@ortosend.com`)
y clientes `jordi@demo.com`, `pere@demo.com`.

## 2. Infraestructura y claves

| Pieza | Estado |
|---|---|
| Vercel | Proyecto `ortosend`, team `ortosend`, plan **Hobby**. Producción = rama `claude/hazlo-0argrv`. `vercel-build` = `prisma generate + migrate deploy + next build`. Cron diario `/api/cron` y `regions: ["fra1"]` en `vercel.json`. |
| Neon (Postgres) | Proyecto en `eu-central-1` (Frankfurt, UE). ~14 MB de datos. El plan free **se suspende por inactividad** (de ahí el warmup). |
| Google Maps | Clave JS API con fallback hardcodeado en `src/components/mapa-buscar.tsx` (override con `NEXT_PUBLIC_GOOGLE_MAPS_KEY`). **Pendiente: restringir la clave** a `ortosend-five.vercel.app/*` en Google Cloud. |
| Variables Vercel | `DATABASE_URL`, `AUTH_SECRET` (puestas a mano en el panel). `CRON_SECRET` sin poner aún. |
| Seed | `/api/seed` devuelve 403 en producción salvo `ALLOW_SEED=1`; solo funciona con BD vacía. |

## 3. Problemas y tareas pendientes — técnico

Por orden recomendado:

1. **Stripe en modo test** (siguiente pieza recomendada): PaymentIntent + webhook, Bizum,
   facturas. El modelo `Payment` ya está preparado; hoy el pago es simulado.
2. **Media en Cloudflare R2/S3**: hoy vídeos y fotos se guardan en Postgres con tope de
   4 MB por archivo (`/api/media`). Migrar a R2 (región UE) con URLs firmadas; visor del
   escaneo 3D.
3. **Email real (Resend)** y **WhatsApp Business API** (360dialog/Twilio) para la cola de
   `Notification` — hoy es una cola simulada visible en el panel de administración. La
   verificación de Meta para WhatsApp es lenta: **iniciarla cuanto antes**.
4. **Envíos** (Sendcloud/Packlink) con webhook de entrega; hoy el seguimiento es manual.
5. **PDF real de la prescripción** (hoy vista web con re-autenticación).
6. Recordatorio de cita 24 h, seguimiento de adaptación d20 y revisión anual como cron real
   (el cron diario existe; faltan esas dos plantillas de aviso).
7. i18n ES/CA, passkeys, PWA offline del asistente de captura.
8. Dominio propio `ortosend.com` (hoy `ortosend-five.vercel.app`).
9. `CRON_SECRET` en Vercel para proteger `/api/cron`.

## 4. Problemas y tareas pendientes — legal (RGPD y sector)

Análisis completo hecho; borradores en `docs/legal/`. Lo que queda, con responsable:

**Del propietario (esperando datos/acciones):**
- **Razón social + CIF + domicilio (+ Registro Mercantil)** → rellenar los `[PENDIENTE]` de
  `src/lib/legal.ts` (un solo sitio; alimenta todos los textos legales) y de los dos
  borradores de `docs/legal/`.
- **Pasar Vercel a plan Pro al lanzar**: el DPA de Vercel solo cubre Pro/Enterprise, y el
  plan Hobby es de uso no comercial. Guardar como evidencia los PDFs de
  vercel.com/legal/dpa y neon.com/dpa (Neon/Databricks vinculan por uso, sin firma).
- **Restringir la clave de Google Maps** al dominio de producción.
- **Revocar los tokens compartidos por chat** durante el desarrollo (Neon `napi_…`,
  Vercel `vck_…`/`vcp_…`) y regenerarlos si hacen falta.
- **Contratar consultora RGPD sanitaria** para la EIPD (art. 35, obligatoria antes de tratar
  datos de salud reales) y valorar el DPD; los borradores de este repo son su punto de
  partida.
- **Licencia AEMPS del taller** como fabricante de producto sanitario a medida (trámite
  lento: iniciarlo cuanto antes) y seguro de responsabilidad.

**Ya redactado como borrador (revisar con asesoría y firmar):**
- `docs/legal/contrato-encargado-clinicas.md` — contrato de encargado art. 28 RGPD con cada
  clínica (10 cláusulas), a firmar junto al contrato mercantil de colaboración.
- `docs/legal/registro-actividades.md` — registro de actividades art. 30 (7 tratamientos).

**Al contratar cada proveedor futuro** (Stripe, R2, WhatsApp BSP, email, envíos): alta en el
registro de actividades y DPA correspondiente.

## 5. Particularidades del entorno de desarrollo (sesiones Claude Code)

- **Regla de trabajo**: todo cambio se sube a producción (commit + push a
  `claude/hazlo-0argrv`); no gastar créditos en verificaciones extensas ni en bucles de
  espera de despliegues.
- Dos sesiones pueden avanzar la misma rama en paralelo → **siempre `git pull --rebase` y
  `npm install` antes de trabajar**.
- El sandbox no tiene salida a internet desde Chromium/Node (solo curl vía proxy). El puerto
  5432 de Neon está bloqueado: para tocar datos de producción usar el **endpoint HTTP SQL de
  Neon** (`POST https://ep-autumn-cell-b1mnye97.c-5.eu-central-1.aws.neon.tech/sql` con
  header `Neon-Connection-String`).
- Postgres local en `127.0.0.1:5433` (cluster en `/var/lib/postgresql/ortosend-data`); se
  para entre turnos, rearrancar con `pg_ctl` como usuario `postgres`.

## 6. Documentación del repo

| Documento | Contenido |
|---|---|
| `README.md` | Visión general, funcionalidades, puesta en marcha y despliegue |
| `docs/ESTADO-Y-PENDIENTES.md` | Este documento: estado real + todo lo pendiente |
| `docs/legal/contrato-encargado-clinicas.md` | Borrador contrato art. 28 con clínicas |
| `docs/legal/registro-actividades.md` | Borrador registro art. 30 |
| `docs/escaneos-carpeta-compartida.md` | Circuito del escaneo de espumas por OneDrive |
| `docs/prototipo.html` | Prototipo navegable original (especificación visual) |
| `src/lib/legal.ts` | Datos societarios centralizados y versión de consentimiento (v2) |
