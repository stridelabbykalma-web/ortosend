# Novedades de Ortosend Taller

## 0.8.1
- **El contorno, al final** (como en vuestro Fusion): cada pie se fresa ahora en el orden desbaste →
  acabado → contorno, así la escayola trabaja entera y firme casi todo el tiempo. El contorno sigue sin
  atravesar la plancha (deja 7,5 mm debajo): el molde queda unido a la plancha hasta que lo separas.
- Como alrededor del pie todavía hay escayola entera, al entrar junto al borde la fresa ya no baja en
  rápido: solo hasta 1 mm sobre la plancha y de ahí despacio.

## 0.8.0
- **Ajustes de la CNC desde el programa**: en *Archivo → Ajustes de la CNC* (o con el botón de la ventana
  Tirada de CNC) se cambian las revoluciones, las velocidades (desbaste, entrada, bajada, acabado) y las
  pasadas (bajada por capa, separación de líneas, sobrante, altura de seguridad), sin tocar archivos.
- Lo que está cambiado sale en naranja (al pasar el ratón se ve el valor de fábrica). Debajo dice qué
  escalones deja la fresa con esa separación de líneas, y avisa si algo puede romper la escayola.
- **Se conservan al actualizar** el programa. «Volver a los de fábrica» deja los del ejemplo de Fusion.
- El archivo .nc lo indica cuando se ha fresado con ajustes cambiados.

## 0.7.0
- **Cada persona del taller con su móvil**: entra en la web de Ortosend (**/taller**) con su usuario y ve los
  mismos post-its. Lo que hace cada uno se ve al momento en todos (aquí se actualiza cada 30 s).
- **Trazabilidad de materiales (lotes)**: en el móvil, «📷 Escanear material» → foto de la etiqueta de la
  plancha → se lee el código de barras (lote y caducidad) → se elige el material y el pie → queda en esa
  plantilla con la foto, quién y cuándo. La misma plancha se reconoce sola la siguiente vez. Un registro
  equivocado no se borra: se anula con el motivo.
- Aquí, en la hoja de cada pedido, salen los **materiales usados** con su lote, y van en la hoja impresa.
- **Confección terminada** ya no pide el material a mano: van los lotes registrados (y sin ellos no se
  puede terminar).
- Las personas del taller las da de alta el administrador en la web (Personal del taller).

## 0.6.0
- **Ahora se llama Ortosend Taller** y tiene **dos apartados**, arriba: **Fresado** (rectificar el molde,
  tirada y CNC, lo de siempre) y **Confección**. El acceso directo pasa a llamarse «Ortosend Taller».
- **Confección con post-its**: los pedidos salen como notas en un tablero por columnas (Por diseñar ·
  Por fresar · En confección · Calidad), cada columna con el que debe salir antes arriba. Rojo = fuera de
  plazo, amarillo = justo, verde = en plazo. Clic en uno y se abre su hoja; con ◀ ▶ (o Re Pág / Av Pág)
  pasas al anterior o al siguiente.
- **Sin costes ni precios** en el taller (los verá el administrador cuando se haga esa parte).
- **Aviso de la CNC**: en la tirada, al arrancar la máquina pulsa **▶ Inicio**. Arriba ves cuánto le
  queda y, cuando acaba (según el tiempo estimado), sale un aviso en Confección con un botón para pasar sus
  pedidos a confección. Si cierras el programa, el aviso sale igual al volver a abrirlo.
- **Pedido nº** en cada molde: se lee solo del nombre del escaneo («… caso 123»); si no, escríbelo. Sale
  delante del nombre de cada pie en la tirada, el mapa y el .nc.

## 0.5.0
- **Nuevo apartado «Confección»** (botón *Confección* arriba): los pedidos del taller de la web de
  Ortosend, **ordenados por cuál debe salir antes** (primero los que hay que rehacer y los fuera de plazo),
  con su semáforo de plazo, lote y clínica. Se entra una vez con el **usuario de taller** de la web.
- **Hoja de confección** de cada par: pauta del prescriptor por pie (I/D), proceso (termoformado al vacío o
  capas pegadas y prensadas), capas de material, minutos de CNC y de confección, notas. Se guarda en la
  web y se **imprime**.
- **Coste del par** al momento: material + fresado + mano de obra. Los **materiales** (precio de la
  plancha y pares que salen) y los **costes** del taller se editan desde aquí.
- **Molde fresado → confección** y **Confección terminada → calidad** cambian el estado en la web.
- Necesita la actualización de la web (si aún no está publicada, el programa lo avisa).

## 0.4.6
- El molde se corta **15 mm por delante de las cabezas metatarsales** (antes 3 mm), siguiendo su curva.
  Se puede cambiar en cada pie con «Adelanto». Los trabajos guardados se abren con el corte que tenían.

## 0.4.5
- Las actualizaciones se descargan de la versión exacta recién publicada: llegan al momento y sin
  mezclar archivos de dos versiones.

## 0.4.4
- *Ayuda → Buscar actualizaciones* ya no se queda «pensando» (el cursor de espera no se quitaba).
- Siempre ve la última versión publicada al momento (antes podía tardar unos minutos en enterarse).

## 0.4.3
- **Las correcciones se ven en color** sobre el molde: azul donde se quita escayola (bulto en la plantilla)
  y rojo donde se añade (hueco en la plantilla); más intenso = más mm. Se quita en *Ver → Correcciones en
  color* o con la casilla del apartado Molde.
- **Los nombres de las referencias ya no tapan el molde**: solo salen mientras se marcan. Para verlos
  siempre: *Ver → Nombres de las referencias* (tecla N).

## 0.4.2
- Los escaneos se exportan a tu carpeta **OneDrive › Escaneos** (si no hay OneDrive, a Documentos ›
  Escaneos Rectificador). Se puede cambiar en *Archivo → Carpeta de escaneos…*.

## 0.4.1
- **Botón «Escanear»**: abre Revo Scan. Escanea, exporta el STL (o PLY) en la carpeta
  *Documentos › Escaneos Rectificador* (la ruta se copia sola: pégala con Ctrl+V al guardar) y el
  Rectificador lo abre solo en cuanto termina de guardarse. La primera vez, si no encuentra Revo Scan, te
  pregunta dónde está.

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
