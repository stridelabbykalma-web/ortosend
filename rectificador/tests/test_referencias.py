import numpy as np
import pytest

from ortomolde.campo import campo_a_malla
from ortomolde.proyecto import Proyecto
from ortomolde.referencias import Referencias
from ortomolde.sintetico import malla_bruta


@pytest.fixture(scope="module")
def proyecto_bruto(tmp_path_factory, taller):
    t = {**taller, "calculo": {"rejilla": 1.0}}
    ruta = tmp_path_factory.mktemp("bruto") / "bruto.stl"
    malla_bruta(t, 1.0).export(ruta)
    return Proyecto.abrir(ruta, t)


def _referencias_tipicas(pie, campo):
    """Referencias aproximadas a partir de la máscara: talón atrás, cabezas a ~70 %."""
    jj, ii = np.nonzero(pie.mascara)
    y0, y1 = jj.min(), jj.max()
    x_med = ii.mean()
    r = campo.rejilla
    talon = (x_med * r.dx, (y0 + 0.08 * (y1 - y0)) * r.dy)
    fila = int(y0 + 0.70 * (y1 - y0))
    xs = np.nonzero(pie.mascara[fila])[0]
    a, b = xs.min() + 8, xs.max() - 8
    # Pie izquierdo (planta arriba, dedos a +Y): lado interno hacia -X.
    interno, externo = (a, b) if pie.lado == "izquierdo" else (b, a)
    return {"talon": talon, "mtt1": (interno * r.dx, fila * r.dy), "mtt5": (externo * r.dx, (fila - 15) * r.dy)}


def test_pies_detectados(proyecto_bruto):
    lados = sorted(p.lado for p in proyecto_bruto.pies)
    assert lados == ["derecho", "izquierdo"]
    izq = proyecto_bruto.pie("izquierdo")
    assert np.nonzero(izq.mascara)[1].mean() * proyecto_bruto.original.rejilla.dx < 144


def test_sistema_del_pie_medial_y_espejo():
    izq = Referencias({"talon": (70, 60), "mtt1": (50, 230), "mtt5": (105, 215)}).sistema()
    der = Referencias({"talon": (218, 60), "mtt1": (238, 230), "mtt5": (183, 215)}).sistema()
    # En los dos pies el 1.er MTT queda en v > 0 (lado interno) y a la misma distancia.
    for s, m1 in ((izq, (50, 230)), (der, (238, 230))):
        u, v = s.a_local(*m1)
        assert v > 0 and u > 100
    assert np.allclose(izq.a_local(50, 230), der.a_local(238, 230))
    x, y = izq.a_global(*izq.a_local(80, 150))
    assert np.allclose((x, y), (80, 150))


def test_poner_referencias_en_orden(proyecto_bruto):
    p = proyecto_bruto
    pie = p.pie("izquierdo")
    refs = _referencias_tipicas(pie, p.original)
    for nombre in ("mtt1", "mtt5", "talon"):
        devuelto = p.poner_referencia(*refs[nombre])
        assert devuelto == (pie, nombre)
    assert pie.referencias.completas
    assert p.poner_referencia(5.0, 5.0) is None  # fuera de los pies


def test_geometria(proyecto_bruto):
    p = proyecto_bruto
    pie = p.pie("izquierdo")
    if not pie.referencias.completas:
        for k, v in _referencias_tipicas(pie, p.original).items():
            pie.referencias.puntos[k] = v
    g = p.geometria(pie)
    s = pie.referencias.sistema()
    _, v_med = s.a_local(*g["talon_medial"])
    _, v_lat = s.a_local(*g["talon_lateral"])
    assert v_med > 15 and v_lat < -15
    # La zona del arco queda en el lado interno.
    vs = [s.a_local(*q)[1] for q in g["zona_arco"]]
    assert min(vs) >= -1e-6 and max(vs) > 10


def test_intercambiar_lados_mueve_pies_y_referencias(proyecto_bruto):
    p = proyecto_bruto
    pie = p.pie("izquierdo")
    for k, v in _referencias_tipicas(pie, p.original).items():
        pie.referencias.puntos[k] = v
    talon_antes = np.array(pie.referencias.puntos["talon"])
    altura_antes = p.altura_en(*talon_antes)
    p.intercambiar_lados()
    movido = p.pie("derecho")
    talon_despues = np.array(movido.referencias.puntos["talon"])
    assert talon_despues[0] > 144 > talon_antes[0]  # ha pasado a la otra mitad
    assert p.altura_en(*talon_despues) == pytest.approx(altura_antes, abs=0.01)
    p.intercambiar_lados()  # volver como estaba


def test_receta_con_referencias(proyecto_bruto):
    receta = proyecto_bruto.receta()
    assert {d["lado"] for d in receta["pies"]} == {"izquierdo", "derecho"}
    for d in receta["pies"]:
        for x, y, z in d["referencias_taller"].values():
            assert z <= 0  # Z0 en la cara superior del bloque


def test_eje_sale_entre_2_y_3_metatarsiano():
    base = {"talon": (70.0, 60.0), "mtt1": (50.0, 230.0), "mtt5": (105.0, 215.0)}
    con = Referencias(dict(base, mtt2=(62.0, 236.0), mtt3=(76.0, 236.0))).sistema()
    delante = np.array([69.0, 236.0])
    assert con.largo == pytest.approx(np.linalg.norm(delante - [70, 60]))
    assert np.allclose(con.a_global(con.largo, 0), delante)
    sin = Referencias(base).sistema()
    esperado = np.array([50, 230]) + 0.375 * (np.array([105, 215]) - [50, 230])
    assert np.allclose(sin.a_global(sin.largo, 0), esperado)
    assert sin.a_local(50, 230)[1] > 0  # el 1.er MTT sigue en el lado interno
