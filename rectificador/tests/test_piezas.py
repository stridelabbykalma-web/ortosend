import numpy as np
import pytest

from ortomolde import piezas as P
from ortomolde.proyecto import Proyecto


@pytest.fixture(scope="module")
def proyecto(stl_sintetico, taller):
    p = Proyecto.abrir(stl_sintetico, {**taller, "calculo": {"rejilla": 1.0}})
    for pie in p.pies:
        p.proponer_referencias(pie)
        pie.recorte.activo = False
    return p


def _efecto(p, pie, tipo, **cambios):
    for q in pie.piezas.values():
        q.activa = False
    base = p.calcular().z.copy()
    pieza = pie.piezas[tipo]
    pieza.activa = True
    for k, v in cambios.items():
        setattr(pieza, k, v)
    try:
        return p.calcular().z - base, pieza
    finally:
        pieza.activa = False


@pytest.mark.parametrize("tipo, signo", [("arco", 1), ("oliva", -1), ("barra", -1), ("descarga_1mtt", 1),
                                          ("skive", -1)])
def test_cada_pieza_con_su_signo_y_solo_en_su_pie(proyecto, tipo, signo):
    p = proyecto
    for k, pie in enumerate(p.pies):
        d, pieza = _efecto(p, pie, tipo)
        assert (d * signo).max() > 0.5 * pieza.altura  # llega casi a la altura pedida
        assert (d * signo).min() > -1e-6  # y nunca al revés
        otro = p.pies[1 - k].mascara
        assert np.abs(d[otro & ~pie.mascara]).max() < 1e-9  # el otro pie no se toca
        assert np.abs(d[~pie.mascara]).max() < 1e-9  # ni la base


def test_bordes_suaves(proyecto):
    p = proyecto
    base = p.calcular().z.copy()
    pendiente_base = np.hypot(*np.gradient(base, 1.0)).max()
    for tipo in P.TIPOS:
        d, pieza = _efecto(p, p.pies[0], tipo)
        if tipo == "skive":
            # Corte en plano que baja hasta la base por la pared del talón: el molde no queda más
            # empinado que antes.
            assert np.hypot(*np.gradient(base + d, 1.0)).max() <= pendiente_base + 0.2
            continue
        gy, gx = np.gradient(d, 1.0)
        # Sin escalones: la pendiente del cambio es moderada (mm por mm). Lo más empinado es la rampa de
        # 2 mm junto al borde del pie (el arco llega casi entero al borde interno).
        assert np.hypot(gx, gy).max() < 1.3, tipo


def test_arco_en_los_dos_sentidos_y_en_el_lado_interno(proyecto):
    p = proyecto
    pie = p.pies[0]
    d_rebajar, _ = _efecto(p, pie, "arco", sentido="rebajar")
    d_subir, _ = _efecto(p, pie, "arco", sentido="subir")
    # Iguales y de signo contrario, salvo donde «subir» llegaría por debajo de la base (no puede).
    base = p.calcular().z
    hay_sitio = base - p.fondo > pie.piezas["arco"].altura + 0.1
    assert np.allclose(d_rebajar[hay_sitio], -d_subir[hay_sitio])
    assert (p.calcular().z >= p.fondo - 1e-9).all()
    # El arco va hacia el 1.er MTT (lado interno), no hacia el 5.º.
    sis = pie.referencias.sistema()
    jj, ii = np.nonzero(np.abs(d_rebajar) > 0.5)
    u, v = sis.a_local(ii * 1.0, jj * 1.0)
    assert np.mean(v) > 0
    pie.piezas["arco"].sentido = "rebajar"


def test_mover_una_pieza_a_mano(proyecto):
    p = proyecto
    pie = p.pies[0]
    r = p.original.rejilla
    c0 = P.centro(pie.piezas["oliva"], pie.referencias, pie.mascara, r.dx, r.dy, p.clinicos["referencias"])
    pie.piezas["oliva"].du = -10
    c1 = P.centro(pie.piezas["oliva"], pie.referencias, pie.mascara, r.dx, r.dy, p.clinicos["referencias"])
    pie.piezas["oliva"].du = 0
    assert np.hypot(c1[0] - c0[0], c1[1] - c0[1]) == pytest.approx(10, abs=0.01)
    # Hacia el talón: se acerca al talón.
    t = np.array(pie.referencias.puntos["talon"])
    assert np.linalg.norm(np.array(c1) - t) < np.linalg.norm(np.array(c0) - t)


def test_receta_guarda_las_piezas(proyecto):
    proyecto.pies[0].piezas["skive"].activa = True
    receta = proyecto.receta()
    proyecto.pies[0].piezas["skive"].activa = False
    piezas = receta["pies"][0]["piezas"]
    assert set(piezas) == set(P.TIPOS) and piezas["skive"]["activa"]
    assert P.Pieza.de_dict(piezas["skive"]) == P.Pieza(**piezas["skive"])


def test_sin_referencias_no_hace_nada(stl_sintetico, taller):
    p = Proyecto.abrir(stl_sintetico, {**taller, "calculo": {"rejilla": 1.0}})
    base = p.calcular().z.copy()
    for q in p.pies[0].piezas.values():
        q.activa = True
    assert np.array_equal(p.calcular().z, base)


def test_si_no_cabe_se_quita_por_abajo(stl_sintetico, taller):
    """Un molde más alto que el bloque baja entero: lo que sobra sale de la base, no de la planta."""
    p = Proyecto.abrir(stl_sintetico, {**taller, "calculo": {"rejilla": 1.0}})
    z0 = p.calcular().z
    assert p.bajada == 0 and p.fondo_molde == p.fondo
    alto = float(z0.max()) - 1.5
    p.taller = {**p.taller, "recuadro": {**p.taller["recuadro"], "alto_z": alto}}
    z = p.calcular().z
    assert p.bajada == pytest.approx(1.5) and z.max() == pytest.approx(alto)
    assert p.fondo_molde == pytest.approx(p.fondo - 1.5)
    assert np.allclose(z - p.fondo_molde, z0 - p.fondo)  # el relieve no cambia
    assert any("por abajo" in a for a in p.avisos)


def test_tamano_segun_la_medida_del_pie(proyecto):
    """Con «Adaptar», en un pie más pequeño la pieza es más pequeña (la altura es la misma)."""
    p = proyecto
    pie = p.pies[0]
    cfg = p.clinicos["referencias"]
    f = P.escala(pie.referencias, cfg)
    assert f == pytest.approx(pie.referencias.sistema().largo / cfg["pie_medio"])
    oliva = pie.piezas["oliva"]
    assert oliva.adaptar and oliva.medidas(f) == pytest.approx((oliva.largo * f, oliva.ancho * f))
    d_medio, _ = _efecto(p, pie, "oliva")
    try:
        cfg["pie_medio"] = pie.referencias.sistema().largo / 0.7  # como si el pie fuera un 70 % de uno medio
        d_peq, _ = _efecto(p, pie, "oliva")
        assert P.escala(pie.referencias, cfg) == pytest.approx(0.7)
    finally:
        cfg["pie_medio"] = 175.0
    area_medio, area_peq = (np.abs(d_medio) > 0.5).sum(), (np.abs(d_peq) > 0.5).sum()
    assert area_peq == pytest.approx(area_medio * (0.7 / f) ** 2, rel=0.25)
    assert abs(d_peq).max() == pytest.approx(abs(d_medio).max(), abs=0.3)
    # Sin «Adaptar», los mm son fijos.
    oliva.adaptar = False
    assert oliva.medidas(0.7) == (oliva.largo, oliva.ancho)
    oliva.adaptar = True


def test_trabajos_antiguos_no_cambian():
    viejo = {"tipo": "oliva", "activa": True, "altura": 5.0, "largo": 25.0, "ancho": 20.0}
    assert P.Pieza.de_dict(viejo).adaptar is False
    assert P.Pieza("oliva").adaptar is True
