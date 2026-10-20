import numpy as np
import pytest

from ortomolde import trabajo
from ortomolde.proyecto import Proyecto


@pytest.fixture()
def proyecto(stl_sintetico, taller):
    p = Proyecto.abrir(stl_sintetico, {**taller, "calculo": {"rejilla": 1.0}})
    for pie in p.pies:
        p.proponer_referencias(pie)
    pie = p.pies[0]
    pie.piezas["oliva"].activa = True
    pie.piezas["oliva"].du = -4
    pie.piezas["arco"].activa = True
    pie.piezas["arco"].sentido = "subir"
    pie.recorte.adelanto = 6.0
    p.lijado = 4.0
    p.paciente = {"nombre": "María López", "fecha": "2026-10-20", "notas": "Pie cavo · revisar en 6 meses"}
    return p


def test_guardar_y_abrir_da_el_mismo_molde(proyecto, tmp_path):
    ruta = trabajo.guardar(proyecto, tmp_path / "maria")
    assert ruta.suffix == ".molde" and ruta.exists()
    q = trabajo.abrir(ruta)
    assert q.paciente == proyecto.paciente
    assert [p.lado for p in q.pies] == [p.lado for p in proyecto.pies]
    for a, b in zip(proyecto.pies, q.pies):
        assert a.referencias.puntos == b.referencias.puntos
        assert a.recorte == b.recorte
        assert a.piezas == b.piezas
    assert q.lijado == 4.0
    assert np.array_equal(q.calcular().z, proyecto.calcular().z)  # exactamente el mismo molde


def test_intercambiar_lados_despues_de_reabrir(proyecto, tmp_path):
    q = trabajo.abrir(trabajo.guardar(proyecto, tmp_path / "x.molde"))
    lados = [p.lado for p in q.pies]
    q.intercambiar_lados()
    assert sorted(p.lado for p in q.pies) == sorted(lados) and q.pies[0].referencias.completas


def test_archivo_que_no_es_un_trabajo(tmp_path):
    malo = tmp_path / "malo.molde"
    malo.write_bytes(b"esto no es un zip")
    with pytest.raises(trabajo.ErrorTrabajo):
        trabajo.abrir(malo)
