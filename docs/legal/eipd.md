# Evaluación de impacto en la protección de datos (EIPD, art. 35 RGPD)

> **BORRADOR** preparado sobre el sistema real a fecha de noviembre de 2026, para
> revisión y firma por la asesoría jurídica y, en su caso, el DPD. Metodología de
> referencia: guías de la AEPD (Gestión del riesgo y EIPD). Responsable: [RAZÓN
> SOCIAL], NIF [CIF]. El RAT detallado está en `registro-actividades.md`.

## 1. Necesidad de la EIPD

El tratamiento cumple varios criterios que la hacen obligatoria: datos de categoría
especial (salud, art. 9) a escala no doméstica; datos de menores; imágenes y vídeos
del cuerpo (marcha, pies); y un análisis automatizado parcial (visión artificial
sobre los vídeos de marcha). Conclusión: **EIPD necesaria antes del lanzamiento**.

## 2. Descripción sistemática del tratamiento

- **Flujo**: reserva (web o clínica) → consentimientos explícitos y versionados →
  estudio en clínica (cuestionario, exploración, escáner 3D, vídeos de marcha,
  baropodometría) → valoración y prescripción por profesional colegiado →
  pago (solo si hay prescripción) → fabricación en taller → envío → seguimiento de
  adaptación y revisión incluida.
- **Datos**: identificativos y contacto; fecha de nacimiento; DNI (solo para crear
  contraseña en el alta por clínica); salud: cuestionario clínico, exploración,
  escaneos 3D, vídeos y fotos de los pies/marcha, presiones plantares,
  prescripción; autodeclaraciones opcionales al reservar (diabetes, herida), que
  solo se registran como nota para el prescriptor; pagos (referencia, no tarjeta).
- **Intervinientes**: paciente/tutor; clínica asociada (toma de datos del estudio);
  prescriptor colegiado (decisión clínica); taller (orden de trabajo, sin historia
  clínica); administración. Encargados: Vercel, Neon (UE), Stripe, Resend,
  ManyChat/Meta (solo avisos sin contenido clínico).
- **Decisiones automatizadas**: el análisis de visión artificial es **orientativo**;
  la decisión de prescribir (o no) es siempre humana y firmada. No hay decisiones
  con efectos jurídicos tomadas solo por la máquina (no aplica art. 22).
- **Menores**: gestionados por su tutor hasta los 16 (mayoría de edad sanitaria,
  Ley 41/2002); traspaso de cuenta automatizado con verificación al cumplirlos.

## 3. Necesidad y proporcionalidad

- Minimización: el taller ve la orden de trabajo, no la historia; ManyChat recibe
  una lista cerrada de campos logísticos verificada en código; el texto libre de
  los avisos nunca sale por WhatsApp; los enlaces públicos usan referencias opacas
  con caducidad.
- Limitación de finalidad: marketing solo con consentimiento separado (opcional).
- Exactitud: el paciente revisa sus datos al activar la cuenta; rectificación desde
  el panel y por email.
- Plazos: documentación clínica ≥ 5 años (Ley 41/2002); prescripción y declaración
  de producto a medida 10 años (MDR, Anexos IX/XIII); facturación 6 años; registro
  de consentimientos y auditoría mientras puedan exigirse responsabilidades.

## 4. Riesgos y medidas (implantadas ▸ / previstas ◻)

**R1. Acceso no autorizado a historia clínica** (probabilidad media, impacto alto)
▸ Control de acceso por rol y por clínica (aislamiento verificado por tests);
▸ auditoría de cada lectura/edición (AuditLog solo-INSERT);
▸ sesiones JWT con huella de contraseña y época de sesión (revocación al logout);
▸ rate limiting por IP en endpoints públicos; verificación en dos pasos del alta
(DNI + móvil + código WhatsApp). ◻ Cifrado por columna de campos clínicos; ◻ RLS
como segunda capa; ◻ CSP.

**R2. Fuga por canal de avisos (WhatsApp/email)** (media, alto)
▸ Lista cerrada de campos hacia ManyChat rechazada en código; nunca contenido
clínico; nota clínica solo por email al propio titular; enlaces efímeros redactados
en la cola de notificaciones.

**R3. Manipulación o pérdida del registro de consentimientos** (baja, alto)
▸ `consent_log`/`legal_texts` solo-INSERT con triggers; hash encadenado y función
de verificación de integridad; versionado de textos: se registra la versión exacta
aceptada. ◻ Rol de BD sin permisos de modificación para la aplicación.

**R4. Acceso indebido a vídeos/imágenes corporales** (media, alto)
▸ Descarga solo con token firmado de corta duración ligado al usuario; accesos
auditados. ◻ Almacenamiento dedicado UE con cifrado en reposo gestionado.

**R5. Menores: consentimiento inválido o acceso del no-tutor** (baja, alto)
▸ Declaración de tutoría con registro; gestión exclusiva desde la cuenta del tutor;
traspaso verificado a los 16 con doble aviso. ◻ Validación documental de la tutoría
en casos dudosos (proceso manual).

**R6. Pérdida de disponibilidad** (baja, medio)
▸ Infraestructura gestionada (Vercel/Neon, UE) con copias automáticas y
recuperación a un punto en el tiempo. ◻ Exportación periódica adicional y prueba
de restauración documentada.

**R7. Apropiación de cuenta** (media, alto)
▸ Recuperación solo con email verificado; creación de contraseña solo si la cuenta
es dueña del expediente; respuesta idéntica exista o no el usuario; bloqueo por
intentos; auditoría. ◻ Captcha en formularios públicos.

**R8. Transferencias internacionales (ManyChat/Meta, soporte EE. UU.)** (baja, medio)
▸ Datos mínimos (nombre, móvil, campos logísticos); SCC / EU-U.S. DPF de los
proveedores; alojamiento primario en la UE.

## 5. Conclusión (a validar por la asesoría)

Riesgo residual tras las medidas implantadas: **medio-bajo y aceptable** para el
lanzamiento, condicionado a: (1) completar los datos del responsable y designar
DPD; (2) ejecutar las medidas ◻ en el calendario post-lanzamiento ya planificado;
(3) revisar esta EIPD con cada cambio sustancial del tratamiento (nuevo encargado,
nueva categoría de datos, nuevo uso de la visión artificial). No se aprecia riesgo
residual alto que exija consulta previa a la AEPD (art. 36), sujeto a validación.

---
*Documento preparado por el equipo técnico como base de trabajo; no sustituye el
criterio de la asesoría jurídica ni del DPD.*
