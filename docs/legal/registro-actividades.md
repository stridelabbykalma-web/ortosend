# Registro de actividades de tratamiento (art. 30 RGPD)

> **BORRADOR** para revisión por asesoría jurídica. Refleja los tratamientos reales de la
> plataforma Ortosend a fecha de noviembre de 2026. Responsable: [RAZÓN SOCIAL], NIF
> [CIF], [DOMICILIO], contacto: hola@ortosend.es. DPD: [pendiente de designar].

Común a todos los tratamientos: alojamiento en la UE (Frankfurt) con **Vercel Inc.**
(aplicación; encargado — DPA vinculado al plan Pro) y **Neon/Databricks** (base de datos;
encargado — DPA incorporado a sus términos de servicio); cifrado en tránsito, contraseñas
con hash, control de acceso por rol y registro de accesos. Transferencias fuera del EEE:
solo el acceso de soporte de dichos proveedores desde EE. UU., amparado por SCC / EU-U.S.
Data Privacy Framework.

---

## T1 — Pacientes y casos clínicos (núcleo del servicio)

- **Finalidad**: gestión de la cita, estudio de la pisada, valoración y prescripción,
  fabricación y entrega de plantillas a medida, seguimiento y revisión anual.
- **Base jurídica**: ejecución de contrato (art. 6.1.b) y consentimiento explícito para
  datos de salud (art. 9.2.a), recogido con casillas separadas y versionado (v2).
- **Interesados**: pacientes (incl. menores vía padre/madre/tutor).
- **Categorías**: identificativos y contacto; fecha de nacimiento; **salud**: cuestionario
  clínico, exploración y tests, **vídeos de la marcha y fotografías de los pies**, análisis
  automatizado orientativo (puntos de pose, ángulos, informe preliminar — decisión final
  siempre humana), baropodometría, escaneo de espumas, prescripción.
- **Destinatarios/encargados**: clínica asociada donde se realiza el estudio (contrato art.
  28) y, si la clínica lo conecta, su programa de gestión de agenda (p. ej. Docfav) como
  subencargado autorizado: solo nombre, teléfono, email y fecha/hora/tipo de cita, sin
  contenido clínico; taller de fabricación (accede solo a la orden de trabajo, no a la historia);
  [futuro] almacenamiento de archivos clínicos en región UE.
- **Plazos**: documentación clínica ≥ 5 años; resto, duración de la relación + plazos de
  prescripción.
- **Medidas específicas**: re-autenticación para consultar la prescripción; AuditLog de
  cada acceso a caso y documento; análisis de imagen ejecutado en el dispositivo de captura.

## T2 — Usuarios y cuentas (clientes, profesionales, clínicas, taller, administración)

- **Finalidad**: autenticación, control de acceso por rol, invitaciones de activación.
- **Base**: ejecución de contrato; interés legítimo en la seguridad.
- **Categorías**: identificativos, contacto, credenciales (hash), rol y clínica; para
  profesionales: DNI, titulación, nº y colegio de colegiación, verificación.
- **Plazos**: mientras la cuenta esté activa + plazos de responsabilidad.

## T3 — Pagos y facturación

- **Finalidad**: cobro del tratamiento (precio único), facturación y contabilidad.
- **Base**: ejecución de contrato y obligación legal (fiscal).
- **Categorías**: importe, método, fecha, referencia del proveedor de pago
  (`payment_intent`). Los datos de tarjeta **no** se tratan en la plataforma: los gestiona
  **Stripe** (Stripe Payments Europe, Ltd.; DPA incorporado a sus términos; tarjeta y Bizum
  en su pasarela, la plataforma solo recibe la confirmación firmada).
- **Plazos**: documentación mercantil 6 años (art. 30 C. de Comercio); fiscal, 4 años.

## T4 — Comunicaciones del servicio (WhatsApp/email)

- **Finalidad**: avisos operativos (cita, estudio, prescripción lista, recordatorios de
  pago d3/7/15, envío, entrega, adaptación, revisión anual).
- **Base**: ejecución de contrato; consentimiento específico para el canal WhatsApp.
- **Contenido**: exclusivamente aviso + enlace al panel; **nunca contenido clínico**
  (lista cerrada de campos verificada en código: `src/lib/manychat.ts`).
- **Destinatarios/encargados**: **ManyChat, Inc.** como plataforma del canal WhatsApp
  (EE. UU.; SCC/DPF; recibe solo nombre, móvil, referencias opacas y campos logísticos
  — fecha de cita, clínica, enlace) y, por debajo, WhatsApp/Meta como servicio de
  mensajería; **Resend** para el email transaccional (DPA; recibe email, asunto y texto
  del aviso). El consentimiento del canal WhatsApp se recoge con casilla propia y puede
  retirarse (palabra clave BAJA o desde el panel).

## T5 — Captación (solicitudes de clínicas y lista de espera de zonas)

- **Finalidad**: evaluar solicitudes de clínicas y avisar a interesados de zonas sin
  cobertura cuando haya clínica.
- **Base**: medidas precontractuales / consentimiento (el interesado deja su contacto).
- **Categorías**: contacto profesional o particular, zona.
- **Plazos**: hasta resolución de la solicitud o alta de clínica en la zona; máximo
  [1 año] para la lista de espera.

## T6 — Registro de accesos y seguridad (AuditLog)

- **Finalidad**: trazabilidad de accesos a datos de salud (obligación de seguridad),
  investigación de incidentes.
- **Base**: obligación legal (art. 32 RGPD) e interés legítimo en la seguridad.
- **Categorías**: usuario, acción, caso/documento accedido, fecha y hora.
- **Plazos**: [3 años] desde el registro.

## T7 — Web pública (visitantes)

- **Finalidad**: mostrar clínicas cercanas.
- **Datos**: geolocalización puntual del navegador (no se almacena); texto buscado enviado
  a Nominatim/OSM sin identificadores; cookies de Google Maps **solo tras consentimiento**
  (banner; el mapa no carga sin aceptar). Cookie de sesión: técnica, exenta.

---

**Pendientes señalados**: designación de DPD y comunicación a la AEPD; EIPD (art. 35) —
**borrador en `docs/legal/eipd.md`** a validar por la asesoría; alta de encargados futuros
(almacenamiento de archivos clínicos, transportista de envíos) con su DPA; plazos entre
corchetes a validar por la asesoría.
