"""Uso por línea de comandos (sin interfaz):

    python herramientas/rectificar.py ENTRADA.stl CARPETA_SALIDA NOMBRE
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ortomolde.exportar import exportar  # noqa: E402
from ortomolde.proyecto import Proyecto  # noqa: E402

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    entrada, carpeta, nombre = sys.argv[1:]
    proyecto = Proyecto.abrir(entrada)
    rutas = exportar(proyecto.calcular(), carpeta, nombre, proyecto.receta(), proyecto.taller)
    for r in rutas.values():
        print("Escrito", r)
