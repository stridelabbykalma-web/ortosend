# Novedades del Rectificador de moldes

## 0.3.2
- **Las correcciones se adaptan a la medida del pie**: el largo y el ancho del relleno de arco, la oliva,
  la barra, la descarga y el skive se escalan según lo que mide el pie del talón a las cabezas (los valores
  de siempre son para un pie medio, ≈ talla 40). La **altura no cambia**: es la que tú pongas.
- En «···» de cada corrección se ven los mm para ese pie y la casilla «Adaptar a la medida del pie»
  (quítala para usar mm fijos).
- Los trabajos guardados antes se abren igual que estaban.

## 0.3.1
- El molde puede medir hasta **40 mm** de alto (antes 38).
- Si con las correcciones pasa de 40 mm, lo que sobra se quita **por abajo** (de la base), nunca de la planta:
  las correcciones salen enteras. Lo mismo en la CNC si un pie no cabe en la plancha. El programa avisa
  de cuántos mm se quitan.

## 0.3.0
- **Se actualiza solo**: al abrir el programa, si hay una versión nueva, te pregunta. Con «Actualizar ahora»
  la descarga, la instala y se vuelve a abrir. Si algo fallara, sigue la versión que tenías.
- Nuevo *Ayuda → Novedades* para ver qué ha cambiado.

## 0.2.0
- **Correcciones clínicas** en cada pie: relleno de arco (rebajar o subir), oliva retrocapital, barra
  metatarsal, descarga del 1.er MTT y skive medial. Se colocan solas y se mueven arrastrando su cuadradito.
- **Guardar el trabajo** de cada paciente (.molde) con nombre, fecha y notas; se reabre al momento.
- **Seguridad CNC**: prueba en vacío, ver dónde no llega la fresa de Ø25 y margen en los bordes de la plancha.
- **Instalador** con icono en el Escritorio, sin ventana negra; los .molde se abren con doble clic.
- Deshacer y rehacer (Ctrl+Z / Ctrl+Y), pantalla de inicio con recientes, menús nuevos y tema oscuro.
- Más rápido al mover puntos y cambiar el recorte.

## 0.1.0
- Primera versión: limpieza del escaneo, lijado, referencias, recorte en arco, exportar y tirada de CNC.
