# Escaneo → paciente → taller, sin tocar archivos (Revo Scan)

Cómo llega el escaneo de las espumas fenólicas desde el PC del escáner de la
clínica hasta el taller, asociado al paciente, sin que el profesional fusione,
malle, exporte, cree carpetas ni renombre nada: **escanea y pulsa Parar**.

## La idea

Revo Scan no tiene API ni nube: solo deja archivos en el disco (Revo Scan 6:
un archivo por escaneo; Revo Scan 5: una carpeta de proyecto). El puente del
PC del escáner sube ese escaneo en bruto entero y el **taller** lo abre en su
Revo Scan, lo procesa («Edición con un clic») y exporta. Como Revo Scan no
sabe nada de Ortosend, la asociación no depende de carpetas ni de nombres:
**el caso abierto en el paso del escaneo es el que recibe el archivo.**

```
Clínica (PC del escáner)              Ortosend                        Taller
────────────────────────              ────────                        ──────
Revo Scan guarda el escaneo           POST /api/scan/subida
   (proyecto RS5 / archivo RS6) ───►     → URL firmada de R2
         │                                                        Expediente del caso
   puente.js (zip) ── PUT directo a R2 (sin límite) ──►  bucket   «Descargar proyecto Revo Scan»
         │                            POST /api/scan/confirmar          │
         └─────────────────────►        → ¿qué caso espera?  ◄──── GET /api/media/[id]
                                         → MediaAsset scan_espumas        (URL firmada 10 min)
Asistente (tablet)                       + evento en el historial
 paso «Escaneo de las espumas»
 GET /api/scan/estado cada 4 s ───►    scanWaitingAt = ahora
 ◄── check verde sin recargar
```

## Piezas

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| `Case.scanWaitingAt` | `prisma/schema.prisma` | Última vez que el asistente de ese caso estaba en el paso del escaneo (la pantalla lo renueva cada 4 s). |
| `ScanAgent` | `prisma/schema.prisma` | Puente dado de alta por la clínica: token firmado (`kind: "scan"`), revocable, última señal. |
| `ScanUpload` | `prisma/schema.prisma` | Bandeja de escaneos de la clínica: archivo, tamaño, dónde está el binario (`r2` + key, o `db` + bytes) y a qué caso se asoció. |
| `src/lib/storage.ts` | servidor | Cloudflare R2 por API S3: URL firmada de subida (PUT, 1 h), de descarga (GET, 10 min) y comprobación de tamaño. |
| `src/lib/escaneos.ts` | servidor | Quién sube (puente o sesión), bandeja, asociación al caso y autoasociación al caso que espera. |
| `POST /api/scan/subida` | servidor | «Voy a subir X de N bytes» → URL firmada (o modo servidor si no hay R2). |
| `POST /api/scan/confirmar` | servidor | «Ya está en R2» → comprueba tamaño, lo da por recibido y lo asocia. |
| `POST /api/scan/ingest` | servidor | Modo servidor (sin R2): el archivo entero en la petición, a Postgres. `GET` = saludo del puente. |
| `GET /api/scan/estado` | servidor | Lo que consulta el asistente: renueva la espera y devuelve escaneos, bandeja y si el puente da señal. |
| `POST /api/scan/asignar` | servidor | Confirmación a mano desde la bandeja («es de este paciente»). |
| `GET /api/media/[id]` | servidor | Descarga autenticada + `AuditLog`; para escaneos redirige a la URL firmada de R2. |
| `EscaneoPuente` | `src/components/caso/escaneo-puente.tsx` | Paso del escaneo: espera, bandeja para confirmar, subida a mano con progreso. |
| `Escaneos` | `src/components/caso/expediente.tsx` | En el expediente: «Descargar escaneo» por cada archivo (taller, prescriptor, clínica). |
| `public/puente/` | PC del escáner | Vigila la carpeta de Revo Scan (proyectos RS5 → ZIP propio sin dependencias; archivos RS6) y, opcionalmente, una carpeta de mesh exportados (gzip). Node 18, sin dependencias. |

## Reglas de asociación

1. Al recibir un escaneo se buscan los casos de esa clínica en estudio con
   `scanWaitingAt` en los últimos 10 min.
2. **Exactamente uno** → se asocia solo (MediaAsset `scan_espumas` confirmado,
   evento en el historial, check verde en el asistente sin recargar).
3. **Cero o varios** → queda en la bandeja 24 h; el asistente de cualquier
   caso abierto de la clínica lo ofrece: «¿es de Pere Vidal?» → un toque.
4. Un caso puede acumular varios escaneos (repetir el molde, o el mismo
   proyecto vuelto a subir tras fusionarlo): el taller ve todos y elige.
5. El expediente distingue «proyecto Revo Scan» (abrir en Revo Scan → un clic
   → exportar) de «mesh exportado» (STL listo para el CAD).

## Seguridad y RGPD

- Token del puente firmado con `AUTH_SECRET`, solo con el id del agente;
  se revoca desde **Panel → Puente de escaneo**.
- Solo acepta escaneos para casos **de su propia clínica** y **en estudio**.
- La subida directa usa una URL firmada de 1 h para un objeto concreto; el
  servidor comprueba que llegó completo (tamaño) antes de darlo por recibido.
- La descarga exige sesión y rol con acceso al caso, y queda en `AuditLog`;
  la URL de R2 caduca a los 10 min.

## Qué hay que contratar

**Cloudflare R2** (un bucket para todos los asociados; 10 GB/mes gratis y
0,015 $/GB después; sin coste por descargas). Variables de entorno:

```
R2_ACCOUNT_ID=…            # Cloudflare → R2 → Account ID
R2_ACCESS_KEY_ID=…         # R2 → Manage R2 API Tokens → Object Read & Write
R2_SECRET_ACCESS_KEY=…
R2_BUCKET=ortosend-escaneos
```

Para que la **subida a mano desde el navegador** vaya también directa al
bucket, el bucket necesita CORS (R2 → bucket → Settings → CORS policy):

```json
[{ "AllowedOrigins": ["https://app.ortosend.com"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
```

Sin R2 configurado todo funciona en **modo servidor**: el archivo pasa por
Ortosend y se guarda en Postgres, con tope `SCAN_MAX_MB` (40) y, en Vercel,
el límite de ~4,5 MB por petición — vale para desarrollo, no para un mesh.
`R2_ENDPOINT` permite usar otro S3 compatible (MinIO, AWS).
