import numpy as np

from ortomolde.campo import Rejilla
from ortomolde.suavizado import suavizar


def _cupula():
    r = Rejilla.para_recuadro(120, 120, 0.5)
    X, Y = r.malla()
    d2 = (X - 60) ** 2 + (Y - 60) ** 2
    z = 3.0 + np.where(d2 < 40 ** 2, 20 * np.sqrt(np.clip(1 - d2 / 40 ** 2, 0, 1)), 0.0)
    mascara = d2 < 42 ** 2
    return X, Y, z, mascara


def test_quita_hoyo_y_bulto_pero_conserva_la_forma():
    X, Y, z, mascara = _cupula()
    limpio = z.copy()
    sucio = z.copy()
    sucio[(X - 50) ** 2 + (Y - 55) ** 2 < 1.5 ** 2] -= 1.5  # hoyito de 3 mm
    sucio[(X - 70) ** 2 + (Y - 65) ** 2 < 1.5 ** 2] += 1.5  # bultito de 3 mm
    s = suavizar(sucio, 3.0, mascara, 0.5, 3.0)
    for x, y in ((50, 55), (70, 65)):
        j, i = int(y / 0.5), int(x / 0.5)
        assert abs(s[j, i] - limpio[j, i]) < 0.3
    # La forma grande (cúpula) apenas cambia en la zona central.
    centro = (X - 60) ** 2 + (Y - 60) ** 2 < 30 ** 2
    assert np.abs(s - suavizar(limpio, 3.0, mascara, 0.5, 3.0))[centro].max() < 0.3
    assert np.abs(suavizar(limpio, 3.0, mascara, 0.5, 3.0) - limpio)[centro].max() < 0.3


def test_base_sigue_plana_y_cero_no_cambia():
    X, Y, z, mascara = _cupula()
    s = suavizar(z, 3.0, mascara, 0.5, 3.0)
    lejos = (X - 60) ** 2 + (Y - 60) ** 2 > 55 ** 2
    assert np.allclose(s[lejos], 3.0)
    assert s.min() >= 3.0 - 1e-9
    assert np.array_equal(suavizar(z, 3.0, mascara, 0.5, 0.0), z)


def test_contorno_no_cambia_con_lijado_fuerte():
    X, Y, z, mascara = _cupula()
    s = suavizar(z, 3.0, mascara, 0.5, 8.0)
    for nivel in (2.0, 10.0):
        antes, despues = (z - 3.0 > nivel).sum(), (s - 3.0 > nivel).sum()
        assert abs(despues - antes) / antes < 0.02


def test_lijado_conserva_superficie_curva_y_quita_ondulacion():
    from ortomolde.campo import Rejilla
    r = Rejilla.para_recuadro(120, 120, 0.5)
    X, Y = r.malla()
    curva = 3.0 + 15 + 0.004 * (X - 60) ** 2 - 0.003 * (Y - 60) ** 2  # superficie curva amplia
    onda = 0.4 * np.sin(2 * np.pi * X / 8.0)  # ondulación de 8 mm
    mascara = np.ones_like(curva, bool)
    s = suavizar(curva + onda, 3.0, mascara, 0.5, 6.0)
    centro = (np.abs(X - 60) < 30) & (np.abs(Y - 60) < 30)
    assert np.abs(s - curva)[centro].max() < 0.2  # la onda de ±0,4 mm desaparece; la curva queda
