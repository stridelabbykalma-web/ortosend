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
