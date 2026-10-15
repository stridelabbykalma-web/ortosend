"""Genera los moldes de prueba en ejemplos/:

- sintetico.stl        recuadro ya limpio (dos pies en bulto)
- sintetico_bruto.stl  escaneo en bruto simulado (huellas hundidas, ruido, agujeros, inclinado)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ortomolde import config  # noqa: E402
from ortomolde.sintetico import malla_bruta, malla_sintetica  # noqa: E402

if __name__ == "__main__":
    carpeta = Path(__file__).resolve().parent.parent / "ejemplos"
    for nombre, malla in (("sintetico.stl", malla_sintetica()), ("sintetico_bruto.stl", malla_bruta(config.taller()))):
        malla.export(carpeta / nombre)
        print(f"Creado {carpeta / nombre} ({len(malla.faces)} triángulos)")
