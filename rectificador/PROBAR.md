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

1. *Archivo → Abrir escaneo…* y elige el STL tal cual sale del Revopoint (por ejemplo `adroguer.stl`).
   Tarda unos 15 segundos en limpiarlo.
2. Comprueba que cada pie tiene bien su nombre (**PIE IZQUIERDO / PIE DERECHO**).
   Si está al revés, pulsa **Intercambiar izquierdo ↔ derecho**.
3. En cada pie pulsa **Proponer referencias**: aparecen las 5 cabezas metatarsales y el talón.
   Si alguna no está donde la pondrías, pulsa su botón **Marcar** y haz **clic derecho** en el sitio correcto.
4. Mira el **recorte en arco** (línea roja): por delante ya no hay molde.
   Prueba a cambiar **Adelanto** y **Curvatura**.
5. Mira el **lijado**: cambia el tamaño del taco y marca «Ver el escaneo sin lijar» para comparar.
6. *Archivo → Exportar…* y guarda. Salen 3 archivos:
   `NOMBRE.stl`, `NOMBRE_FUSION.stl` y `NOMBRE_receta.json`.
7. Abre `NOMBRE_FUSION.stl` en Fusion 360 **sin cambiar unidades** y comprueba que mide lo que debe.

Ratón en el visor: girar = arrastrar con el botón izquierdo · desplazar = Mayús + arrastrar · zoom = rueda.

## Si algo falla

Manda una **foto o captura** de la ventana (si falla al instalar, la ventana negra enseña las
últimas líneas del registro). El registro completo está en
`%LOCALAPPDATA%\RectificadorOrtosend\instalacion.log` (pega esa ruta en la barra del Explorador).

Lo que el programa instala va a `%LOCALAPPDATA%\RectificadorOrtosend` (fuera del Escritorio y de
OneDrive). Para reinstalar desde cero, borra esa carpeta y vuelve a abrir `arrancar.bat`.
