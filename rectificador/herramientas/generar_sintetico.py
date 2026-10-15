"""Genera ejemplos/sintetico.stl (molde de prueba con dos pies)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ortomolde.sintetico import malla_sintetica  # noqa: E402

if __name__ == "__main__":
    destino = Path(__file__).resolve().parent.parent / "ejemplos" / "sintetico.stl"
    malla = malla_sintetica()
    malla.export(destino)
    print(f"Creado {destino} ({len(malla.faces)} triángulos, estanco={malla.is_watertight})")
