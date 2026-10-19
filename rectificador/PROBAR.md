# Cómo probar el rectificador en el PC del taller (Windows)

## 1. Instalar Python (solo una vez)

1. Entra en https://www.python.org/downloads/ y descarga **Python 3.13** (también valen 3.11 y 3.12;
   la versión más nueva puede no funcionar todavía con el visor 3D).
2. Al instalar, **marca la casilla «Add Python to PATH»** (abajo del todo en la primera pantalla).
3. Pulsa *Install Now* y espera a que termine.

## 2. Abrir el programa

1. Descomprime el ZIP del rectificador en una carpeta (por ejemplo en el Escritorio).
2. Entra en la carpeta `rectificador` y haz **doble clic en `arrancar.bat`**.
   - La primera vez tarda unos minutos: descarga lo que necesita (hace falta internet).
     No cierres la ventana negra.
   - Las siguientes veces se abre en segundos.
   - Si Windows avisa de que «protegió su PC», pulsa *Más información* → *Ejecutar de todas formas*.

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
2. Comprueba que cada pie tiene bien su nombre (**PIE IZQUIERDO / PIE DERECHO**).
   Si está al revés, pulsa **Intercambiar izquierdo ↔ derecho**.
3. En cada pie pulsa **Proponer referencias**: aparecen las 5 cabezas metatarsales y el talón.
   Si alguna no está donde la pondrías, **cógela con el botón izquierdo y arrástrala** al sitio correcto
   (el cursor se convierte en una mano al pasar por encima del punto).
4. Mira el **recorte en arco** (línea roja): por delante ya no hay molde.
   Prueba a cambiar **Adelanto** y **Curvatura**.
5. Mira el **lijado**: cambia el tamaño del taco y marca «Ver el escaneo sin lijar» para comparar.
6. **Comprueba la escala**: el panel de cada pie muestra sus medidas en mm (largo, anchos, distancias
   entre referencias) y alrededor del molde hay reglas en mm. Con **Medir distancia (M)** y dos clics
   derechos mides lo que quieras (por ejemplo, del talón a la punta) y lo comparas con una cinta
   métrica sobre la espuma. Abajo a la derecha ves las coordenadas del punto bajo el ratón.
7. *Archivo → Exportar…* y guarda. Salen 3 archivos:
   `NOMBRE.stl`, `NOMBRE_FUSION.stl` y `NOMBRE_receta.json`.
8. Abre `NOMBRE_FUSION.stl` en Fusion 360 **sin cambiar unidades** y comprueba que mide lo que dice el
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

## Si algo falla

Manda una **foto o captura** de la ventana (si falla al instalar, la ventana negra enseña las
últimas líneas del registro). El registro completo está en
`%LOCALAPPDATA%\RectificadorOrtosend\instalacion.log` (pega esa ruta en la barra del Explorador).

Lo que el programa instala va a `%LOCALAPPDATA%\RectificadorOrtosend` (fuera del Escritorio y de
OneDrive). Para reinstalar desde cero, borra esa carpeta y vuelve a abrir `arrancar.bat`.
