# Rectificador de moldes – Ortosend

Programa de escritorio para rectificar digitalmente los moldes de pie **antes de fresarlos**.
Recibe directamente el escaneo del Revopoint y hace también la limpieza:

```
escaneo Revopoint → [ RECTIFICADOR: limpieza + correcciones ] → Fusion 360 (CAM) → CNC → termoformado
```

Es un programa independiente: no toca ni importa los otros scripts del taller, solo intercambia archivos.

### Dos modos de escaneo

- **Huellas en espuma** (lo normal): la huella del pie hundida en los bloques de espuma.
- **Molde ya hecho**: el escaneo de un molde que ya existe, con el pie en bulto sobre una base plana.

En los dos puede haber 1 o 2 pies. Por consola: `--modo huellas` o `--modo moldes`.

### Limpieza del escaneo (automática)

1. Busca la cara superior plana de **cada bloque por separado** (cada uno puede estar apoyado con una
   inclinación distinta; descarta la mesa y los restos sueltos) y lo endereza.
2. Encaja el rectángulo de cada bloque y lo lleva a los ejes del recuadro (X ancho, Y largo).
   Admite escaneos con uno o con los dos bloques.
3. Quita picos de ruido y rellena los agujeros del escaneo dentro de la huella.
4. Separa las dos huellas y borra todo lo que no es pie.
5. **Vuelca el molde** como si se diera la vuelta al bloque (giro, nunca espejo): el pie izquierdo sigue siendo izquierdo.
   (En modo «Molde ya hecho» no hace falta volcar: el pie ya está en bulto.)
6. Pone los dedos hacia +Y (la parte más ancha del pie, las cabezas metatarsales, queda hacia los dedos), propone cuál es el izquierdo y cuál el derecho (mirando el arco interno) y coloca cada
   pie centrado en su mitad del recuadro, sobre una base plana.

7. **Lijado del molde**: como si se lijara a mano. Quita hoyitos, bultitos, ondulaciones y marcas
   del escáner o de la espuma (todo lo que se notaría en la plantilla). La forma del pie (talón, arco,
   cabezas) y su contorno se conservan: en cada punto se ajusta la superficie curva que mejor encaja con
   su entorno, como un taco de lija que copia la curva. El valor es el tamaño del taco (6 mm por defecto);
   se ajusta en la ventana y se puede comparar con el escaneo sin lijar. Nunca se pierde nada: se aplica
   cada vez sobre el original.

Ajustes en `config/taller.toml`, secciones `[limpieza]` y `[lijado]` (grosor de base, mitad del pie izquierdo, suavizado...).
También acepta un recuadro ya limpio (lo detecta solo).

## Qué recibe y qué devuelve

- **Entrada**: el escaneo en bruto del Revopoint (los dos bloques con la huella hundida, mm), o un recuadro
  ya limpio. Formatos: el proyecto de Revo Scan (`.revox`, se abre su malla de `meshs/`), `.stl`, `.ply`,
  `.obj`, o un `.zip` con cualquiera de ellos.
- **Salida** (en la carpeta que elijas):
  - `NOMBRE.stl` – molde rectificado a escala real (mm), estanco, en el mismo sistema de coordenadas que la entrada.
  - `NOMBRE_FUSION.stl` – la misma malla reducida a menos de 10.000 triángulos y dividida entre 10 (Fusion en cm).
  - `NOMBRE_receta.json` – todo lo que se ha hecho (limpieza, referencias, piezas y sus valores). Con ella se regenera exactamente el mismo resultado.
  - `NOMBRE_limpio.stl` – el molde limpio sin correcciones, para revisar la limpieza.

## Estado

| Hito | Contenido | Estado |
|---|---|---|
| 1 | Leer STL, campo de alturas, exportar los 3 archivos | ✅ hecho (probado con molde sintético) |
| 1b | Limpieza del escaneo en bruto | ✅ hecho (probado con escaneo sintético; falta uno real) |
| 2 | Ventana con visor 3D: pies, izquierdo/derecho, marcar 3 referencias con clic | ✅ hecho (probado con escaneo real) |
| 3 | Recorte en arco por delante de las cabezas metatarsales | ✅ hecho (probado con escaneo real, referencias propuestas) |
| 4 | Correcciones (15): relleno de arco, oliva, barra, descargas (1.º/5.º MTT, sesamoideos, espolón), cuñas anterior/posterior, skive de Kirby varo/valgo, alza, expansión de talón, canal de fascia, soportes navicular/cuboides | ✅ hecho (valores por defecto del podólogo; falta probarlas en un molde real) |
| 5 | Edición interactiva de piezas (arrastrar en 3D), deshacer/rehacer, guardar trabajo (.molde) | ✅ hecho |
| 6 | Comprobación de la fresa (dónde no llega la bola), prueba en vacío | ✅ hecho (falta la 1.ª prueba en la CNC) |
| — | Instalador de Windows con accesos directos y aviso de versiones nuevas | ✅ hecho (falta probarlo en Windows) |
| — | Actualización automática con un clic (con vuelta atrás si falla) | ✅ hecho (falta probarlo en Windows) |
| — | Ortosend Taller: apartados Fresado y Confección; pedidos de la web como post-its en orden de salida, hoja de confección, cambios de estado y aviso de fin de CNC (sin costes en el taller) | ✅ hecho (necesita publicar la actualización de la web) |
| CNC | Salida directa para la CNC (G-code), varios moldes en una plancha, estrategia y formato del ejemplo de Fusion (bola Ø25: contorno + desbaste en capas de 5 mm + acabado paralelo cada 1,75 mm) | ✅ hecho (falta la 1.ª prueba en la máquina) |

## Instalar en Windows (una sola vez)

> Guía paso a paso para probarlo: **[PROBAR.md](PROBAR.md)**.

1. Instala **Python 3.11 o superior** desde https://www.python.org (marca la casilla *Add Python to PATH*).
2. Descarga esta carpeta `rectificador`.
3. Doble clic en `arrancar.bat`. La primera vez tarda unos minutos porque instala lo necesario.

## Uso

**Con ventana**: doble clic en `arrancar.bat` (o `python -m interfaz.principal` desde esta carpeta).

1. *Archivo → Abrir escaneo…* y elige el STL del Revopoint. Tarda unos segundos en limpiarlo.
2. Comprueba que cada pie tiene bien puesto su nombre (PIE IZQUIERDO / PIE DERECHO).
   Si no, pulsa **Intercambiar izquierdo ↔ derecho**.
3. Marca las referencias de cada pie con **clic derecho** sobre el molde, en este orden:
   cabeza del 1.er MTT, cabeza del 5.º MTT y talón. Con las tres aparecen el eje del pie (amarillo, del talón al punto entre el 2.º y el 3.er MTT),
   la línea metatarsal (naranja), la zona del arco (turquesa) y el talón interno/externo.
   Para ajustar una: **cógela con el botón izquierdo y arrástrala** sobre el molde (o pulsa su botón
   **Marcar** y haz clic derecho donde corresponda).
   Opcionalmente, las cabezas del 2.º, 3.º y 4.º MTT: si están, el recorte pasa por delante de las 5.
   **Proponer referencias** las coloca todas para empezar: las cabezas donde el pie se hundió más en la
   espuma en el antepié (respeta la fórmula metatarsal del paciente) y el talón por proporciones típicas.
4. **Recorte en arco**: con las referencias puestas, el molde termina en un arco (línea roja) 15 mm por
   delante de las cabezas metatarsales (de todas las marcadas) siguiendo la parábola metatarsal; por
   delante se vacía hasta la base.
   Se puede adelantar/atrasar y cambiar la curvatura en el panel de cada pie.
5. *Archivo → Exportar…* guarda los 3 archivos.

Ratón: girar = arrastrar con el botón izquierdo · desplazar = Mayús + arrastrar · zoom = rueda.

### Salida directa para la CNC (sin Fusion)

*Archivo → Añadir este molde a la tirada de CNC* (Ctrl+T) y, en la ventana **Tirada de CNC**,
mira la **vista previa** (aparece al momento: dónde queda cada molde, numerado en el orden en que se
fresará; cada pie se arrastra con el ratón, doble clic lo gira, clic derecho da más opciones) →
**Calcular trayectorias** → **Guardar archivo para la CNC (.nc)**. Se copia la estrategia del ejemplo de
Fusion del taller (`molde_yeso.nc`), con la fresa de **bola Ø25 mm**:

- **Origen**: X0 Y0 en la esquina **delantera izquierda** de la plancha, Z0 en su **cara de arriba**.
- Varios pies en una misma plancha (por defecto 600 × 500 × 40 mm), colocados lo más juntos posible.
- Cada pie se fresa con su parte más alta 0,5 mm por debajo de la cara de arriba, en tres fases:
  1. **Contorno**: rodea la silueta del pie bajando en espiral 3 mm por vuelta hasta dejar 7,5 mm de
     escayola debajo (menos, como mínimo 3 mm, si el pie es muy alto). El pie queda como una isla con
     la pared vertical, sin base plana alrededor; el resto de la plancha no se toca.
  2. **Desbaste** dentro de la silueta en capas de 5 mm, dejando 0,5 mm.
  3. **Acabado** en líneas paralelas a X cada 1,75 mm (crestas de 0,03 mm).
- Junto al `.nc` se guarda el **mapa de la plancha** (`NOMBRE_mapa.pdf` para imprimir y `.png`): cada molde
  numerado en el orden en que se fresa (= «Pieza N» del `.nc`), nombre, pie, hacia dónde van los dedos,
  posición en mm y origen.
- Avances del ejemplo de Fusion: 2500 mm/min cortando, 1500 entrando, 800 bajando, 3000 en el acabado,
  10 000 rpm. Todo se puede cambiar en `config/taller.toml`, sección `[cnc]`.

**Sin ventana** (por consola):

```
python herramientas\rectificar.py C:\ruta\al\escaneo.stl C:\ruta\salida NOMBRE
```

Para generar los moldes de prueba: `python herramientas\generar_sintetico.py` (crea `ejemplos\sintetico.stl` y `ejemplos\sintetico_bruto.stl`).

## Valores clínicos

Las alturas y tamaños por defecto de cada pieza están en `config/valores_clinicos.toml`
(se abre con el Bloc de notas). **Son provisionales**: hay que revisarlos.
Los datos de la máquina (recuadro, altura del bloque, fresa, límite de Fusion) están en `config/taller.toml`.

## Cómo funciona por dentro (resumen)

- El molde se trata como un **mapa de alturas**: para cada punto de la planta (cada 0,5 mm) se guarda la altura.
- **Nunca se modifica el escaneo**: el resultado se recalcula siempre desde el original sumando o restando
  las correcciones. Por eso cualquier pieza se puede editar o borrar en cualquier orden.
- Las correcciones se escriben pensando en la **plantilla** (p. ej. «oliva de 5 mm»);
  el programa hace la inversión en el molde (la oliva es un hueco en el molde).
- Partes del código:
  - `ortomolde/` – núcleo geométrico, sin ventana. Se podrá importar desde los demás scripts del taller.
  - `interfaz/` – la ventana (visor 3D y panel lateral).
  - `config/` – valores editables.
  - `tests/` – comprobaciones automáticas (`python -m pytest tests`).

## Coordenadas

Internamente: origen en la esquina delantera-izquierda del recuadro, Z = 0 en el fondo.
En taller: X0 Y0 en la esquina delantera-izquierda de la cara superior del bloque, Z0 arriba
(Z de taller = Z interna − 38). El STL de salida se devuelve en las **mismas coordenadas que el de entrada**.

## Versiones guardadas

Puntos de guardado a los que se puede volver en cualquier momento. Estas ramas **no se tocan**:
el trabajo nuevo sigue en `claude/rectificador-moldes`.

| Versión | Fecha | Rama en GitHub | Qué incluye |
|---|---|---|---|
| Base v1 | 18/10/2026 | `claude/rectificador-base-v1` (commit `898cef4`) | Limpieza automática (modos huellas en espuma y molde ya hecho, 1 o 2 pies), lijado, referencias (5 cabezas MTT y talón) propuestas y arrastrables, eje entre 2.º y 3.º MTT, recorte en arco, medidas y reglas en mm, abrir `.revox`/`.ply`/`.obj`/`.stl`/`.zip`, exportación STL + Fusion + receta, lanzador de Windows. |

Para descargar una versión guardada: en GitHub, *Code* → elegir la rama de la tabla → *Download ZIP*.
