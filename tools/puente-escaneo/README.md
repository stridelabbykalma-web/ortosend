# Puente de escaneo Ortosend (RevoScan)

Programa pequeño que se instala en el PC del escáner. Vigila una carpeta, sube a
Ortosend los escaneos que aparecen dentro y cada uno queda **asociado solo al
paciente** del caso: el profesional no renombra ni sube nada.

## Cómo funciona

1. Ortosend da a cada caso una carpeta con su código: `ORT-00123-4K7Q2M9X-juan-perez`.
2. El puente crea esas carpetas dentro de la carpeta base (por ejemplo
   `C:\Ortosend\Escaneos`) y las mantiene al día con los casos abiertos de la clínica.
3. En RevoScan, al **Guardar / Exportar** el escaneo, se elige esa carpeta. El
   asistente de captura enseña el nombre exacto y tiene botón de copiar.
4. El puente detecta el archivo nuevo (`.stl`, `.obj`, `.ply`, `.glb`, `.gltf`,
   `.3mf`, `.asc`, `.zip`), espera a que RevoScan termine de escribirlo y lo sube.
5. El servidor lee el código de la ruta, lo asocia al caso y el check del
   escaneo se pone en verde en la pantalla del profesional, sin recargar.

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

RevoScan pregunta la ubicación al guardar o exportar el modelo. Basta con
navegar a la carpeta base y elegir la carpeta del caso que indica la app. Si
RevoScan está configurado con una carpeta de proyectos fija, se puede apuntar
`carpeta` del puente a esa misma ruta: el puente solo mira las subcarpetas que
llevan código de Ortosend e ignora todo lo demás.

## Qué pasa si algo falla

- **Archivo a medias**: no se sube hasta que el tamaño deja de crecer.
- **Sin red o servidor caído**: se reintenta en cada vuelta (cada 5 s).
- **Carpeta sin código de caso**: se ignora, no se sube nada.
- **Estudio ya enviado o token revocado**: el servidor lo rechaza y queda en el log.
- Lo ya subido se anota en `puente-estado.json` para no repetirlo al reiniciar.
  Si se vuelve a escanear y se guarda otra vez, el nuevo archivo sustituye al
  anterior en el caso.

## Privacidad (RGPD)

El puente solo sube archivos de escaneo de los casos abiertos de su clínica. El
token identifica al equipo, no a una persona, y se revoca desde el panel. Los
nombres de carpeta llevan el nombre del paciente para que el profesional se
oriente; si no se quiere, basta con renombrar la carpeta dejando el trozo
`ORT-00123-XXXXXXXX`, que es lo único que usa la asociación.
