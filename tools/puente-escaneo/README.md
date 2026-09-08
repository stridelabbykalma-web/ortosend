# Puente de escaneo Ortosend (RevoScan)

Programa pequeño que se instala en el PC del escáner. Vigila la carpeta donde
RevoScan exporta los mesh y sube cada escaneo nuevo al **almacén común de
Ortosend** (Cloudflare R2), sin límite de tamaño. El escaneo queda asociado
solo al paciente y el taller lo descarga desde el expediente del caso.

No hay carpetas por paciente ni nombres que respetar: RevoScan exporta el mesh
con el nombre que quiera (pierde el del proyecto) y da igual.

## Cómo sabe de qué paciente es

El profesional tiene abierto en la app el caso del paciente, en el paso
«Escaneo de las espumas». Ese caso está *esperando escaneo*; el archivo que
llega en ese momento es suyo. Si en la clínica hay dos casos abiertos en ese
paso a la vez —o el escaneo llegó sin nadie esperando—, se queda en la bandeja
y la app pregunta «¿este escaneo es de Pere Vidal?»: se confirma con un toque.

## Instalación

Requisitos: **Node 18 o superior** en el PC del escáner.

1. Copia esta carpeta al PC (por ejemplo `C:\Ortosend\puente-escaneo`).
2. `copy puente.config.example.json puente.config.json` y rellénalo:

```json
{
  "servidor": "https://app.ortosend.com",
  "token": "<token del panel · Panel → Puente de escaneo>",
  "carpeta": "C:\\Ortosend\\Escaneos"
}
```

El token se saca en **Panel de clínica → Puente de escaneo** (solo administrador
de clínica), donde también se revoca si se pierde el equipo. También se pueden
usar las variables de entorno `ORTOSEND_URL`, `ORTOSEND_TOKEN` y `ORTOSEND_CARPETA`.

3. Arranca con `node puente.js` o con el acceso directo `iniciar-puente.bat`.
   Déjalo abierto mientras se usa el escáner (para que arranque solo con el
   equipo: Programador de tareas de Windows → al iniciar sesión → `iniciar-puente.bat`).

## Configurar RevoScan

Al exportar el mesh (`.stl`, `.ply`, `.obj`…), guárdalo en la carpeta que
vigila el puente. Si RevoScan ya tiene una carpeta de exportación fija, apunta
`carpeta` a esa misma ruta. El puente mira también las subcarpetas.

## Qué pasa si algo falla

- **Archivo a medias**: no se sube hasta que el tamaño deja de crecer.
- **Sin red o servidor caído**: se reintenta en cada vuelta (cada 5 s).
- **Formato no admitido**: se descarta y queda en el log.
- **Token revocado**: el servidor lo rechaza; se genera otro en el panel.
- Lo ya subido se anota en `puente-estado.json` para no repetirlo al reiniciar.
  Un escaneo repetido (mismo nombre, otro contenido) se sube como un escaneo
  más del caso; el taller ve todos y elige.

## Privacidad (RGPD)

El puente solo sube archivos de escaneo y solo a la clínica de su token. El
token identifica al equipo, no a una persona, y se revoca desde el panel. El
archivo va directo al almacén con una URL firmada de un solo uso; la descarga
desde el expediente exige sesión y queda en el registro de accesos.
