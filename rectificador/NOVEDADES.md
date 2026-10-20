# Novedades del Rectificador de moldes

## 0.4.0
- **Skive como Kirby, en varo o valgo**: se corta en un plano inclinado 15° (ajustable) en la cazoleta del
  talón. La profundidad (2, 4 o 6 mm) es la de la línea a 1/3 del ancho del talón: con 2 mm solo toca ese
  lado; con 6 mm cruza toda la cazoleta. Llega desde atrás hasta el final de la cazoleta.
- **Correcciones nuevas**: cuña anterior y cuña posterior (en grados, varo o valgo), alza de talón,
  expansión de talón (%), canal de fascia plantar, soporte navicular, soporte cuboides y descargas del
  5.º MTT, de sesamoideos y del espolón.
- En cada pie solo se ven las correcciones puestas; las demás se añaden con **«＋ Añadir corrección»**
  (ordenadas por antepié, mediopié y retropié).

## 0.3.4
- **Barra metatarsal nueva**: ahora va bajo **todas las cabezas** (de la 1.ª a la 5.ª), de borde a borde
  del pie, **curvada con la misma forma que el recorte** y por detrás de las cabezas. La altura es la misma
  de lado a lado. Si cambias la curvatura del recorte, la barra la sigue.
- Los trabajos guardados que tenían barra se abren con la barra nueva.

## 0.3.3
- La actualización automática es más segura: descarga los archivos uno a uno (comprobando cada uno) y,
  si no puede, prueba otra vía. Si aun así falla, dice el motivo con palabras claras.

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
