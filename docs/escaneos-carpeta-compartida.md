# Escaneo de las espumas: carpeta compartida (flujo normal)

Sin instalar nada de Ortosend en los PCs de las clínicas. El enlace entre el
escaneo y el paciente es **el nombre del proyecto en Revo Scan**, que la app
dicta al profesional, y la carpeta compartida de cada clínica.

## Montaje (una vez por clínica)

1. Ortosend tiene una cuenta de OneDrive **de empresa** (Microsoft 365 Business
   Basic; no una personal: son datos de salud) con una carpeta por clínica,
   `Escaneos - <Clínica>`, compartida con esa clínica con permiso de edición.
2. En el PC del escáner, OneDrive (ya viene con Windows) sincroniza esa carpeta.
3. En Revo Scan 6 → Preferencias → ruta de proyectos = esa carpeta.
4. En el ordenador central del taller, OneDrive sincroniza todas las carpetas.

## Uso

- **Profesional:** en el paso «Escaneo de las espumas» del asistente, la app le
  enseña el nombre exacto que debe ponerle al proyecto (`Nombre Apellido 6XXXXXXXX`:
  nombre del paciente y móvil del titular; si no hay móvil, `Nombre Apellido caso 123`),
  con botón de copiar. Crea el proyecto con ese nombre, escanea, Parar, y marca
  «Escaneo hecho». OneDrive lo sube solo.
- **Taller:** en el expediente del caso pone «Proyecto Revo Scan *«Nombre Apellido
  6XXXXXXXX»* en la carpeta compartida de *Clínica*». Lo abre en su Revo Scan
  desde OneDrive → Edición con un clic → Exportar → diseña.

Revo Scan 6 guarda cada proyecto en una carpeta con nombre aleatorio, pero
dentro el archivo de proyecto se llama exactamente como lo tecleó el
profesional, así que en OneDrive basta con buscar ese nombre.

## Código

- `nombreProyectoRevoScan()` en `src/lib/scan.ts` (una sola definición del nombre).
- Paso del escaneo en `src/components/caso/captura-guiada.tsx` + `copiar-texto.tsx`.
- `markMediaAction` guarda el nombre en `MediaAsset.meta.proyecto` y deja evento.
- Expediente: `Escaneos` en `src/components/caso/expediente.tsx`.

## Más adelante (opcional)

- **Automatizar sin tocar PCs**: leer el OneDrive de Ortosend por la API de
  Microsoft Graph (una app registrada en el Microsoft 365 de Ortosend) para
  poner el check verde y el enlace de descarga solos. Con iCloud no es posible.
