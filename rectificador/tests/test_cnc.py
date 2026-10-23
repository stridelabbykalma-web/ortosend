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
    return lambda nombre: cnc.piezas_de_molde(c.z, p.fondo_molde, [q.mascara for q in p.pies],
                                              [f"{nombre} {q.lado}" for q in p.pies], 1.0, taller["cnc"])


def _movimientos(gcode):
    pos = {"X": 0.0, "Y": 0.0, "Z": 15.0}
    for linea in gcode.splitlines():
        if linea.startswith(("G0 ", "G1 ")):
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
        # Pie + su margen para el contorno (su forma real) sin pisar a otro, y todo lo que corta la fresa
        # (otro margen más) dentro de la plancha.
        assert p.x - 2 * m >= 0 and p.y - 2 * m >= 0 and p.x + b + 2 * m <= 601 and p.y + a + 2 * m <= 501
        ocupado[p.y - m:p.y + a + m, p.x - m:p.x + b + m] += cnc.zona(p, m)
    assert ocupado.max() == 1
    # Encajan por su forma: más juntos que si fueran rectángulos (algún par de recuadros se pisa).
    assert any(cnc._se_pisan(cnc.huella(p, m), cnc.huella(q, m)) for p in puestas for q in puestas if p is not q)


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
    # Por cada pie: desbaste, acabado y contorno, en ese orden (como Fusion).
    fases = [l for l in lineas if l.startswith(("(2D", "(Desbaste", "(Paralelo"))]
    assert [f.split()[0] for f in fases] == ["(Desbaste"] * 4 + ["(Paralelo"] * 4 + ["(2D"] * 4


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
        jj, ii = np.mgrid[max(j0 - r, 0):min(j0 + r + 1, alt.shape[0]), max(i0 - r, 0):min(i0 + r + 1, alt.shape[1])]
        d = np.hypot(ii * paso - x, jj * paso - y)
        m = d < R
        peor = max(peor, float((alt[jj[m], ii[m]] - (z + R - np.sqrt(R * R - d[m] ** 2))).max()))
    assert n > 100 and peor <= 0.1
    # Cuatro recorridos cerrados, uno por pie, que rodean cada silueta.
    assert len(tirada.contornos) == 4
    for c in tirada.contornos:
        assert np.allclose(c[0], c[-1])


def test_capas_y_lineas_como_se_ha_pedido(tirada, cfg):
    zs_desbaste, ys_acabado = set(), []
    for fase, tipo, a, b in _por_fase(tirada.gcode):
        if fase == "Desbaste" and tipo == "G1":
            zs_desbaste.add(round(b["Z"], 3))
        if fase == "Paralelo" and tipo == "G1" and a["Y"] == b["Y"]:
            ys_acabado.append(round(b["Y"], 3))
    # Primera capa del desbaste a -5 mm.
    assert -cfg["bajada_por_pasada"] in zs_desbaste
    # Líneas del acabado paralelas a X, separadas paso_acabado (en una rejilla de 1 mm: 2 mm).
    # (líneas seguidas de un mismo pie: cada pie va a su altura en la plancha)
    ys = np.array(ys_acabado)
    saltos = np.abs(np.diff(ys))
    assert np.median(saltos[saltos > 0]) == pytest.approx(round(cfg["paso_acabado"]), abs=0.01)
    assert tirada.tiempo_min > 0 and set(tirada.tiempos) >= {"contorno", "desbaste", "acabado"}


def test_plancha_pequena_avisa_lo_que_no_cabe(piezas_sinteticas, cfg):
    t = cnc.generar(piezas_sinteticas("A"), 230, 330, 40, 1.0, 12.5, cfg)
    assert len(t.piezas) == 1 and len(t.sobran) == 1
    assert any("No caben 1" in a for a in t.avisos)


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
        assert f" - Pieza {f.numero}: {cnc.texto_cnc(f.nombre)}" in tirada.gcode
        assert 0 <= f.x[0] < f.x[1] <= 600 and 0 <= f.y[0] < f.y[1] <= 500
        assert abs(np.hypot(*f.dedos) - 1) < 1e-6
        if f.pieza.giro == 0:
            assert f.dedos[1] > 0.9  # los dedos hacia +Y si no se ha girado
    png, pdf = mapa.guardar(tirada, tmp_path / "TIRADA", "TIRADA", 25)
    assert png.stat().st_size > 20000 and pdf.read_bytes().startswith(b"%PDF")


def test_vista_previa_igual_que_el_nc(piezas_sinteticas, cfg):
    """La vista previa coloca y numera los pies igual que quedarán en el .nc."""
    piezas = piezas_sinteticas("A") + piezas_sinteticas("B")
    previa = cnc.previsualizar(piezas, 600, 500, 40, 1.0, 12.5, cfg)
    assert previa.previa and previa.gcode == "" and len(previa.fichas) == 4
    antes = [(f.numero, f.nombre, f.x, f.y) for f in previa.fichas]
    t = cnc.generar(piezas, 600, 500, 40, 1.0, 12.5, cfg, colocar_antes=False)
    assert [(f.numero, f.nombre, f.x, f.y) for f in t.fichas] == antes
    from ortomolde import mapa
    assert mapa.png(previa, "PRUEBA", 25, dpi=50, resaltar=2).startswith(b"\x89PNG")


def test_colocar_a_mano(piezas_sinteticas, cfg):
    R, paso = 12.5, 1.0
    piezas = piezas_sinteticas("A") + piezas_sinteticas("B")
    cnc.colocar(piezas, 600, 500, paso, cfg, R)
    a = piezas[0]
    m = cnc.margen_celdas(R, paso, cfg)
    # Fuera de la plancha y encima de otra: no cabe.
    assert "plancha" in cnc.cabe(a, piezas, 600, 500, paso, cfg, R, 0, 0, 0)
    b = piezas[1]
    assert "cerca" in cnc.cabe(a, piezas, 600, 500, paso, cfg, R, b.x + 5, b.y, a.giro)
    # Puesta a mano (girada 180°) en la esquina de detrás a la derecha: se respeta y las demás no la pisan.
    ny, nx = a.forma(2)
    x, y = 600 - nx - 2 * m, 500 - ny - 2 * m
    assert cnc.cabe(a, [], 600, 500, paso, cfg, R, x, y, 2) is None
    a.x, a.y, a.giro, a.fija = x, y, 2, True
    avisos = []
    sobran = cnc.colocar(piezas, 600, 500, paso, cfg, R, avisos)
    assert not sobran and not avisos and (a.x, a.y, a.giro) == (x, y, 2)
    for p in piezas:
        assert p is a or cnc.cabe(p, piezas, 600, 500, paso, cfg, R, p.x, p.y, p.giro) is None
    # El .nc respeta la posición puesta a mano.
    t = cnc.generar(piezas, 600, 500, 40, paso, R, cfg, colocar_antes=False)
    f = next(f for f in t.fichas if f.pieza is a)
    assert f.x[0] == x * paso and f.y[0] == y * paso and f.dedos[1] < -0.9  # girado: dedos hacia delante
    # Con una plancha más pequeña ya no cabe ahí: se suelta y se avisa.
    avisos = []
    cnc.colocar(piezas, 400, 500, paso, cfg, R, avisos)
    assert not a.fija and avisos and "ya no cabe" in avisos[0]


def test_prueba_en_vacio(tirada):
    vacio = cnc.en_vacio(tirada.gcode, 5.0)
    normal = [p for _, p in _movimientos(tirada.gcode)][1:]
    alto = [p for _, p in _movimientos(vacio)][1:]
    assert len(normal) == len(alto)
    sube = alto[0]["Z"] - normal[0]["Z"]
    assert sube > 30  # el programa baja más de 30 mm dentro de la plancha
    for a, b in zip(normal, alto):
        assert b["X"] == a["X"] and b["Y"] == a["Y"] and b["Z"] == pytest.approx(a["Z"] + sube, abs=1e-3)
    assert min(p["Z"] for p in alto) == pytest.approx(5.0, abs=1e-3)  # nunca toca la plancha
    assert "M3" not in [l for l in vacio.splitlines() if not l.startswith("(")]  # cabezal apagado
    vacio.encode("ascii")


def test_donde_no_llega_la_fresa():
    y, x = np.mgrid[0:200, 0:200] * 0.5
    h = np.full(x.shape, 10.0)
    estrecho = (np.abs(x - 30) < 5) & (np.abs(y - 50) < 20)
    h[estrecho] = 5.0  # hueco de 10 mm de ancho: la bola de 25 no entra hasta el fondo
    h += 8 * np.exp(-((x - 70) ** 2 + (y - 50) ** 2) / 400)  # cúpula suave: llega a todo
    d = cnc.donde_no_llega(h, 12.5, 0.5)
    assert d[estrecho].max() > 3
    assert d[np.hypot(x - 70, y - 50) < 15].max() < 0.05
    # La superficie fresada nunca queda por debajo del molde.
    assert (cnc.superficie_fresada(h, 12.5, 0.5) >= h - 1e-9).all()


def test_pie_muy_alto_se_recorta_por_abajo(cfg):
    """Si un pie no cabe en la plancha se le quita lo que sobra por abajo: la planta queda igual."""
    yy, xx = np.mgrid[0:80, 0:40]
    sil = (np.hypot((xx - 20) / 18, (yy - 40) / 38) < 1)
    h = np.where(sil, 10 + 30 * (1 - np.hypot((xx - 20) / 18, (yy - 40) / 38)), 0.0)  # hasta 40 mm
    p = cnc.Pieza("alto", h.copy(), sil, 1.0)
    avisos = cnc.ajustar_alto([p], 40.0, cfg)
    maximo = 40 - cfg["rebaje_superior"] - cfg["suelo_minimo"] - 0.5
    assert avisos and "por abajo" in avisos[0]
    assert p.alto == pytest.approx(maximo)
    sobra = h.max() - maximo
    assert np.allclose(p.h[sil], np.maximum(h[sil] - sobra, 0))  # misma forma, bajada entera
    # Con una plancha más gruesa vuelve a estar entero.
    assert cnc.ajustar_alto([p], 60.0, cfg) == [] and np.array_equal(p.h, h)
    t = cnc.generar([p], 200, 200, 40.0, 1.0, 12.5, cfg)
    assert any("por abajo" in a for a in t.avisos)


def test_ajustes_cnc_guardados_aparte(monkeypatch, tmp_path):
    from ortomolde import config

    ruta = tmp_path / "Ortosend" / "ajustes_taller.json"
    monkeypatch.setenv("ORTOSEND_AJUSTES", str(ruta))
    fabrica = config.cnc_de_fabrica()
    assert config.taller()["cnc"]["avance_acabado"] == fabrica["avance_acabado"]
    assert config.taller()["cnc"]["ajustes_propios"] is False

    config.guardar_ajustes_cnc({"avance_acabado": 2200, "revoluciones": 12000, "otra_cosa": 5, "paso_acabado": 99})
    assert ruta.exists()
    t = config.taller()["cnc"]
    assert (t["avance_acabado"], t["revoluciones"], t["ajustes_propios"]) == (2200, 12000, True)
    assert "otra_cosa" not in t and t["paso_acabado"] == fabrica["paso_acabado"]  # fuera de rango: se ignora

    ruta.write_text("{roto", encoding="utf-8")
    assert config.ajustes_cnc() == {}
    assert config.taller()["cnc"]["avance_acabado"] == fabrica["avance_acabado"]

    config.guardar_ajustes_cnc({})  # de fábrica: se borra el archivo
    assert not ruta.exists()


def test_gcode_con_ajustes_cambiados(piezas_sinteticas, cfg):
    cambiado = dict(cfg, revoluciones=12000, avance_acabado=2200, ajustes_propios=True)
    t = cnc.generar(piezas_sinteticas("A"), 300, 400, 40, 1.0, 12.5, cambiado)
    assert "S12000 M3" in t.gcode
    assert "F2200" in t.gcode
    assert "Ajustes de la CNC" in t.gcode
    assert "Ajustes de la CNC" not in cnc.generar(piezas_sinteticas("A"), 300, 400, 40, 1.0, 12.5, cfg).gcode


def test_orden_como_fusion_contorno_al_final(tirada):
    """Como el ejemplo de Fusion: primero el desbaste de todos los pies, después el paralelo y el contorno al
    final (la escayola trabaja entera mientras se desbasta)."""
    fases = [l.split()[0][1:] for l in tirada.gcode.splitlines()
             if l.startswith(("(Desbaste", "(Paralelo", "(2D Contorneado"))]
    n = len(fases) // 3
    assert n >= 2 and fases == ["Desbaste"] * n + ["Paralelo"] * n + ["2D"] * n


def test_al_empezar_junto_al_borde_no_baja_en_rapido():
    """Antes del contorno, alrededor del pie hay escayola entera: la entrada del acabado baja en rápido
    solo hasta 1 mm sobre la plancha y de ahí despacio."""
    w = cnc._Escritor({"avance_entrada": 1500, "avance_bajada": 800, "avance_rapido": 3000}, 15.0)
    w.bajar_a(10.0, 20.0, -12.0, -10.5, 0.0)
    assert "G0 Z1.000" in w.lineas
    assert not any(l.startswith("G0") and "Z-" in l for l in w.lineas)


def test_desbaste_en_niveles_planos(tirada):
    """Como el desbaste en cajeras de Fusion: corta a Z constante (no sigue la forma del pie como el paralelo)."""
    plano = total = 0.0
    for fase, tipo, a, b in _por_fase(tirada.gcode):
        if fase != "Desbaste" or tipo != "G1":
            continue
        largo = np.hypot(b["X"] - a["X"], b["Y"] - a["Y"])
        total += largo
        if abs(b["Z"] - a["Z"]) < 1e-6:
            plano += largo
    assert total > 0 and plano / total > 0.8  # el resto: entradas en hélice o rampa y pasos entre vueltas


def _bajadas_verticales(gcode, minimo=2.0):
    """Bajadas en vertical (solo Z) de más de `minimo` mm dentro del desbaste."""
    return sum(1 for fase, tipo, a, b in _por_fase(gcode)
               if fase == "Desbaste" and tipo == "G1" and a["X"] == b["X"] and a["Y"] == b["Y"]
               and a["Z"] - b["Z"] > minimo)


def test_desbaste_entra_en_helice_como_fusion(piezas_sinteticas):
    """Con escayola, como el ejemplo de Fusion: el desbaste entra en el yeso bajando en hélice, no clavando
    la fresa."""
    from ortomolde import config

    cfg = config.cnc_de_fabrica("escayola_celular")
    vertical = cnc.generar(piezas_sinteticas("A"), 300, 400, 40, 1.0, 12.5, dict(cfg, radio_helice=0.0))
    helice = cnc.generar(piezas_sinteticas("A"), 300, 400, 40, 1.0, 12.5, cfg)
    assert _bajadas_verticales(helice.gcode) < 0.75 * _bajadas_verticales(vertical.gcode)
    en_xyz = sum(1 for fase, tipo, a, b in _por_fase(helice.gcode)
                 if fase == "Desbaste" and a["X"] != b["X"] and a["Y"] != b["Y"] and b["Z"] < a["Z"])
    assert en_xyz > 100


def test_toda_la_cara_de_arriba_se_fresa_sobre_cada_pie(piezas_sinteticas, cfg):
    """Lo más alto del pie queda `rebaje_superior` mm bajo la cara de arriba: aunque la plancha no esté del
    todo plana, sobre el pie no queda nada de la cara original sin fresar."""
    assert cfg["rebaje_superior"] == 3.0
    t = cnc.generar(piezas_sinteticas("A"), 300, 400, 45, 1.0, 12.5, cfg)
    sil = np.zeros(t.altura.shape, bool)
    for f in t.fichas:
        p = f.pieza
        s = p.silueta_girada()
        sil[p.y:p.y + s.shape[0], p.x:p.x + s.shape[1]] |= s
    assert sil.any() and t.altura[sil].max() <= 45 - cfg["rebaje_superior"] + 1e-6


def test_materiales_xps_y_escayola(monkeypatch, tmp_path, piezas_sinteticas):
    """Por defecto espuma XPS (placa de 50, pasadas de 14 mm = el filo de la broca, se clava en vertical);
    la escayola sigue disponible con sus valores. Los cambios del usuario van sobre el material elegido."""
    from ortomolde import config

    monkeypatch.setenv("ORTOSEND_AJUSTES", str(tmp_path / "ajustes_taller.json"))
    t = config.taller()
    assert t["cnc"]["material"] == "Espuma XPS" and t["plancha"]["alto_z"] == 50
    assert (t["cnc"]["bajada_por_pasada"], t["cnc"]["bajada_contorno"], t["cnc"]["radio_helice"]) == (14, 14, 0)
    config.guardar_ajustes_cnc({"avance_acabado": 4000}, "escayola_celular")
    t = config.taller()
    assert t["cnc"]["material"] == "Escayola celular" and t["plancha"]["alto_z"] == 45
    assert (t["cnc"]["bajada_por_pasada"], t["cnc"]["radio_helice"], t["cnc"]["avance_acabado"]) == (5, 3, 4000)
    # Un archivo de antes de poder elegir material: eran cambios para la escayola, no se aplican al XPS.
    (tmp_path / "ajustes_taller.json").write_text('{"cnc": {"avance_acabado": 2200}}', encoding="utf-8")
    t = config.taller()
    assert t["cnc"]["material"] == "Espuma XPS" and t["cnc"]["avance_acabado"] == 5000
    # G-code con XPS: el material en la cabecera, pocos niveles y sin hélice.
    tr = cnc.generar(piezas_sinteticas("A"), 300, 400, 50, 1.0, 12.5, t["cnc"])
    assert "Espuma XPS" in tr.gcode
    assert tr.resumen["capas_desbaste"] <= 3


def test_repaso_de_pared_quita_el_escalon(piezas_sinteticas, cfg):
    """Tras el contorno, vueltas cada `paso_pared` mm pegadas al pie: la bola nunca baja de donde toca el pie."""
    sin = cnc.generar(piezas_sinteticas("A"), 600, 500, 40, 1.0, 12.5, dict(cfg, paso_pared=0.0))
    con = cnc.generar(piezas_sinteticas("A"), 600, 500, 40, 1.0, 12.5, dict(cfg, paso_pared=5.0))
    assert "Repaso de la pared" in con.gcode and "Repaso de la pared" not in sin.gcode
    assert con.resumen["vueltas_contorno"] > sin.resumen["vueltas_contorno"]
    from scipy import ndimage
    pt = con.punta_pies
    fase = None
    pos = {"X": 0.0, "Y": 0.0, "Z": 15.0}
    peor = -9.0
    for linea in con.gcode.splitlines():
        if linea.startswith("("):
            fase = linea
            continue
        if linea.startswith("G1") and fase and "Repaso" in fase:
            for eje, v in re.findall(r"([XYZ])(-?\d+\.?\d*)", linea):
                pos[eje] = float(v)
            val = ndimage.map_coordinates(pt, [[pos["Y"]], [pos["X"]]], order=1)[0]
            peor = max(peor, float(val - (pos["Z"] + 40)))
    assert -9.0 < peor <= 0.3  # punta_pies lleva holgura: nunca por debajo (salvo redondeo)
