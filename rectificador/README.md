# Rectificador de moldes – Ortosend

Programa de escritorio para rectificar digitalmente los moldes de pie **antes de fresarlos**.
Recibe directamente el escaneo del Revopoint y hace también la limpieza:

```
escaneo Revopoint → [ RECTIFICADOR: limpieza + correcciones ] → Fusion 360 (CAM) → CNC → termoformado
```

Es un programa independiente: no toca ni importa los otros scripts del taller, solo intercambia archivos.

### Limpieza del escaneo (automática)

1. Busca la cara superior plana de los dos bloques (descarta la mesa y los restos sueltos) y endereza el escaneo.
2. Encaja el rectángulo de los bloques y lo lleva a los ejes del recuadro (X ancho, Y largo).
3. Quita picos de ruido y rellena los agujeros del escaneo dentro de la huella.
4. Separa las dos huellas y borra todo lo que no es pie.
5. **Vuelca el molde** como si se diera la vuelta al bloque (giro, nunca espejo): el pie izquierdo sigue siendo izquierdo.
6. Pone los dedos hacia +Y, propone cuál es el izquierdo y cuál el derecho (mirando el arco interno) y coloca cada
   pie centrado en su mitad del recuadro, sobre una base plana.

Ajustes en `config/taller.toml`, sección `[limpieza]` (grosor de base, mitad del pie izquierdo, suavizado...).
También acepta un recuadro ya limpio (lo detecta solo).

## Qué recibe y qué devuelve

- **Entrada**: el STL en bruto del Revopoint (los dos bloques con la huella hundida, mm), o un recuadro ya limpio.
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
| 2 | Separar pies, izquierdo/derecho, marcar 3 referencias con clic | pendiente |
| 3 | Recorte en arco por delante de las cabezas metatarsales | pendiente |
| 4 | Piezas: relleno de arco, oliva, descarga 1.er MTT, skive medial | pendiente |
| 5 | Edición interactiva de piezas, deshacer/rehacer | pendiente |
| 6 | Comprobación de la fresa Ø12, corte transversal, prueba con STL real | pendiente |

## Instalar en Windows (una sola vez)

1. Instala **Python 3.11 o superior** desde https://www.python.org (marca la casilla *Add Python to PATH*).
2. Descarga esta carpeta `rectificador`.
3. Doble clic en `arrancar.bat`. La primera vez tarda unos minutos porque instala lo necesario.

## Uso actual (hito 1, sin ventana todavía)

Desde una consola en la carpeta `rectificador`:

```
python herramientas\rectificar.py C:\ruta\al\molde.stl C:\ruta\salida NOMBRE
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
