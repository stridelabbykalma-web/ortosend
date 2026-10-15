import numpy as np
import pytest

from ortomolde.exportar import exportar, medidas_stl
from ortomolde.proyecto import Proyecto


@pytest.fixture(scope="module")
def proyecto(stl_sintetico, taller):
    return Proyecto.abrir(stl_sintetico, {**taller, "calculo": {"rejilla": 1.0}})


def test_medidas_del_pie_sintetico(proyecto):
    # El pie izquierdo sintético mide 255 mm de talón a punta (sintetico.py).
    m = proyecto.medidas(proyecto.pie("izquierdo"))
    assert m["largo"] == pytest.approx(255, abs=4)
    assert 70 < m["ancho_maximo"] < 95
    proyecto.proponer_referencias(proyecto.pie("izquierdo"))
    m = proyecto.medidas(proyecto.pie("izquierdo"))
    assert m["largo"] == pytest.approx(255, abs=4)
    assert m["talon_mtt1"] > 140 and m["mtt1_mtt5"] > 30


def test_medidas_de_los_archivos_exportados(proyecto, tmp_path, taller):
    rutas = exportar(proyecto.calcular(), tmp_path, "M", proyecto.receta(), taller)
    real = medidas_stl(rutas["stl"])
    fusion = medidas_stl(rutas["fusion"])
    assert np.allclose(real[:2], (288, 330), atol=0.01)
    assert np.allclose(np.array(fusion) * 10, real, atol=0.5)
