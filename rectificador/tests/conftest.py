import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
# En las pruebas no se pregunta «¿guardar los cambios?» al cerrar (no hay nadie para contestar).
os.environ["RECTIFICADOR_SIN_PREGUNTAR"] = "1"
# Los «Ajustes de la CNC» de las pruebas van a un archivo temporal (nunca a los del ordenador).
os.environ["ORTOSEND_AJUSTES"] = str(Path(tempfile.mkdtemp(prefix="ortosend_")) / "ajustes_taller.json")

from ortomolde import config  # noqa: E402
from ortomolde.campo import campo_a_malla  # noqa: E402
from ortomolde.sintetico import campo_sintetico  # noqa: E402


@pytest.fixture(scope="session")
def taller():
    return config.taller()


@pytest.fixture(scope="session")
def campo_sint():
    # Rejilla de 1 mm para que los tests vayan rápido.
    return campo_sintetico(paso=1.0)


@pytest.fixture(scope="session")
def stl_sintetico(tmp_path_factory, campo_sint):
    ruta = tmp_path_factory.mktemp("ejemplo") / "sintetico.stl"
    campo_a_malla(campo_sint).export(ruta)
    return ruta
