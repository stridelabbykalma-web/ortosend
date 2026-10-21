# Cómo probar el rectificador en el PC del taller (Windows)

## 1. Instalar Python (solo una vez)

1. Entra en https://www.python.org/downloads/ y descarga **Python 3.13** (también valen 3.11 y 3.12;
   la versión más nueva puede no funcionar todavía con el visor 3D).
2. Al instalar, **marca la casilla «Add Python to PATH»** (abajo del todo en la primera pantalla).
3. Pulsa *Install Now* y espera a que termine.

## 2. Instalar el programa

1. Descomprime el ZIP del rectificador en una carpeta cualquiera.
2. Entra en la carpeta `rectificador` y haz **doble clic en `instalar.bat`**.
   - La primera vez tarda unos minutos: descarga lo que necesita (hace falta internet).
   - Si Windows avisa de que «protegió su PC», pulsa *Más información* → *Ejecutar de todas formas*.
3. Al terminar aparece el icono **Rectificador Ortosend** en el **Escritorio** y en el **menú Inicio**:
   ábrelo siempre desde ahí (se abre **sin la ventana negra**). Ya puedes borrar la carpeta descomprimida.
   Los trabajos guardados (`.molde`) se abren con **doble clic**.
- **Actualizar**: es automático. Al abrir el programa, si hay una versión nueva sale el aviso
  **«Hay una versión nueva»** con lo que cambia. Pulsa **Actualizar ahora**: se descarga, el programa se cierra
  y se vuelve a abrir ya actualizado (unos segundos; si cambia algo de Python, un par de minutos).
  Si algo fallara, se queda la versión de antes y te avisa. **Más tarde** = no vuelve a preguntar hasta mañana.
  También en *Ayuda → Buscar actualizaciones…* y *Ayuda → Novedades*. Tus trabajos no se tocan.
  (Solo funciona si lo instalaste con `instalar.bat`; si no, te ofrece descargar el ZIP.)
- **Desinstalar**: `desinstalar.bat` (no borra tus trabajos, escaneos ni archivos `.nc`).
- `arrancar.bat` sigue funcionando como antes (con ventana negra), por si acaso.

## 3. Probar con un escaneo

1. Elige arriba el **tipo de escaneo**:
   - **Huellas en espuma**: la huella del pie hundida en los bloques de espuma (lo normal).
   - **Molde ya hecho**: el escaneo de un molde que ya existe, con el pie en bulto sobre una base.
   En los dos puede haber 1 o 2 pies. El programa recuerda el último tipo usado; si eliges el que no
   es, te avisa y te sugiere el otro.
   Después, *Archivo → Abrir escaneo…* y elige el escaneo. Vale cualquiera de estos:
   - **el proyecto de Revo Scan directamente**: el archivo `.revox` que hay dentro de la carpeta del
     proyecto (no hace falta exportar a STL; la carpeta debe tener su subcarpeta `meshs`);
   - un `.stl`, `.ply` u `.obj` exportado;
   - un ZIP con cualquiera de ellos (no hace falta descomprimirlo).
   Tarda unos 15 segundos en limpiarlo.
   **Escanear directamente**: botón **Escanear** (arriba o en la pantalla de inicio). Se abre Revo Scan;
   escanea y exporta el STL en *OneDrive › Escaneos* (la ruta ya está copiada: Ctrl+V en la ventana de
   guardar; para otra carpeta, *Archivo → Carpeta de escaneos…*). En cuanto se guarda, el Rectificador pregunta si abrirlo.
2. Comprueba que cada pie tiene bien su nombre (**PIE IZQUIERDO / PIE DERECHO**).
   Si está al revés, pulsa **Intercambiar izquierdo ↔ derecho**.
3. En cada pie pulsa **Proponer referencias**: aparecen las 5 cabezas metatarsales y el talón.
   Si alguna no está donde la pondrías, **cógela con el botón izquierdo y arrástrala** al sitio correcto
   (el cursor se convierte en una mano al pasar por encima del punto).
4. Mira el **recorte en arco** (línea roja): por delante ya no hay molde.
   Prueba a cambiar **Adelanto** y **Curvatura**.
5. **Correcciones** (en la tarjeta de cada pie, con las referencias puestas): pulsa **«＋ Añadir corrección»**
   y elige: antepié (oliva, barra metatarsal, descargas del 1.º y 5.º MTT y de sesamoideos, cuña anterior),
   mediopié (relleno de arco, soporte navicular y cuboides, canal de fascia plantar) o retropié (skive de
   Kirby en varo o valgo, cuña posterior, alza, expansión de talón, descarga del espolón). Cambia la altura
   (mm, ° en las cuñas, % en la expansión) y, con «···», el tamaño. Cada una se coloca sola según las
   referencias; para moverla, **arrastra su cuadradito** en el 3D. Las alturas son las de la **plantilla**
   (el programa las invierte en el molde). El tamaño **se adapta a la medida del pie**.
6. Mira el **lijado**: cambia el tamaño del taco y marca «Ver el escaneo sin lijar» para comparar.
   Marca **«Ver dónde no llega la fresa»** para ver en rojo la escayola que la bola de Ø25 no podrá quitar
   (huecos más estrechos que la fresa); abajo te dice cuánto en la planta y cuánto en el borde.
7. **Comprueba la escala**: el panel de cada pie muestra sus medidas en mm (largo, anchos, distancias
   entre referencias) y alrededor del molde hay reglas en mm. Con **Medir distancia (M)** y dos clics
   derechos mides lo que quieras (por ejemplo, del talón a la punta) y lo comparas con una cinta
   métrica sobre la espuma. Abajo a la derecha ves las coordenadas del punto bajo el ratón.
8. **Guarda el trabajo** (Ctrl+S): rellena antes la tarjeta **Paciente** (nombre, fecha, notas). Se guarda un
   archivo `.molde` que se vuelve a abrir al momento, tal cual lo dejaste.
9. *Archivo → Exportar…* y guarda. Salen 3 archivos:
   `NOMBRE.stl`, `NOMBRE_FUSION.stl` y `NOMBRE_receta.json`.
10. Abre `NOMBRE_FUSION.stl` en Fusion 360 **sin cambiar unidades** y comprueba que mide lo que dice el
   mensaje al exportar (el recuadro debe ser 28,8 × 33,0 cm = 288 × 330 mm).

## 4. Fresar en la CNC (sin Fusion)

1. Con un molde listo: *Archivo → Añadir este molde a la tirada de CNC* (Ctrl+T). Repite con más moldes
   (también puedes añadir moldes ya exportados con «Añadir moldes exportados (STL)…» en la ventana de la tirada).
2. En la ventana **Tirada de CNC** pon la medida de la plancha de escayola (por defecto 600 × 500 × 40 mm).
   **Al momento** ves la plancha desde arriba con cada molde colocado: su relieve, su número (el orden en
   que se fresará), su nombre, su pie y una flecha hacia los dedos. Alrededor de cada pie, en gris, el sitio
   que necesita la fresa. En la lista de la izquierda cada molde lleva el mismo número.
   **Para colocarlos a tu gusto:**
   - **Arrastra el pie** con el botón izquierdo: se mueve con el ratón y su borde se pone **verde** si cabe
     ahí o **rojo** si no (se sale de la plancha o la fresa tocaría a otro pie). Abajo ves su posición en mm.
     Si lo sueltas en rojo, vuelve a su sitio.
   - **Doble clic** sobre un pie lo **gira** un cuarto de vuelta (dos veces = dedos hacia el otro lado).
   - **Clic derecho** sobre un pie: girar 90°, girar 180°, volver a colocación automática o quitarlo.
   - Con un pie elegido, las **flechas del teclado** lo mueven 1 mm (con Mayúsculas, 10 mm); **R** lo gira.
   - **Rueda del ratón** = zoom; **doble clic en vacío** = ver la plancha entera.
   Los demás pies **no se mueven** cuando colocas uno. Los moldes nuevos que añadas van a los huecos libres.
   **Colocar todo automático** vuelve a colocarlos todos lo más juntos posible.
   **Ver mapa para imprimir** abre el mapa en PDF de la colocación que ves.
3. Si la colocación te parece bien, pulsa **Calcular trayectorias**: genera el recorrido de la fresa con
   esa misma colocación y numeración y dice el tiempo de cada fase.
4. **Guardar archivo para la CNC (.nc)…**: copia el `.nc` al USB/tarjeta y lánzalo desde la pantalla de la CNC.
   Se guarda también **`NOMBRE_PRUEBA_EN_VACIO.nc`**: el mismo programa por encima de la plancha (nunca baja
   de 5 mm sobre ella) y con el cabezal apagado. **Lánzalo primero** con una plancha nueva para comprobar
   el origen y los recorridos sin cortar nada.
   Si sujetas la plancha con topes o mordazas, pon el **Margen bordes** en la tarjeta de la plancha.
   Junto al `.nc` se guardan:
   - **`NOMBRE_mapa.pdf`** (se abre solo, para imprimirlo) y `NOMBRE_mapa.png`: el **mapa de la plancha**
     visto desde arriba, con cada molde numerado en el orden en que se fresa, su nombre y pie, una flecha
     hacia los dedos, el origen y una tabla con la posición de cada uno en mm. El número es el mismo que
     «Pieza N» dentro del `.nc`. Es el mismo mapa que se ve en la ventana.
   - `NOMBRE.txt`: la hoja de trabajo con lo mismo en texto.
5. **Fresa**: la de **bola de Ø25 mm** (la misma del ejemplo de Fusion).
6. **Origen**: X0 Y0 en la **esquina delantera izquierda** de la plancha y Z0 en su **cara de arriba**
   (igual que en Fusion). Antes de empezar la fresa sube a Z15.
7. Lo que hace con cada pie, en este orden (como Fusion):
   **contorno** (rodea la silueta bajando en espiral 3 mm por vuelta), **desbaste** en capas de 5 mm y
   **acabado** en líneas paralelas a X cada 1,75 mm.
8. **Primera vez: prueba con cuidado** con un solo pie: vigila la primera vuelta del contorno y la primera
   capa del desbaste. Los avances son los del ejemplo de Fusion (`config/taller.toml`, sección `[cnc]`).

Ratón en el visor: girar = arrastrar con el botón izquierdo · desplazar = Mayús + arrastrar · zoom = rueda.

**Trucos**: **Ctrl+Z** deshace el último cambio (puntos, recorte, lijado, intercambiar pies) y **Ctrl+Y** lo
rehace · puedes **arrastrar el escaneo** desde una carpeta y soltarlo en la ventana · en la pantalla de inicio
y en *Archivo → Abrir reciente* están los últimos escaneos · **F1** abre la guía rápida y *Ayuda → Atajos*
la lista de atajos · el programa recuerda el tamaño de la ventana y la última carpeta usada.

## 5. Confección (pedidos de la web)

Arriba hay dos apartados: **Fresado** (todo lo anterior) y **Confección**.

1. En **Confección** pulsa **Entrar** con tu usuario de **taller** de la web de Ortosend (el mismo de
   /equipo). Solo la primera vez: el programa se queda conectado («Desconectar» para salir).
2. Los pedidos salen como **post-its** en columnas: Por diseñar · Por fresar · En confección · Calidad. En
   cada columna, arriba el que debe salir antes (rojo = fuera de plazo, amarillo = justo, verde = en plazo;
   «⚠ REHACER» primero).
3. **Clic en un post-it**: a la derecha su hoja con la **pauta de cada pie** (I/D). Elige el **proceso**
   (termoformado o capas), añade las **capas de material**, los minutos y notas; **Guardar hoja** la guarda
   en la web e **Imprimir hoja…** la imprime. Con **◀ ▶** (o Re Pág / Av Pág) pasas al anterior/siguiente.
4. **Molde fresado → a confección** y **Confección terminada → a calidad** cambian el pedido en la web.
5. **Materiales…**: la lista de materiales (sin precios).

### Aviso de la CNC
1. En Fresado, cada molde lleva su **Pedido nº** (se lee del nombre del escaneo «… caso 123»; si no, escríbelo
   en la tarjeta del paciente).
2. En la **Tirada CNC**, después de calcular y guardar el .nc, cuando arranques la máquina pulsa
   **▶ Inicio: la CNC empieza**.
3. Arriba a la derecha verás «CNC: quedan X min». Cuando acaba sale un **aviso azul en Confección** con
   **«Pasar sus pedidos a confección»** (los pasa todos de golpe) y **Hecho** (quita el aviso).

## Si algo falla

Manda una **foto o captura** de la ventana (si falla al instalar, la ventana negra enseña las
últimas líneas del registro). El registro completo está en
`%LOCALAPPDATA%\RectificadorOrtosend\instalacion.log` (pega esa ruta en la barra del Explorador).

Lo que el programa instala va a `%LOCALAPPDATA%\RectificadorOrtosend` (fuera del Escritorio y de
OneDrive). Para reinstalar desde cero, borra esa carpeta y vuelve a abrir `arrancar.bat`.
