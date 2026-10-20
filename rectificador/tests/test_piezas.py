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


SIGNOS = {"arco": 1, "oliva": -1, "barra": -1, "descarga_1mtt": 1, "descarga_5mtt": 1, "descarga_sesamoideos": 1,
          "espolon": 1, "canal_fascia": 1, "navicular": -1, "cuboides": -1, "cuna_ant": -1, "cuna_post": -1,
          "skive": -1, "alza": -1, "expansion_talon": 1}


def test_estan_todas():
    assert set(SIGNOS) == set(P.TIPOS) == set(P.NOMBRES) == set(P.COLORES)


@pytest.mark.parametrize("tipo, signo", SIGNOS.items())
def test_cada_pieza_con_su_signo_y_solo_en_su_pie(proyecto, tipo, signo):
    p = proyecto
    for k, pie in enumerate(p.pies):
        d, pieza = _efecto(p, pie, tipo)
        minimo = 0.3 if tipo == "expansion_talon" else 0.5 * pieza.altura  # (la expansión va en %)
        assert (d * signo).max() > minimo, tipo  # llega casi a la altura pedida
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
        if tipo in P._CORTES:
            # Cortes que llegan a la pared del pie (skive, cuñas, alza, expansión): el molde no queda más
            # empinado que antes.
            # (La expansión empuja la pared hacia fuera dentro del margen de la huella: algo más vertical.)
            margen = 2.0 if tipo == "expansion_talon" else 0.2
            assert np.hypot(*np.gradient(np.maximum(base + d, p.fondo), 1.0)).max() <= pendiente_base + margen, tipo
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


def test_barra_bajo_todas_las_cabezas_y_curvada_como_el_recorte(proyecto):
    from ortomolde import recorte as R

    p = proyecto
    pie = p.pies[0]
    refs = pie.referencias
    r = p.original.rejilla
    X, Y = r.malla()
    tt, ss = R.coordenadas_arco(refs, X, Y)
    d, barra = _efecto(p, pie, "barra")
    perfil = R._perfil(refs, pie.recorte)
    lejos_del_borde = ndimage_distancia(pie.mascara) > 10
    # De la 1.ª a la 5.ª cabeza (y más allá), con la misma altura, y siguiendo la curva del recorte.
    for t0 in (0.0, 0.2, 0.5, 0.8, 1.0):
        sel = (np.abs(tt - t0) < 0.02) & lejos_del_borde
        k = np.argmin(d[sel])
        assert -d[sel][k] == pytest.approx(barra.altura, abs=0.15), t0
        assert ss[sel][k] == pytest.approx(float(perfil(t0)) - barra.retraso, abs=1.0), t0
    # Con el recorte recto, la barra también es recta (y con más curvatura, más curvada).
    curv = pie.recorte.curvatura
    try:
        pie.recorte.curvatura = 2.0
        d2, _ = _efecto(p, pie, "barra")
        assert not np.allclose(d, d2)
    finally:
        pie.recorte.curvatura = curv


def ndimage_distancia(mascara):
    from scipy import ndimage

    return ndimage.distance_transform_edt(mascara)


@pytest.mark.parametrize("sentido", ["varo", "valgo"])
def test_skive_como_kirby(proyecto, sentido):
    """Plano a 15°: `altura` mm de hondo en la línea a 1/3 del ancho del talón, más hondo hacia el lado del
    skive y nada más allá de donde el plano sale de la superficie; solo en la cazoleta del talón."""
    p = proyecto
    pie = p.pies[0]
    r = p.original.rejilla
    X, Y = r.malla()
    sk = pie.piezas["skive"]
    d, _ = _efecto(p, pie, "skive", sentido=sentido, altura=4.0)
    sk.sentido = "varo"
    g = P._geometria_local(sk.copia() if sentido == "varo" else P.Pieza("skive", sentido="valgo", largo=sk.largo),
                           pie.referencias, pie.mascara, r.dx, r.dy, p.clinicos["referencias"])
    sis = g["sis"]
    u, v = sis.a_local(X, Y)
    lado = -1 if sentido == "valgo" else 1
    cerca = pie.mascara & (np.abs(u - (-g["atras"] + 15)) < 1.0)  # una franja del talón
    en_ref = cerca & (np.abs(v - g["vref"]) < 1.0)
    assert -d[en_ref].mean() == pytest.approx(4.0, abs=1.0)  # 4 mm en la línea W/3
    # El corte es un plano a 15° que baja hacia el lado del skive (4 mm más allá, ~1 mm más bajo).
    base = _molde_sin_piezas(p)
    hecho = base + d
    mas_alla = cerca & (np.abs(v - (g["vref"] + lado * 4)) < 1.0)
    assert hecho[mas_alla].mean() < hecho[en_ref].mean() - 0.5
    sale = 4.0 / np.tan(np.radians(15))  # el plano sale de la superficie a ~15 mm
    otro_lado = cerca & (lado * (v - g["vref"]) < -(sale + 4))
    assert np.abs(d[otro_lado]).max() < 0.5  # (esquina redondeada)
    # Solo hasta el borde anterior de la cazoleta (largo desde atrás).
    delante = pie.mascara & (u > -g["atras"] + g["largo"] + 1)
    assert np.abs(d[delante]).max() < 1e-6


def test_cunas_varo_y_valgo(proyecto):
    p = proyecto
    pie = p.pies[0]
    r = p.original.rejilla
    X, Y = r.malla()
    sis = pie.referencias.sistema()
    u, v = sis.a_local(X, Y)
    for tipo, zona in (("cuna_post", pie.mascara & (np.abs(u) < 5)), ("cuna_ant", pie.mascara & (np.abs(u - sis.largo) < 5))):
        d_varo, _ = _efecto(p, pie, tipo, sentido="varo", altura=5.0)
        d_valgo, _ = _efecto(p, pie, tipo, sentido="valgo", altura=5.0)
        medial, lateral = zona & (v > 10), zona & (v < -10)
        # Varo: se quita escayola del lado interno (la plantilla sube por dentro); valgo, al revés.
        assert d_varo[medial].mean() < d_varo[lateral].mean() - 1, tipo
        assert d_valgo[lateral].mean() < d_valgo[medial].mean() - 1, tipo
    pie.piezas["cuna_post"].sentido = pie.piezas["cuna_ant"].sentido = "varo"


def _molde_sin_piezas(p):
    activas = {(k, t) for k, pie in enumerate(p.pies) for t, q in pie.piezas.items() if q.activa}
    for pie in p.pies:
        for q in pie.piezas.values():
            q.activa = False
    z = p.calcular().z.copy()
    for k, t in activas:
        p.pies[k].piezas[t].activa = True
    return z
