# Batería del estudio de captura con vídeos reales

Prueba de verdad del estudio de captura (`src/components/caso/captura-studio.tsx`): Chromium
usa un vídeo de una persona andando como **cámara falsa** y Playwright recorre el flujo real
de la app (login del equipo → caso → paso del protocolo → MediaPipe → arranque automático →
zoom → grabación → subida → informe en la base de datos). No va en `npm test`: es manual,
tarda unos 10 minutos y necesita red para bajar los clips.

## Requisitos

- Postgres local con el esquema y la semilla (`npx prisma migrate deploy && npx prisma db seed`).
- `ffmpeg`, `psql`, Playwright con Chromium (`npx playwright install chromium` si no está).
- La app compilada con el WASM de MediaPipe servido en local, porque el navegador de la prueba
  no debe depender del CDN:

```bash
cp -r node_modules/@mediapipe/tasks-vision/wasm public/mediapipe/wasm   # no se sube al repo
NEXT_PUBLIC_MEDIAPIPE_WASM=/mediapipe/wasm npm run build && npm start
```

- Un caso en `CITA_RESERVADA` o `ESTUDIO_EN_CURSO` de la clínica de la profesional de demo, con
  `rxRoute` decidido (la semilla crea el de Marta Roca; ponerle `rxRoute='ORTOSEND'`):

```bash
psql "$DATABASE_URL" -tAc "update \"Case\" set \"rxRoute\"='ORTOSEND' where state='CITA_RESERVADA' returning id"
```

## Ejecución

```bash
tests/estudio-captura/descargar-clips.sh        # clips de Mixkit → clips/*.mjpeg
CASE_ID=<id del caso> DATABASE_URL=postgresql://... node tests/estudio-captura/run.js
# o solo algunos escenarios:
CASE_ID=... DATABASE_URL=... node tests/estudio-captura/run.js post_ok foto_manual
python3 tests/estudio-captura/zoom_analysis.py post_ok ant_32623   # suavidad del zoom
```

Resultados en `out/`: traza por frame (`*_log.json`, la emite el estudio con `?studioDebug=1`),
capturas de pantalla durante la grabación y en la revisión, el archivo tal y como quedó en la
base de datos (`*_media.webm|jpg`) y una tira de fotogramas (`*_media_strip.png`).

## Escenarios

| Nombre | Clip | Qué comprueba |
|---|---|---|
| post_ok, post_23378 | persona alejándose | Marcha posterior: arranca sola, graba 10 s, sube, informe y apartado «Análisis de la marcha» |
| ant_32623 | persona viniendo de frente | Marcha anterior completa |
| post_rot180 / rot90 / rot270 | el mismo clip girado | El estudio endereza la imagen y el vídeo guardado sale derecho |
| post_wrong_orient | persona de frente en el paso posterior | No arranca |
| lat_4888 | persona de perfil en el paso anterior | No arranca |
| nobody | camino vacío | No arranca |
| post_feet_cut | de espaldas con los pies cortados | No arranca (el encuadre exige los pies enteros) |
| ant_far | persona a 15-30 m | No arranca: límite conocido del modelo (no hay zoom antes de grabar) |
| foto_manual | solo piernas y pies | Botón «Hacer la foto», puntos de pose no creíbles → marcado a mano con 6 toques → Helbing y Perthes guardados con `manual: true` |

Los umbrales de orientación de `evalChecks` salieron de las trazas de estos clips (caderas,
hombros y diferencia de profundidad entre lados respecto a la longitud de la pierna); si se
cambian, hay que volver a pasar la batería.
