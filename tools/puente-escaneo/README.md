# Puente de escaneo Ortosend (Revo Scan)

Programa pequeño que se instala en el PC del escáner. Vigila dónde deja Revo
Scan cada escaneo y lo sube entero al **almacén común de Ortosend** (Cloudflare
R2), sin límite de tamaño. El escaneo queda asociado al paciente y el taller lo
descarga desde el expediente del caso, lo abre en su Revo Scan, lo procesa
(«Edición con un clic») y exporta el STL.

**El profesional solo escanea y pulsa Parar.** No fusiona, no malla, no
exporta, no crea carpetas ni pone nombres.

## Cómo sabe de qué paciente es

Revo Scan no sabe nada de Ortosend; la asociación la hace el servidor. El
profesional tiene abierto en la app el caso del paciente, en el paso «Escaneo
de las espumas»: ese caso está *esperando escaneo* y el archivo que llega en
ese momento es suyo. Si en la clínica hay dos casos abiertos en ese paso a la
vez —o el escaneo llegó sin nadie esperando (PC apagado, subida tardía)—, se
queda en la bandeja y la app pregunta «¿este escaneo es de Pere Vidal?»: se
confirma con un toque. Nunca se asigna a ciegas.

## Qué vigila

- `carpetaRevoScan` — la carpeta donde Revo Scan guarda los escaneos:
  - **Revo Scan 6** («un escaneo, un archivo»): sube cada archivo de escaneo.
  - **Revo Scan 5**: cada carpeta de proyecto (la que contiene el `.revo`) se
    empaqueta en un ZIP y se sube. Por defecto es
    `C:\Users\<usuario>\AppData\Roaming\RevoScan5\Projects` (Preferencias de
    Revo Scan → ruta de proyectos).
  - Un escaneo se sube cuando lleva 45 s sin cambiar nada (Revo Scan ha
    terminado de escribir). Si después cambia (se fusiona, se malla), se sube
    otra vez como versión nueva; el taller ve todas.
- `carpeta` (opcional) — carpeta de mesh exportados a mano (`.stl`, `.obj`,
  `.ply`…), por si el profesional prefiere exportar. Van comprimidos con gzip.

## Instalación

Requisitos: **Node 18 o superior** en el PC del escáner.

1. Copia esta carpeta al PC (por ejemplo `C:\Ortosend\puente-escaneo`).
2. `copy puente.config.example.json puente.config.json` y rellénalo:

```json
{
  "servidor": "https://app.ortosend.com",
  "token": "<token del panel · Panel → Puente de escaneo>",
  "carpetaRevoScan": "C:\\Users\\USUARIO\\AppData\\Roaming\\RevoScan5\\Projects",
  "carpeta": "C:\\Ortosend\\Escaneos"
}
```

El token se saca en **Panel de clínica → Puente de escaneo** (solo administrador
de clínica), donde también se revoca si se pierde el equipo. También se pueden
usar las variables de entorno `ORTOSEND_URL`, `ORTOSEND_TOKEN`,
`ORTOSEND_CARPETA_REVOSCAN` y `ORTOSEND_CARPETA`.

3. Arranca con `node puente.js` o con el acceso directo `iniciar-puente.bat`.
   Déjalo abierto mientras se usa el escáner (para que arranque solo con el
   equipo: Programador de tareas de Windows → al iniciar sesión → `iniciar-puente.bat`).

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

## Privacidad (RGPD)

El puente solo sube archivos de escaneo y solo a la clínica de su token. El
token identifica al equipo, no a una persona, y se revoca desde el panel. El
archivo va directo al almacén con una URL firmada de un solo uso; la descarga
desde el expediente exige sesión y queda en el registro de accesos.
