import numpy as np
import pytest

from ortomolde.limpieza import limpiar, rectangulo_minimo, rellenar_agujeros
from ortomolde.sintetico import campo_limpio_esperado, malla_bruta


def error_por_mitades(a, b):
    """Error entre dos campos, permitiendo que cada pie esté desplazado ±1 celda
    (al centrar el pie en su mitad puede caer una celda más allá)."""
    mitad = a.shape[1] // 2
    errores = []
    for lado in (slice(0, mitad), slice(mitad, None)):
        mejor = None
        for dj in (-1, 0, 1):
            for di in (-1, 0, 1):
                e = np.abs(np.roll(a[:, lado], (dj, di), axis=(0, 1)) - b[:, lado])
                if mejor is None or e.mean() < mejor.mean():
                    mejor = e
        errores.append(mejor)
    return np.concatenate(errores, axis=1)


@pytest.fixture(scope="module")
def taller_1mm(taller):
    return {**taller, "calculo": {"rejilla": 1.0}}


@pytest.fixture(scope="module")
def limpio(taller_1mm):
    return limpiar(malla_bruta(taller_1mm, 1.0), taller_1mm)


def test_bruto_a_limpio(limpio, taller_1mm):
    campo, informe = limpio
    esperado = campo_limpio_esperado(taller_1mm, 1.0)
    assert campo.z.shape == esperado.z.shape
    error = error_por_mitades(campo.z, esperado.z)
    assert error.mean() < 0.2
    assert np.percentile(error, 95) < 1.0
    assert informe.avisos == []


def test_lados_y_orientacion(limpio):
    _, informe = limpio
    lados = {p["lado"]: p["mitad"] for p in informe.pies}
    assert lados == {"izquierdo": "izquierda", "derecho": "derecha"}
    assert informe.n_bloques == 2


def test_base_plana_y_limite(limpio, taller_1mm):
    campo, _ = limpio
    base = taller_1mm["limpieza"]["base"]
    assert campo.z.min() == pytest.approx(base)
    assert campo.z.max() <= taller_1mm["recuadro"]["alto_z"]


def test_lados_forzados(taller_1mm):
    malla = malla_bruta(taller_1mm, 1.0)
    _, informe = limpiar(malla, taller_1mm, lados={0: "derecho", 1: "izquierdo"})
    assert {p["lado"] for p in informe.pies} == {"izquierdo", "derecho"}


def test_rectangulo_minimo_girado():
    rng = np.random.default_rng(0)
    p = rng.uniform([0, 0], [100, 300], (2000, 2))
    a = np.radians(30)
    p = p @ np.array([[np.cos(a), np.sin(a)], [-np.sin(a), np.cos(a)]])
    _, _, _, ancho, largo = rectangulo_minimo(p)
    assert ancho == pytest.approx(100, abs=1) and largo == pytest.approx(300, abs=1)


def test_rellenar_agujeros_plano():
    yy, xx = np.mgrid[0:30, 0:30]
    z = 0.5 * xx + 0.2 * yy
    hueco = (xx - 15) ** 2 + (yy - 15) ** 2 < 25
    z2 = z.copy()
    z2[hueco] = 0
    assert np.allclose(rellenar_agujeros(z2, hueco), z, atol=1e-6)


def test_bruto_a_limpio_resolucion_real(taller):
    # Con la rejilla real (0,5 mm) la mesa tiene más área que la cara de los bloques
    # en número de caras: comprueba que no se confunde de plano.
    campo, informe = limpiar(malla_bruta(taller, 0.5), taller)
    esperado = campo_limpio_esperado(taller, 0.5)
    assert error_por_mitades(campo.z, esperado.z).mean() < 0.2
    assert informe.avisos == []


def test_bloques_con_distinta_inclinacion(taller_1mm):
    # En los escaneos reales cada bloque está apoyado con una inclinación algo distinta.
    campo, informe = limpiar(malla_bruta(taller_1mm, 1.0, inclinar_derecho=3.0), taller_1mm)
    esperado = campo_limpio_esperado(taller_1mm, 1.0)
    assert informe.n_bloques == 2
    assert error_por_mitades(campo.z, esperado.z).mean() < 0.3


@pytest.mark.parametrize("modo", ["huellas", "moldes"])
@pytest.mark.parametrize("un_pie", [False, True])
def test_modos_con_uno_o_dos_pies(taller_1mm, modo, un_pie):
    campo, informe = limpiar(malla_bruta(taller_1mm, 1.0, modo=modo, un_pie=un_pie), taller_1mm, modo=modo)
    esperado = campo_limpio_esperado(taller_1mm, 1.0, un_pie=un_pie)
    assert informe.modo == modo
    assert len(informe.pies) == (1 if un_pie else 2)
    assert error_por_mitades(campo.z, esperado.z).mean() < 0.25
    if un_pie:
        assert informe.pies[0]["lado"] == "izquierdo"


def test_modo_equivocado_sugiere_el_otro(taller_1mm):
    with pytest.raises(ValueError, match="Prueba el modo «Moldes»"):
        limpiar(malla_bruta(taller_1mm, 1.0, modo="moldes"), taller_1mm, modo="huellas")
