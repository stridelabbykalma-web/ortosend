# Escaneo → paciente, automático (RevoScan)

Cómo encaja el escaneo de las espumas fenólicas en el estudio sin que el
profesional tenga que subir ni renombrar archivos.

## La idea

RevoScan no puede hablar con Ortosend, pero **deja elegir dónde se guarda cada
escaneo**. Ese es el enganche: una carpeta por caso, con un código dentro del
nombre, y un puente local que sube lo que aparece en ella.

```
Consulta                      PC del escáner                    Ortosend
──────────                    ──────────────                    ────────
Asistente de captura   ──►  C:\Ortosend\Escaneos\               Case.scanCode
 «Guarda en                   ORT-00123-4K7Q2M9X-juan-perez\        │
  ORT-00123-4K7Q2M9X»           pie.stl  ─── puente.js ──► POST /api/scan/ingest
                                                                    │
 check verde en pantalla ◄──── GET /api/scan/estado ◄─────  MediaAsset scan_espumas
                                                            (confirmedAt = servidor)
```

## Piezas

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| `Case.scanCode` | `prisma/schema.prisma` | Código único del caso (8 caracteres sin 0/O/1/I). Se crea solo la primera vez que hace falta. |
| `ScanAgent` | `prisma/schema.prisma` | Un puente dado de alta por la clínica. Token firmado (`kind: "scan"`), revocable, con última señal. |
| `src/lib/scan.ts` | servidor + interfaz | Nombre de carpeta, lectura del código en una ruta, formatos y tope de tamaño. |
| `GET /api/scan/ingest` | servidor | Lista de carpetas que el puente debe tener creadas. |
| `POST /api/scan/ingest` | servidor | Recibe el archivo, resuelve el caso por el código y crea el `MediaAsset` (`scan_espumas`) confirmado. |
| `GET /api/scan/estado` | servidor | Lo que consulta la pantalla del asistente: carpeta, si el puente da señal y si el escaneo ya llegó. |
| `EscaneoPuente` | `src/components/caso/escaneo-puente.tsx` | Paso del escaneo: enseña la carpeta, espera el archivo y permite adjuntarlo a mano. |
| `tools/puente-escaneo/` | PC del escáner | El vigilante de la carpeta (Node 18, sin dependencias). |

## Seguridad y RGPD

- El puente se autentica con un token firmado con `AUTH_SECRET` que lleva
  únicamente el id del agente. Se revoca desde **Panel → Puente de escaneo**.
- Solo acepta escaneos de casos **de su propia clínica** y **en estudio**
  (`CITA_RESERVADA`, `ESTUDIO_EN_CURSO`, `DEVUELTO_CLINICA`).
- El número de caso del nombre de la carpeta tiene que cuadrar con el código:
  una carpeta renombrada a mano se rechaza.
- Cada escaneo recibido deja un `CaseEvent` con el archivo y el tamaño; las
  subidas hechas desde el navegador quedan además en `AuditLog`.
- El archivo se sirve con el mismo control de acceso que el resto de capturas
  (`/api/media/[id]`).

## Respaldo manual

Si la clínica todavía no tiene el puente instalado (o el PC está apagado), el
mismo paso del asistente permite **adjuntar el archivo desde el navegador**: se
asocia por el mismo código y con las mismas comprobaciones. Marcar el escaneo
«hecho» sin archivo sigue existiendo como último recurso, con aviso de que el
taller necesita el modelo antes de diseñar.

## Ajustes

- `SCAN_MAX_MB` (por defecto 40): tope del modelo 3D. En el prototipo el binario
  se guarda en Postgres (`MediaBlob`); en producción irá a R2/S3 por fragmentos.
- `NEXT_PUBLIC_APP_URL`: URL que se enseña en el panel para configurar el puente
  (si no está, se deduce de la petición).
