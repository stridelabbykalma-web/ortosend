import json

import numpy as np
import trimesh

from ortomolde.campo import Campo, Rejilla, campo_a_malla, detectar_fondo, malla_a_campo
from ortomolde.exportar import exportar
from ortomolde.proyecto import Proyecto


def test_ida_y_vuelta_malla_campo(campo_sint):
    malla = campo_a_malla(campo_sint)
    assert malla.is_watertight
    vuelta = malla_a_campo(malla, 1.0, (288, 330))
    assert np.abs(vuelta.z - campo_sint.z).max() < 1e-4


def test_malla_estanca_con_alturas_cero_en_el_borde():
    r = Rejilla.para_recuadro(20, 30, 1.0)
    X, Y = r.malla()
    z = np.where((X > 5) & (X < 15) & (Y > 5) & (Y < 25), 5.0, 0.0)
    malla = campo_a_malla(Campo(r, z, np.zeros(3)))
    assert malla.is_watertight
    assert malla.volume > 0


def test_desplazamiento_respeta_sistema_del_stl():
    r = Rejilla.para_recuadro(10, 10, 1.0)
    campo = Campo(r, np.full((r.ny, r.nx), 3.0), np.array([100.0, -50.0, -38.0]))
    lo, hi = campo_a_malla(campo).bounds
    assert np.allclose(lo, [100, -50, -38]) and np.allclose(hi, [110, -40, -35])


def test_fondo(campo_sint):
    assert abs(detectar_fondo(campo_sint.z) - 2.0) < 0.05


def test_exportacion(tmp_path, stl_sintetico, taller):
    proyecto = Proyecto.abrir(stl_sintetico, {**taller, "calculo": {"rejilla": 1.0}})
    rutas = exportar(proyecto.calcular(), tmp_path, "PRUEBA", proyecto.receta(), taller)

    real = trimesh.load(rutas["stl"])
    assert real.is_watertight
    tam = real.bounds[1] - real.bounds[0]
    assert np.allclose(tam[:2], [288, 330], atol=0.01) and tam[2] <= 38

    fusion = trimesh.load(rutas["fusion"])
    assert len(fusion.faces) < taller["fusion"]["max_triangulos"]
    assert fusion.is_watertight
    assert np.allclose(fusion.bounds[1] - fusion.bounds[0], tam * 0.1, atol=0.05)

    receta = json.loads(rutas["receta"].read_text(encoding="utf-8"))
    assert receta["escaneo"]["sha256"] == proyecto.huella_stl
