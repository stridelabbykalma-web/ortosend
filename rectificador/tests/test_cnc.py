import re

import numpy as np
import pytest

from ortomolde import cnc
from ortomolde.campo import campo_a_malla
from ortomolde.proyecto import Proyecto


@pytest.fixture(scope="module")
def cfg(taller):
    return taller["cnc"]


@pytest.fixture(scope="module")
def piezas_sinteticas(stl_sintetico, taller):
    p = Proyecto.abrir(stl_sintetico, {**taller, "calculo": {"rejilla": 1.0}})
    c = p.calcular()
    return lambda nombre: cnc.piezas_de_molde(c.z, p.fondo, [q.mascara for q in p.pies],
                                              [f"{nombre} {q.lado}" for q in p.pies], 1.0, taller["cnc"])


def _movimientos(gcode):
    pos = {"X": 0.0, "Y": 0.0, "Z": 5.0}
    for linea in gcode.splitlines():
        if linea.startswith(("G0", "G1")):
            for eje, v in re.findall(r"([XYZ])(-?\d+\.?\d*)", linea):
                pos[eje] = float(v)
            yield linea[:2], dict(pos)


def test_colocacion_sin_solapes_y_dentro(piezas_sinteticas, cfg):
    piezas = piezas_sinteticas("A") + piezas_sinteticas("B") + piezas_sinteticas("C")
    sobran = cnc.colocar(piezas, 600, 500, 1.0, cfg)
    puestas = [p for p in piezas if p.colocada]
    assert len(puestas) >= 4 and len(puestas) + len(sobran) == 6
    ocupado = np.zeros((501, 601), int)
    for p in puestas:
        a, b = p.forma()
        assert p.x >= 0 and p.y >= 0 and p.x + b <= 601 and p.y + a <= 501
        ocupado[p.y:p.y + a, p.x:p.x + b] += 1
    assert ocupado.max() == 1


def test_bola_nunca_se_come_el_molde():
    r = 6.0
    yy, xx = np.mgrid[0:120, 0:120] * 0.5
    h = 3 + 20 * np.exp(-((xx - 30) ** 2 + (yy - 30) ** 2) / 200) - 4 * np.exp(-((xx - 30) ** 2 + (yy - 40) ** 2) / 4)
    punta = cnc.superficie_punta(h, r, 0.5)
    b = cnc.bola(r, 0.5)
    k = b.shape[0] // 2
    for j in range(k, h.shape[0] - k, 7):
        for i in range(k, h.shape[1] - k, 7):
            # Superficie inferior de la bola con la punta en (i, j) frente al molde de alrededor.
            fondo_bola = punta[j, i] + r - b
            vecinos = h[j - k:j + k + 1, i - k:i + k + 1]
            assert (fondo_bola[np.isfinite(b)] >= vecinos[np.isfinite(b)] - 1e-6).all()


def test_gcode_de_una_tirada(piezas_sinteticas, cfg):
    piezas = piezas_sinteticas("A") + piezas_sinteticas("B")
    t = cnc.generar(piezas, 600, 500, 40, 1.0, 6.0, cfg)
    assert len(t.piezas) == 4 and not t.sobran
    assert "M3" in t.gcode and t.gcode.rstrip().endswith("M30")
    assert "esquina DELANTERA IZQUIERDA" in t.gcode
    t.gcode.encode("ascii")  # solo caracteres básicos para el controlador
    zs_corte = []
    for tipo, p in _movimientos(t.gcode):
        assert -0.01 <= p["X"] <= 600.01 and -0.01 <= p["Y"] <= 500.01
        assert -40.0 - 1e-6 <= p["Z"] <= cfg["altura_seguridad"] + 1e-6
        if tipo == "G1":
            zs_corte.append(p["Z"])
    # El desbaste baja en capas de 1 cm: la primera capa está a -10 mm.
    assert pytest.approx(-cfg["bajada_por_pasada"], abs=0.01) in zs_corte
    assert t.tiempo_min > 0


def test_plancha_pequena_avisa_lo_que_no_cabe(piezas_sinteticas, cfg):
    t = cnc.generar(piezas_sinteticas("A"), 160, 300, 40, 1.0, 6.0, cfg)
    assert len(t.piezas) == 1 and len(t.sobran) == 1
    assert "No caben 1" in t.avisos[0]


def test_piezas_de_un_molde_exportado(tmp_path, stl_sintetico, taller):
    from interfaz.tirada import piezas_de_archivo
    p = Proyecto.abrir(stl_sintetico, {**taller, "calculo": {"rejilla": 1.0}})
    ruta = tmp_path / "PACIENTE.stl"
    campo_a_malla(p.calcular()).export(ruta)
    piezas = piezas_de_archivo(str(ruta), {**taller, "calculo": {"rejilla": 1.0}})
    assert len(piezas) == 2 and all(q.nombre.startswith("PACIENTE") for q in piezas)
