"""Rehace MANIFIESTO.txt (la lista de archivos con su huella que usa la actualización automática).

Hay que ejecutarlo antes de cada entrega (el test `test_manifiesto_al_dia` avisa si se olvida):
    python herramientas/manifiesto.py
"""

import subprocess
import sys
from pathlib import Path

CARPETA = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CARPETA / "interfaz"))

import actualizar  # noqa: E402


def archivos() -> list[str]:
    salida = subprocess.run(["git", "ls-files", "-z", "--", "."], cwd=CARPETA, capture_output=True, check=True)
    rutas = [r for r in salida.stdout.decode("utf-8").split("\0") if r]
    return [r for r in rutas if not r.startswith("tests/") and r != actualizar.MANIFIESTO]


def texto() -> str:
    return actualizar.generar_manifiesto(CARPETA, archivos())


if __name__ == "__main__":
    (CARPETA / actualizar.MANIFIESTO).write_text(texto(), encoding="utf-8", newline="\n")
    print(f"{actualizar.MANIFIESTO}: {len(archivos())} archivos")
