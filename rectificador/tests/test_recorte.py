import numpy as np
import pytest

from ortomolde.campo import Rejilla
from ortomolde.recorte import Recorte, aplicar, coordenadas_arco, linea_del_arco
from ortomolde.referencias import Referencias

REFS = Referencias({"talon": (70.0, 60.0), "mtt1": (50.0, 230.0), "mtt5": (105.0, 215.0)})


@pytest.fixture
def plano():
    r = Rejilla.para_recuadro(144, 330, 0.5)
    X, Y = r.malla()
    z = np.full(X.shape, 3.0)
    mascara = (X > 20) & (X < 125) & (Y > 30) & (Y < 300)
    z[mascara] = 25.0
    return r, X, Y, z, mascara


def test_delante_del_arco_queda_la_base(plano):
    r, X, Y, z, mascara = plano
    rec = Recorte(adelanto=3.0, curvatura=1.0, flecha=10.0, posicion_vertice=0.35)
    z2 = aplicar(z, 3.0, REFS, rec, mascara, X, Y, 0.5)
    t, s = coordenadas_arco(REFS, X, Y)
    # 3 mm por delante de las cabezas (en t = 0 y t = 1 la parábola no sobresale).
    for x, y, esperado in ((50, 230 + 1.5, 25.0), (50, 230 + 5.0, 3.0), (105, 215 + 1.5, 25.0), (105, 215 + 5, 3.0)):
        j, i = int(round(y / 0.5)), int(round(x / 0.5))
        assert z2[j, i] == pytest.approx(esperado)
    # El vértice de la parábola sobresale 10 mm: allí aún hay molde 10 mm por delante de la línea.
    assert z2[(np.abs(t - 0.35) < 0.01) & (np.abs(s - 11.0) < 0.3)].min() == pytest.approx(25.0)
    assert (z2[(s > 20) & mascara] == 3.0).all()
    entre = (t >= 0) & (t <= 1)
    assert (z2[(s < -1) & entre] == z[(s < -1) & entre]).all()  # detrás del arco no se toca nada
    # Fuera de las cabezas el arco solo cae hacia atrás suavemente (≤ 0,5 mm por mm).
    cuerda = np.hypot(55, 15)
    for tt in (-0.3, 1.3):
        cae = 0.3 * cuerda * 0.5
        assert z2[(np.abs(t - tt) < 0.01) & (np.abs(s - (3.0 - cae - 1.0)) < 0.3) & mascara].min() == pytest.approx(25.0)


def test_adelanto_y_curvatura(plano):
    r, X, Y, z, mascara = plano
    recto = aplicar(z, 3.0, REFS, Recorte(adelanto=0.0, curvatura=0.0), mascara, X, Y, 0.5)
    adelantado = aplicar(z, 3.0, REFS, Recorte(adelanto=10.0, curvatura=0.0), mascara, X, Y, 0.5)
    assert (adelantado > 3.0).sum() > (recto > 3.0).sum()
    inactivo = aplicar(z, 3.0, REFS, Recorte(activo=False), mascara, X, Y, 0.5)
    assert np.array_equal(inactivo, z)


def test_linea_del_arco_dentro_del_pie(plano):
    r, X, Y, z, mascara = plano
    pts = linea_del_arco(REFS, Recorte(), mascara, 0.5, 0.5)
    assert len(pts) > 20
    xs = [p[0] for p in pts]
    assert min(xs) < 30 and max(xs) > 115  # cruza el pie de lado a lado


def test_arco_pasa_por_delante_de_las_5_cabezas(plano):
    r, X, Y, z, mascara = plano
    refs = Referencias(dict(REFS.puntos, mtt2=(65.0, 238.0), mtt3=(80.0, 236.0), mtt4=(93.0, 226.0)))
    rec = Recorte(adelanto=3.0)
    z2 = aplicar(z, 3.0, refs, rec, mascara, X, Y, 0.5)
    e = refs.sistema().eje
    for k in ("mtt1", "mtt2", "mtt3", "mtt4", "mtt5"):
        p = np.array(refs.puntos[k])
        for d, esperado in ((1.5, 25.0), (5.0, 3.0)):  # 1,5 mm delante queda molde; 5 mm ya no
            x, y = p + d * e
            j, i = int(round(y / 0.5)), int(round(x / 0.5))
            assert z2[j, i] == pytest.approx(esperado, abs=0.5), (k, d)


def test_curvatura_cero_es_recto_aunque_haya_5_cabezas(plano):
    r, X, Y, z, mascara = plano
    refs5 = Referencias(dict(REFS.puntos, mtt2=(65.0, 238.0), mtt3=(80.0, 236.0)))
    z2 = aplicar(z, 3.0, refs5, Recorte(adelanto=3.0, curvatura=0.0), mascara, X, Y, 0.5)
    t, s = coordenadas_arco(refs5, X, Y)
    entre = (t > 0.05) & (t < 0.95) & mascara
    assert (z2[entre & (s < 2.0)] == 25.0).all()  # todo queda hasta 3 mm delante de la línea 1.º-5.º
    assert (z2[entre & (s > 4.0)] == 3.0).all()
