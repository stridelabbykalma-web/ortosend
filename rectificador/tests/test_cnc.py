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
    pos = {"X": 0.0, "Y": 0.0, "Z": 15.0}
    for linea in gcode.splitlines():
        if linea.startswith(("G0", "G1")):
            for eje, v in re.findall(r"([XYZ])(-?\d+\.?\d*)", linea):
                pos[eje] = float(v)
            yield linea[:2], dict(pos)


def test_colocacion_sin_solapes_y_dentro(piezas_sinteticas, cfg):
    radio = 12.5
    piezas = piezas_sinteticas("A") + piezas_sinteticas("B") + piezas_sinteticas("C")
    sobran = cnc.colocar(piezas, 600, 500, 1.0, cfg, radio)
    puestas = [p for p in piezas if p.colocada]
    assert len(puestas) >= 4 and len(puestas) + len(sobran) == 6
    m = cnc.margen_celdas(radio, 1.0, cfg)
    ocupado = np.zeros((501, 601), int)
    for p in puestas:
        a, b = p.forma()
        # Pie + su margen para el contorno, dentro de la plancha y sin pisar a otro.
        assert p.x - m >= 0 and p.y - m >= 0 and p.x + b + m <= 601 and p.y + a + m <= 501
        ocupado[p.y - m:p.y + a + m, p.x - m:p.x + b + m] += 1
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


@pytest.fixture(scope="module")
def tirada(piezas_sinteticas, cfg):
    return cnc.generar(piezas_sinteticas("A") + piezas_sinteticas("B"), 600, 500, 40, 1.0, 12.5, cfg)


def test_gcode_como_fusion(tirada, cfg):
    t = tirada
    assert len(t.piezas) == 4 and not t.sobran
    lineas = t.gcode.splitlines()
    for orden in ("G90 G94", "G17", "G21", "T1", "S10000 M3", "G54", "G0 Z15"):
        assert orden in lineas[:16]
    assert "(T1 D=25 CR=12.5" in t.gcode and "esquina DELANTERA IZQUIERDA" in t.gcode
    assert lineas[-2:] == ["M5", "M30"]
    t.gcode.encode("ascii")  # solo caracteres básicos para el controlador
    # Comentarios entre paréntesis, sin paréntesis dentro.
    for linea in lineas:
        if linea.startswith("("):
            assert linea.endswith(")") and "(" not in linea[1:-1] and ")" not in linea[1:-1]
    # Por cada pie: contorno, desbaste y acabado, en ese orden.
    fases = [l for l in lineas if l.startswith(("(2D", "(Desbaste", "(Paralelo"))]
    assert [f.split()[0] for f in fases] == ["(2D", "(Desbaste", "(Paralelo"] * 4


def test_movimientos_dentro_de_la_plancha(tirada, cfg):
    """Origen en la esquina delantera izquierda y arriba: todo en X, Y ≥ 0 y nunca por debajo del suelo."""
    for tipo, p in _movimientos(tirada.gcode):
        assert -0.01 <= p["X"] <= 600.01 and -0.01 <= p["Y"] <= 500.01
        assert -(40 - cfg["suelo_minimo"]) - 1e-6 <= p["Z"] <= cfg["altura_seguridad"] + 1e-6
    assert tirada.resumen["z_minima"] >= -(40 - cfg["suelo_minimo"]) - 1e-6


def _por_fase(gcode):
    fase = None
    pos = {"X": 0.0, "Y": 0.0, "Z": 15.0}
    for linea in gcode.splitlines():
        if linea.startswith("("):
            fase = linea.split()[0][1:]
            continue
        if linea.startswith(("G0", "G1")):
            antes = dict(pos)
            for eje, v in re.findall(r"([XYZ])(-?\d+\.?\d*)", linea):
                pos[eje] = float(v)
            yield fase, linea[:2], antes, dict(pos)


def _bilineal(campo, x, y, paso):
    i, j = int(np.floor(x / paso)), int(np.floor(y / paso))
    fx, fy = x / paso - i, y / paso - j
    c = campo[j:j + 2, i:i + 2]
    return (c[0, 0] * (1 - fx) + c[0, 1] * fx) * (1 - fy) + (c[1, 0] * (1 - fx) + c[1, 1] * fx) * fy


def test_desbaste_y_acabado_no_se_comen_el_molde(tirada):
    """La punta nunca baja de la superficie segura (molde + bola) en el desbaste ni en el acabado."""
    H, paso = 40.0, tirada.paso
    peor = {"Desbaste": -9.0, "Paralelo": -9.0}
    for fase, tipo, a, b in _por_fase(tirada.gcode):
        if fase not in peor:
            continue
        pa, pb = np.array([a["X"], a["Y"], a["Z"]]), np.array([b["X"], b["Y"], b["Z"]])
        for s in np.linspace(0, 1, int(np.linalg.norm(pb[:2] - pa[:2]) / 0.5) + 2):
            q = pa + (pb - pa) * s
            peor[fase] = max(peor[fase], _bilineal(tirada.punta, q[0], q[1], paso) - (q[2] + H))
    assert peor["Desbaste"] <= -0.3  # deja el sobrante para el acabado
    assert peor["Paralelo"] <= 0.02


def test_contorno_rodea_el_pie_sin_tocarlo(tirada, cfg):
    """La bola del contorno no toca ningún pie (comprobado punto a punto con la bola real)."""
    H, paso, R = 40.0, tirada.paso, 12.5
    alt = tirada.altura
    r = int(np.ceil(R / paso)) + 1
    peor = -9.0
    n = 0
    for fase, tipo, a, b in _por_fase(tirada.gcode):
        if fase != "2D" or tipo != "G1" or b["Z"] > -20:
            continue
        n += 1
        if n % 7:
            continue
        x, y, z = b["X"], b["Y"], b["Z"] + H
        i0, j0 = int(round(x / paso)), int(round(y / paso))
        jj, ii = np.mgrid[max(j0 - r, 0):j0 + r + 1, max(i0 - r, 0):i0 + r + 1]
        d = np.hypot(ii * paso - x, jj * paso - y)
        m = d < R
        peor = max(peor, float((alt[jj[m], ii[m]] - (z + R - np.sqrt(R * R - d[m] ** 2))).max()))
    assert n > 100 and peor <= 0.1
    # Cuatro recorridos cerrados, uno por pie, que rodean cada silueta.
    assert len(tirada.contornos) == 4
    for c in tirada.contornos:
        assert np.allclose(c[0], c[-1])


def test_capas_y_lineas_como_se_ha_pedido(tirada, cfg):
    zs_desbaste, ys_acabado = set(), set()
    for fase, tipo, a, b in _por_fase(tirada.gcode):
        if fase == "Desbaste" and tipo == "G1":
            zs_desbaste.add(round(b["Z"], 3))
        if fase == "Paralelo" and tipo == "G1" and a["Y"] == b["Y"]:
            ys_acabado.add(round(b["Y"], 3))
    # Primera capa del desbaste a -5 mm.
    assert -cfg["bajada_por_pasada"] in zs_desbaste
    # Líneas del acabado paralelas a X, separadas paso_acabado (en una rejilla de 1 mm: 2 mm).
    ys = np.array(sorted(ys_acabado))
    assert np.median(np.diff(ys)) == pytest.approx(round(cfg["paso_acabado"]), abs=0.01)
    assert tirada.tiempo_min > 0 and set(tirada.tiempos) >= {"contorno", "desbaste", "acabado"}


def test_plancha_pequena_avisa_lo_que_no_cabe(piezas_sinteticas, cfg):
    t = cnc.generar(piezas_sinteticas("A"), 200, 300, 40, 1.0, 12.5, cfg)
    assert len(t.piezas) == 1 and len(t.sobran) == 1
    assert "No caben 1" in t.avisos[0]


def test_piezas_de_un_molde_exportado(tmp_path, stl_sintetico, taller):
    from interfaz.tirada import piezas_de_archivo
    p = Proyecto.abrir(stl_sintetico, {**taller, "calculo": {"rejilla": 1.0}})
    ruta = tmp_path / "PACIENTE.stl"
    campo_a_malla(p.calcular()).export(ruta)
    piezas = piezas_de_archivo(str(ruta), {**taller, "calculo": {"rejilla": 1.0}})
    assert len(piezas) == 2 and all(q.nombre.startswith("PACIENTE") for q in piezas)


def test_mapa_de_la_tirada(tirada, tmp_path):
    from ortomolde import mapa

    # Una ficha por pie, numeradas en el mismo orden que «Pieza N» del .nc.
    assert [f.numero for f in tirada.fichas] == [1, 2, 3, 4]
    for f in tirada.fichas:
        assert f"(Pieza {f.numero}: {cnc.texto_cnc(f.nombre)}" in tirada.gcode
        assert 0 <= f.x[0] < f.x[1] <= 600 and 0 <= f.y[0] < f.y[1] <= 500
        assert abs(np.hypot(*f.dedos) - 1) < 1e-6
        if f.pieza.giro == 0:
            assert f.dedos[1] > 0.9  # los dedos hacia +Y si no se ha girado
    png, pdf = mapa.guardar(tirada, tmp_path / "TIRADA", "TIRADA", 25)
    assert png.stat().st_size > 20000 and pdf.read_bytes().startswith(b"%PDF")
