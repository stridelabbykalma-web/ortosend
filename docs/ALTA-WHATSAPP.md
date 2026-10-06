# Alta de pacientes con consentimiento por WhatsApp

El profesional da de alta al paciente desde su panel. El paciente (o su tutor, si
tiene menos de 16 años) recibe un WhatsApp de Ortosend y acepta, **uno a uno y dentro
del propio chat**, los documentos legales. Cuando acepta los cuatro obligatorios se
abre su ficha clínica. Con la ficha completa, el profesional le envía el acceso y el
paciente crea su contraseña con **DNI + móvil + código de WhatsApp**.

```
Panel (pre-alta) ──► ManyChat: plantilla de bienvenida ──► «Empezar»
   PENDIENTE            │
                        ▼  cada botón llama a POST /api/manychat/consentimiento
   1 Privacidad ─► 2 Datos de salud ─► 3 Tratamiento ─► 4 Condiciones ─► 5 Marketing (opcional)
                                                          │
                                         ACEPTADO: ficha abierta, etiqueta consent_ok
Panel: completa la ficha + DNI ─► «Enviar acceso» ─► WhatsApp ─► /acceso (DNI + móvil + código)
```

Código: `src/lib/alta.ts` (reglas del flujo), `src/lib/acceso.ts` (contraseña),
`src/lib/manychat.ts` (API), `src/lib/consent/*` (textos y registro).
Tests: `npm test` (necesita Postgres; ver «Tests» abajo).

---

## 1. Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Qué es |
|---|---|
| `MANYCHAT_API_KEY` | ManyChat → Settings → API → *Generate your API Key*. Sin ella, los envíos se simulan y quedan en el panel de administración (tabla `Notification`). |
| `MANYCHAT_WEBHOOK_SECRET` | Texto largo aleatorio que inventas tú (p. ej. `openssl rand -hex 32`). ManyChat lo envía en la cabecera `X-Ortosend-Secret`. **Sin esta variable el webhook rechaza todo.** |
| `MANYCHAT_FLOW_INVITACION` | ID (`flow_ns`) del flujo «Alta · Invitación». |
| `MANYCHAT_FLOW_RECORDATORIO` | ID del flujo «Alta · Recordatorio» (24 h sin terminar). |
| `MANYCHAT_FLOW_ACCESO` | ID del flujo «Alta · Perfil listo». |
| `MANYCHAT_FLOW_CODIGO` | ID del flujo «Alta · Código de acceso». |

El ID de un flujo se ve en la URL al editarlo: `.../cms/files/content20241006123456_789012` → `content20241006123456_789012`.

Las URL públicas salen de `EMPRESA.web` en `src/lib/legal.ts`. Cámbialo a `https://ortosend.com` cuando el dominio apunte a Vercel.

## 2. ManyChat: campos y etiquetas

**Settings → Fields → User Fields** (todos de tipo *Text*):

| Campo | Lo escribe | Para qué |
|---|---|---|
| `ortosend_ref` | Ortosend (API) | Identificador secreto de la invitación. Va en los enlaces y en cada llamada al webhook. |
| `ortosend_paciente` | Ortosend (API) | Nombre de pila del paciente (para que el tutor sepa de quién se trata). |
| `ortosend_codigo` | Ortosend (API) | Código de 6 cifras para crear la contraseña. |
| `ortosend_url_acceso` | Ortosend (API) | `https://ortosend.com/acceso`. |
| `ortosend_siguiente` | ManyChat (respuesta del webhook) | Qué mostrar a continuación. |
| `ortosend_url_gestion` | ManyChat (respuesta del webhook) | Enlace de 24 h para retirar consentimientos. |

**Settings → Tags**: `consent_ok` y `marketing_ok` (las pone y quita Ortosend).

> Ortosend solo puede escribir en los cuatro primeros campos: cualquier otro se
> rechaza en el código antes de salir (`src/lib/manychat.ts`). Nunca se envían datos de salud.

## 3. ManyChat: la llamada al webhook (External Request)

Todas las llamadas son iguales; solo cambia el cuerpo. En el flujo: **Actions → External Request**.

- **Method**: `POST`
- **URL**: `https://ortosend.com/api/manychat/consentimiento`
- **Headers**: `X-Ortosend-Secret: <MANYCHAT_WEBHOOK_SECRET>` y `Content-Type: application/json`
- **Body** (JSON). Inserta las variables con el botón *{ }*. `{{user_id}}` es el campo de sistema del ID de contacto:
  ```json
  { "ref": "{{ortosend_ref}}", "subscriber_id": "{{user_id}}", "accion": "respuesta", "documento": "privacidad", "respuesta": "acepto" }
  ```
- **Response mapping**: `$.siguiente` → campo `ortosend_siguiente`.

Valores de `accion`: `empezar`, `respuesta` (con `documento` y `respuesta`) y `revisar`.
Valores de `documento`: `privacidad`, `salud`, `tratamiento`, `condiciones`, `marketing`.
Valores de `respuesta`: `acepto` o `rechazo`.

La respuesta de Ortosend (`siguiente`) es una de estas:
`privacidad` · `salud` · `tratamiento` · `condiciones` · `marketing` · `fin` · `rechazado` · `caducado` · `invalido`.

## 4. ManyChat: los flujos

### 4.1 «Alta · Invitación» (`MANYCHAT_FLOW_INVITACION`)

1. **Mensaje de plantilla** (bienvenida, aprobada por Meta, ver §5) con un botón de respuesta rápida **Empezar**.
2. Al pulsar *Empezar* → External Request con `"accion": "empezar"` → paso **Router**.
3. **Router**: un bloque *Condition* sobre `ortosend_siguiente` con una rama por valor:

| Valor | Mensaje |
|---|---|
| `privacidad` | **Doc 1** |
| `salud` | **Doc 2** |
| `tratamiento` | **Doc 3** |
| `condiciones` | **Doc 4** |
| `marketing` | **Doc 5** |
| `fin` | «¡Gracias! Tu alta está completa. Tu profesional ya puede preparar tu ficha. Si algún día quieres retirar un consentimiento, escribe BAJA.» |
| `rechazado` | «Sin aceptar este documento no podemos fabricar tus plantillas. Si cambias de opinión, pulsa Revisar.» + botón **Revisar** → External Request `"accion": "revisar"` → Router |
| `caducado` | «Este enlace ha caducado. Pide a tu profesional que te lo reenvíe.» |
| `invalido` | «Este mensaje ya no es válido. Usa el último que te hemos enviado.» |

4. **Doc 1 … Doc 5**: mensaje de texto normal (el paciente acaba de escribir, así que la ventana de 24 h de WhatsApp está abierta) con dos botones:

   > Documento 1 de 5 · **Política de privacidad**
   > Léelo completo aquí: https://ortosend.com/l/{{ortosend_ref}}/privacidad
   > ¿Lo aceptas?
   > [Acepto] [No acepto]

   - **Acepto** → External Request `{"accion":"respuesta","documento":"privacidad","respuesta":"acepto", ...}` → Router
   - **No acepto** → igual con `"respuesta":"rechazo"` → Router

   Repite el bloque con `salud`, `tratamiento` y `condiciones` (documentos 2, 3 y 4). El 5 (`marketing`) lleva los botones **Sí** / **No, gracias**: es opcional y cualquiera de las dos respuestas termina el alta.

> El enlace `https://ortosend.com/l/{{ortosend_ref}}/<documento>` muestra la **versión exacta** que se
> registrará al aceptar, aunque mientras tanto se publique otra. No pongas resúmenes del texto legal
> en ManyChat: lo que se acepta es lo que hay detrás del enlace, versionado en la base de datos.

### 4.2 «Alta · Recordatorio» (`MANYCHAT_FLOW_RECORDATORIO`)

Plantilla «te quedan documentos por revisar» con botón **Continuar** → External Request `"accion": "empezar"` → el mismo Router (puedes llamar al flujo 4.1 con *Start another flow* a partir del Router).

### 4.3 «Alta · Perfil listo» (`MANYCHAT_FLOW_ACCESO`)

Plantilla «tu perfil está listo» con botón de URL a `https://ortosend.com/acceso`.

### 4.4 «Alta · Código de acceso» (`MANYCHAT_FLOW_CODIGO`)

Plantilla de **autenticación** de WhatsApp con el código `{{ortosend_codigo}}` (botón «Copiar código»).

### 4.5 Retirar consentimientos por WhatsApp (palabra clave BAJA)

**Automation → Keywords**: `BAJA` (y, si quieres, un botón «Mis consentimientos» en el menú). Acción:

- External Request `POST https://ortosend.com/api/manychat/gestion`, misma cabecera secreta, cuerpo `{ "subscriber_id": "{{user_id}}" }`, mapping `$.url` → `ortosend_url_gestion`.
- *Condition* `ortosend_url_gestion` no está vacío → «Aquí puedes retirar tus consentimientos (enlace válido 24 h): {{ortosend_url_gestion}}». Si está vacío → «No encontramos ningún alta con este número.»

## 5. Plantillas para enviar a aprobación de Meta

Categoría *Utility*, salvo el código (*Authentication*). Ninguna menciona salud, pies ni plantillas ortopédicas.

1. **ortosend_bienvenida**: «Hola {{1}}, tu profesional te ha dado de alta en Ortosend{{2}}. Para continuar necesitamos que revises y aceptes unos documentos. Son 2 minutos.» Botón de respuesta rápida: *Empezar*.
   `{{1}}` = nombre, `{{2}}` = « (perfil de {{ortosend_paciente}})» solo si escribes al tutor; si no, déjalo vacío.
2. **ortosend_recordatorio**: «Hola {{1}}, aún te quedan documentos por revisar para completar tu alta en Ortosend. El enlace caduca pronto.» Botón: *Continuar*.
3. **ortosend_perfil_listo**: «Hola {{1}}, tu perfil en Ortosend está listo. Crea tu contraseña con tu DNI y tu móvil.» Botón URL: `https://ortosend.com/acceso`.
4. **ortosend_codigo** (Authentication): «{{1}} es tu código de acceso a Ortosend. Caduca en 10 minutos.» Botón «Copiar código».

## 6. Textos legales

Están en la tabla `legal_texts`. La migración crea la **versión 1** de los cinco con el texto
`[PENDIENTE] …`. **No se pueden editar** (lo impide un trigger). Para poner el texto definitivo,
inserta la versión 2:

```sql
INSERT INTO legal_texts (id, type, version, title, content)
VALUES ('legal_privacidad_v2', 'PRIVACIDAD', 2, 'Política de privacidad', $$
…texto completo…
$$);
```

O desde código: `publicarTexto(prisma, "PRIVACIDAD", "Política de privacidad", texto)` (`src/lib/consent/registro.ts`).
La huella SHA-256 la calcula la base de datos. Las invitaciones ya enviadas siguen mostrando y
registrando la versión con la que se enviaron; las nuevas usan la última.

Tipos: `PRIVACIDAD`, `DATOS_SALUD`, `TRATAMIENTO`, `CONDICIONES`, `MARKETING`.

## 7. Protección del registro en la base de datos

- `consent_log`, `legal_texts` y `AuditLog` **solo admiten INSERT**: un trigger rechaza UPDATE,
  DELETE y TRUNCATE.
- Cada fila de `consent_log` lleva la hora del reloj de la base de datos y un hash encadenado con la
  anterior. Para comprobar que nadie ha tocado nada:
  ```sql
  SELECT * FROM consent_log_verify();   -- vacío = todo íntegro
  ```
- **Recomendado en producción**: que la app no se conecte con el usuario propietario de Neon (que
  podría desactivar los triggers), sino con un rol sin permisos de modificación sobre esas tablas.
  Las migraciones (`vercel-build`) siguen usando el propietario mediante `DIRECT_URL`/`DATABASE_URL`
  de despliegue:
  ```sql
  CREATE ROLE ortosend_app LOGIN PASSWORD '…';
  GRANT USAGE ON SCHEMA public TO ortosend_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ortosend_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ortosend_app;
  REVOKE UPDATE, DELETE, TRUNCATE ON "consent_log", "legal_texts", "AuditLog" FROM ortosend_app;
  ```

## 8. Seguridad

- El enlace de cada invitación (`ortosend_ref`) son 32 bytes aleatorios. En la base de datos solo se
  guarda su hash. Caduca a las 72 h y deja de valer al reenviar.
- El webhook exige la cabecera secreta y comprueba que el contacto de ManyChat es el de la invitación.
  Las pulsaciones dobles o simultáneas no duplican filas.
- Las páginas públicas (`/l/…`, `/consentimientos/…`, `/acceso`) tienen límite de peticiones por IP
  (en Postgres), no se indexan y no envían el *referer*.
- Crear contraseña exige DNI + móvil + código de 6 cifras por WhatsApp (10 min, 5 intentos y 15 min
  de bloqueo). La respuesta es la misma exista o no el paciente. Si el móvil ya tiene cuenta, el
  paciente se añade a ella sin cambiar su contraseña.
- La ficha clínica solo la ven la clínica del paciente, el taller, el recetador central y la
  administración, y cada lectura y edición queda en `AuditLog`. Sin los consentimientos obligatorios
  en vigor la ficha queda en **solo lectura**: no se puede editar, prescribir ni fabricar.

## 9. Tests

```bash
# Postgres local (o TEST_DATABASE_URL apuntando a cualquier Postgres de pruebas)
npm test
```

Cada ejecución crea un esquema temporal, aplica todas las migraciones (con los triggers) y lo borra al
terminar. ManyChat se sustituye por un doble que registra cada llamada.
