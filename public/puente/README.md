# Puente de escaneo Ortosend (Revo Scan)

Programa pequeño que se instala en el PC del escáner. Vigila dónde deja Revo
Scan cada escaneo y lo sube entero al **almacén común de Ortosend** (Cloudflare
R2), sin límite de tamaño. El escaneo queda asociado al paciente y el taller lo
descarga desde el expediente del caso, lo abre en su Revo Scan, lo procesa
(«Edición con un clic») y exporta el STL.

**El profesional solo escanea y pulsa Parar.** No fusiona, no malla, no
exporta, no crea carpetas ni pone nombres.

## Cómo sabe de qué paciente es

Por este orden, y solo cuando no hay duda:

1. **El nombre del proyecto en Revo Scan** lleva el número de un caso abierto
   (p. ej. «Pere Vidal 123» o «#123»).
2. **El nombre del proyecto es el nombre de un paciente** con estudio abierto en
   la clínica. Por eso lo natural es ponerle al proyecto el nombre del paciente
   al crearlo en Revo Scan: se asocia aunque nadie tenga el caso abierto.
3. Lo que sigue:

Revo Scan no sabe nada de Ortosend; la asociación la hace el servidor. El
profesional tiene abierto en la app el caso del paciente, en el paso «Escaneo
de las espumas»: ese caso está *esperando escaneo* y el archivo que llega en
ese momento es suyo. Si en la clínica hay dos casos abiertos en ese paso a la
vez —o el escaneo llegó sin nadie esperando (PC apagado, subida tardía)—, se
queda en la bandeja y la app pregunta «¿este escaneo es de Pere Vidal?»: se
confirma con un toque. Nunca se asigna a ciegas.

## Qué vigila

- `carpetaRevoScan` — la carpeta donde Revo Scan guarda los escaneos. No
  depende de cómo la organice cada versión: en el primer nivel, **cualquier
  carpeta nueva** es un escaneo (se empaqueta en ZIP con el nombre del
  proyecto leído de su índice `.revo`) y **cualquier archivo nuevo** de más de
  200 KB también (Revo Scan 6: «un escaneo, un archivo»). Si la carpeta
  vigilada contiene a su vez una `Projects`, se baja a ella. Por defecto,
  `C:\Users\<usuario>\AppData\Roaming\RevoScan5\Projects`; en Revo Scan,
  Preferencias → ruta de proyectos. Al arrancar, la ventana lista lo que hay.
  - Un escaneo se sube cuando lleva 45 s sin cambiar nada (Revo Scan ha
    terminado de escribir). Si después cambia (se fusiona, se malla), se sube
    otra vez como versión nueva; el taller ve todas.
- `carpeta` (opcional) — carpeta de mesh exportados a mano (`.stl`, `.obj`,
  `.ply`…), por si el profesional prefiere exportar. Van comprimidos con gzip.

## Instalación (Windows, un clic)

1. En Ortosend, como administrador de clínica: **Panel → Puente de escaneo → Dar de alta un
   puente → Descargar instalador**. El archivo `.bat` ya lleva el servidor y el token.
2. En el PC del escáner: doble clic. Si Windows avisa («Windows protegió su PC»), *Más
   información → Ejecutar de todas formas*. El instalador (`instalar.ps1`):
   - instala Node LTS si no está (winget o MSI oficial);
   - copia `puente.js`, `zip.js` e `iniciar-puente.bat` a `C:\Ortosend\puente-escaneo`;
   - detecta la carpeta de escaneos de Revo Scan (`%APPDATA%\RevoScan5\Projects` o similar)
     y escribe `puente.config.json`;
   - crea un acceso directo en la carpeta Inicio (arranca solo al iniciar sesión) y lo arranca.
3. La ventana del puente debe decir `modo directo al almacén (sin límite de tamaño)`.

## Instalación manual (Mac, o si el instalador no puede usarse)

Requisitos: **Node 18 o superior**.

1. Descarga de la propia web `/puente/puente.js`, `/puente/zip.js` y
   `/puente/puente.config.example.json` a una carpeta (por ejemplo `C:\Ortosend\puente-escaneo`).
2. Copia el ejemplo a `puente.config.json` y rellénalo:

```json
{
  "servidor": "https://app.ortosend.com",
  "token": "<token del panel · Panel → Puente de escaneo>",
  "carpetaRevoScan": "C:\\Users\\USUARIO\\AppData\\Roaming\\RevoScan5\\Projects",
  "carpeta": "C:\\Ortosend\\Escaneos"
}
```

También valen las variables de entorno `ORTOSEND_URL`, `ORTOSEND_TOKEN`,
`ORTOSEND_CARPETA_REVOSCAN` y `ORTOSEND_CARPETA`.

3. Arranca con `node puente.js` (o `iniciar-puente.bat`, que lo reinicia si se cierra) y déjalo
   abierto mientras se use el escáner.

## En el taller

1. Revo Scan (gratis) instalado en el PC del taller.
2. En el expediente del caso: **Descargar proyecto Revo Scan**. Si es un ZIP
   (Revo Scan 5), descomprimirlo en la carpeta de proyectos y abrirlo con
   *Archivo → Abrir proyecto*; si es un archivo de Revo Scan 6, abrirlo.
3. «Edición con un clic» → Exportar STL → diseñar.

## Qué pasa si algo falla

- **Escaneo a medias**: no se sube hasta que lleva 45 s sin cambios.
- **Sin red o servidor caído**: se reintenta en cada vuelta (cada 5 s); nada se pierde.
- **PC apagado al escanear**: se sube al encenderlo; irá a la bandeja y se
  confirma con un toque.
- **Token revocado**: el servidor lo rechaza; se genera otro en el panel.
- Lo ya subido se anota en `puente-estado.json` (por ruta, tamaño y fecha)
  para no repetirlo al reiniciar.
- **Primera vez**: solo sube lo escaneado en las últimas 24 h; los escaneos
  anteriores a la instalación se dan por vistos (para subir uno antiguo,
  hazlo a mano desde el asistente del caso).

## Privacidad (RGPD)

El puente solo sube archivos de escaneo y solo a la clínica de su token. El
token identifica al equipo, no a una persona, y se revoca desde el panel. El
archivo va directo al almacén con una URL firmada de un solo uso; la descarga
desde el expediente exige sesión y queda en el registro de accesos.
