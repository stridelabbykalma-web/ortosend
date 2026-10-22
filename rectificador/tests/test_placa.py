"""La placa de la CNC recuerda lo ya fresado entre tiradas."""

import json

import numpy as np

from ortomolde import cnc, placa


def test_registro_de_la_placa():
    estado = placa.cargar_estado(600, 500, 45)
    p = estado["placa"]
    assert estado["maquina"] is None and estado["pendientes"] == []
    assert p["zonas"] == [] and placa.fraccion_usada(p) == 0 and p["id"]
    op1 = placa.anadir_tirada(p, [(0, 0, 150, 300), (150, 0, 150, 300)], "L-01")
    assert op1["op"] == "tirada" and op1["placaId"] == p["id"] and len(op1["zonas"]) == 2
    placa.anadir_tirada(p, [(300, 0, 100, 100)], "L-02")
    placa.guardar_estado(estado)
    otra = placa.cargar(600, 500, 45)
    assert otra["id"] == p["id"] and placa.tiradas(otra) == ["L-01", "L-02"]
    assert abs(placa.fraccion_usada(otra) - (300 * 300 + 100 * 100) / (600 * 500)) < 0.01
    assert placa.misma_medida(otra, 600, 500, 45) and not placa.misma_medida(otra, 600, 500, 40)
    # En celdas, redondeado hacia fuera (nunca se queda corto).
    assert placa.zonas_celdas({"zonas": [{"x": 0.3, "y": 0, "ancho": 10.1, "largo": 5}]}, 1.0) == [(0, 0, 11, 5)]
    nombre, tid = placa.deshacer_ultima(otra)
    assert nombre == "L-02" and tid and placa.tiradas(otra) == ["L-01"]
    # Archivo roto: placa nueva. Archivo de la 0.10.0 (solo la placa): se sigue leyendo.
    placa.ruta().write_text("{roto", encoding="utf-8")
    assert placa.cargar(600, 500, 45)["zonas"] == []
    placa.ruta().write_text(json.dumps({"ancho": 600, "largo": 500, "alto": 45, "creada": "",
                                        "zonas": [{"x": 0, "y": 0, "ancho": 10, "largo": 10, "tirada": "V"}]}),
                            encoding="utf-8")
    vieja = placa.cargar_estado(600, 500, 45)
    assert vieja["maquina"] is None and placa.tiradas(vieja["placa"]) == ["V"]


def test_placa_de_la_web_y_subida():
    m = {"id": "m1", "nombre": "CNC", "placa": {"id": "p1", "ancho": 600, "largo": 500, "alto": 45,
         "puesta": "2026-10-22T10:00:00Z",
         "tiradas": [{"id": "t1", "nombre": "L-01", "fecha": "2026-10-22T11:00:00Z",
                      "zonas": [{"x": 0, "y": 0, "ancho": 100, "largo": 200}]}]}}
    p = placa.desde_web(m)
    assert p["id"] == "p1" and p["zonas"][0]["tiradaId"] == "t1" and placa.tiradas(p) == ["L-01"]
    assert placa.desde_web({"id": "m2", "placa": None}) is None
    # Una placa de este ordenador que se sube a una máquina sin placa: la placa y una operación por tirada.
    local = placa.nueva(600, 500, 45)
    placa.anadir_tirada(local, [(0, 0, 10, 10), (20, 0, 10, 10)], "A")
    ops = placa.operaciones_para_subir(local)
    assert [o["op"] for o in ops] == ["placa", "tirada"] and len(ops[1]["zonas"]) == 2


def _pieza(nombre, ancho=60, largo=120):
    h = np.zeros((largo, ancho))
    sil = np.zeros((largo, ancho), bool)
    sil[5:-5, 5:-5] = True
    h[sil] = 10
    return cnc.Pieza(nombre, h, sil, 1.0)


def test_colocar_en_lo_libre_de_la_placa(taller):
    cfg, paso, R = taller["cnc"], 1.0, 12.5
    m = cnc.margen_celdas(R, paso, cfg)
    # Primera tirada: dos pies en una placa limpia; su huella queda gastada.
    primera = [_pieza("A"), _pieza("B")]
    assert cnc.colocar(primera, 600, 500, paso, cfg, R) == []
    usadas = [cnc.huella(p, m) for p in primera]
    # Segunda tirada: nada encima de lo ya fresado.
    segunda = [_pieza(f"N{i}") for i in range(4)]
    assert cnc.colocar(segunda, 600, 500, paso, cfg, R, usadas=usadas) == []
    for p in segunda:
        assert not any(cnc._se_pisan(cnc.huella(p, m), u) for u in usadas)
    # A mano tampoco: encima de una zona usada no cabe.
    q = _pieza("Q")
    motivo = cnc.cabe(q, [], 600, 500, paso, cfg, R, primera[0].x, primera[0].y, 0, usadas)
    assert "ya está fresada" in motivo
    # Si la placa está llena, se dice.
    llena = [(0, 0, 601, 501)]
    assert len(cnc.colocar([_pieza("Z")], 600, 500, paso, cfg, R, usadas=llena)) == 1


def test_gcode_no_baja_en_lo_ya_fresado(taller):
    cfg, paso, R = dict(taller["cnc"]), 1.0, 12.5
    m = cnc.margen_celdas(R, paso, cfg)
    primera = [_pieza("A")]
    cnc.colocar(primera, 400, 300, paso, cfg, R)
    usadas = [cnc.huella(primera[0], m)]
    t = cnc.generar([_pieza("B")], 400, 300, 45, paso, R, cfg, usadas=usadas)
    ux, uy, uw, ul = usadas[0]
    pos = {"X": 0.0, "Y": 0.0, "Z": 15.0}
    import re
    for linea in t.gcode.splitlines():
        if linea.startswith(("G0 ", "G1 ")):
            for eje, v in re.findall(r"([XYZ])(-?\d+\.?\d*)", linea):
                pos[eje] = float(v)
            assert pos["X"] >= -0.01 and pos["Y"] >= -0.01  # mismo origen: esquina delantera izquierda
            if pos["Z"] < 0:  # cortando: nunca dentro de la zona ya fresada
                dentro = ux * paso < pos["X"] < (ux + uw) * paso and uy * paso < pos["Y"] < (uy + ul) * paso
                assert not dentro
