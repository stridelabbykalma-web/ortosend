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


def test_corte_a_15_mm_en_los_nuevos_y_los_guardados_como_estaban(stl_sintetico, taller, tmp_path):
    from ortomolde import recorte as R

    p = Proyecto.abrir(stl_sintetico, {**taller, "calculo": {"rejilla": 1.0}})
    for pie in p.pies:
        p.proponer_referencias(pie)
        assert pie.recorte.adelanto == 15.0
    # Delante de la línea de 15 mm (más la pendiente de 10 mm) ya no hay molde; justo detrás, sí.
    pie = p.pies[0]
    assert pie.recorte.pendiente == 10.0
    z = p.calcular().z
    X, Y = p.original.rejilla.malla()
    t, s = R.coordenadas_arco(pie.referencias, X, Y)
    linea = R._perfil(pie.referencias, pie.recorte)(t) + 15.0
    dentro = pie.mascara & (t > 0.1) & (t < 0.9)
    assert (z[dentro & (s > linea + 10 + 2)] - p.fondo).max() < 1e-6
    assert (z[dentro & (s < linea - 2) & (s > linea - 6)] - p.fondo).min() > 0.5
    # Un trabajo guardado con 3 mm se abre con 3 mm.
    for q in p.pies:
        q.recorte.adelanto = 3.0
    ruta = trabajo.guardar(p, tmp_path / "viejo.molde")
    assert all(q.recorte.adelanto == 3.0 for q in trabajo.abrir(ruta).pies)
