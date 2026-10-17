"""Uso por línea de comandos (sin interfaz):

    python herramientas/rectificar.py ENTRADA.stl CARPETA_SALIDA NOMBRE [--modo huellas|moldes]

--modo huellas (por defecto): huella hundida en los bloques de espuma.
--modo moldes: escaneo de un molde ya hecho (pie en bulto sobre una base).

ENTRADA puede ser STL, PLY, OBJ, el proyecto de Revo Scan (.revox) o un ZIP con ellos.
Puede ser el escaneo en bruto del Revopoint (se limpia solo) o un recuadro
ya limpio. Además de los 3 archivos de siempre se guarda NOMBRE_limpio.stl (el molde
limpio sin correcciones) para poder revisarlo.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ortomolde.campo import campo_a_malla  # noqa: E402
from ortomolde.exportar import exportar  # noqa: E402
from ortomolde.proyecto import Proyecto  # noqa: E402

if __name__ == "__main__":
    args = sys.argv[1:]
    modo = "huellas"
    if "--modo" in args:
        i = args.index("--modo")
        modo = args[i + 1]
        del args[i:i + 2]
    if len(args) != 3:
        print(__doc__)
        sys.exit(1)
    entrada, carpeta, nombre = args
    proyecto = Proyecto.abrir(entrada, modo=modo)
    print("Tipo de entrada:", proyecto.tipo, "· modo:", modo)
    if proyecto.informe:
        for pie in proyecto.informe.pies:
            print(f"  Pie {pie['lado']} en la mitad {pie['mitad']}: {pie['largo_mm']} × {pie['ancho_mm']} mm, "
                  f"huella de {pie['profundidad_max_mm']} mm")
    for aviso in proyecto.avisos:
        print("  AVISO:", aviso)
    rutas = exportar(proyecto.calcular(), carpeta, nombre, proyecto.receta(), proyecto.taller)
    limpio = Path(carpeta) / f"{nombre}_limpio.stl"
    campo_a_malla(proyecto.original).export(limpio)
    for r in [*rutas.values(), limpio]:
        print("Escrito", r)
