"""Prueba rápida de la ventana. Solo se ejecuta si hay pantalla (o xvfb-run)."""

import os

import pytest

from ortomolde import cnc

pytestmark = pytest.mark.skipif(
    os.name != "nt" and not os.environ.get("DISPLAY"), reason="sin pantalla"
)


def test_ventana_abre_y_marca_referencias(stl_sintetico):
    from PySide6.QtWidgets import QApplication

    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    v.show()
    v.abrir(str(stl_sintetico), esperar=True)
    assert len(v.proyecto.pies) == 2
    pie = v.proyecto.pie("izquierdo")
    import numpy as np
    jj, ii = np.nonzero(pie.mascara)
    r = v.proyecto.original.rejilla
    x, y = ii.mean() * r.dx, (jj.min() + 20) * r.dy
    v.clic_en_molde(x, y, 0)
    assert "mtt1" in pie.referencias.puntos
    v.intercambiar_lados()
    assert v.proyecto.pie("derecho").referencias.puntos  # las referencias van con el pie
    app.processEvents()
    v.close()


def _evento(iren, nombre, x, y):
    iren.SetEventInformation(int(round(x)), int(round(y)), 0, 0, "\0", 0, None)
    iren.InvokeEvent(nombre)


def test_arrastrar_un_punto_con_el_raton(stl_sintetico):
    import numpy as np
    from PySide6.QtWidgets import QApplication

    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    v.resize(1400, 900)
    v.show()
    v.abrir(str(stl_sintetico), esperar=True)
    v.proponer_referencias("p0")
    v.visor.view_xy()  # vista desde arriba: mover en pantalla = mover sobre la planta
    v.visor.render()
    app.processEvents()
    iren = v.visor.iren.interactor
    pie = v.proyecto.pies[0]
    antes = np.array(pie.referencias.puntos["mtt2"])
    camara = v.visor.camera_position

    x, y, z = v.visor.puntos_arrastrables[("p0", "mtt2")]
    sx, sy = v.visor.a_pantalla(x, y, z)
    # Dónde cae en pantalla un punto 8 mm más atrás (hacia el talón).
    dx, dy = v.visor.a_pantalla(x, y - 8.0, z)
    _evento(iren, "LeftButtonPressEvent", sx, sy)
    for f in np.linspace(0, 1, 5)[1:]:
        _evento(iren, "MouseMoveEvent", sx + f * (dx - sx), sy + f * (dy - sy))
    _evento(iren, "LeftButtonReleaseEvent", dx, dy)
    app.processEvents()

    despues = np.array(pie.referencias.puntos["mtt2"])
    assert np.allclose(despues - antes, [0.0, -8.0], atol=1.0)
    assert v.visor.camera_position == camara  # la cámara no ha girado

    # Lejos de los puntos, arrastrar gira la cámara como siempre.
    _evento(iren, "LeftButtonPressEvent", 30, 30)
    _evento(iren, "MouseMoveEvent", 120, 60)
    _evento(iren, "LeftButtonReleaseEvent", 120, 60)
    assert v.visor.camera_position != camara
    v.close()


def test_medir_distancia(stl_sintetico):
    from PySide6.QtWidgets import QApplication

    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    v.show()
    v.abrir(str(stl_sintetico), esperar=True)
    v.boton_medir.setChecked(True)
    v.clic_en_molde(50.0, 60.0, 10.0)
    v.clic_en_molde(50.0, 160.0, 12.0)
    assert "100.0 mm" in v.texto_medida.text()
    assert "Medidas (mm)" in v.paneles["p0"].medidas.text()
    v.boton_medir.setChecked(False)
    assert v.medida == []
    v.close()


def test_selector_de_modo(tmp_path, taller):
    from PySide6.QtCore import QSettings
    from PySide6.QtWidgets import QApplication

    from interfaz.principal import VentanaPrincipal
    from ortomolde.sintetico import malla_bruta

    QSettings("Ortosend", "Rectificador").setValue("modo", "huellas")
    t = {**taller, "calculo": {"rejilla": 1.0}}
    ruta = tmp_path / "molde.stl"
    malla_bruta(t, 2.0, modo="moldes", un_pie=True).export(ruta)
    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    v.show()
    v.botones_modo["moldes"].setChecked(True)
    assert v.modo == "moldes"
    v.abrir(str(ruta), esperar=True)
    assert len(v.proyecto.pies) == 1
    assert "Molde ya hecho" in v.info.text()
    v.close()
    assert QSettings("Ortosend", "Rectificador").value("modo") == "moldes"
    QSettings("Ortosend", "Rectificador").setValue("modo", "huellas")


def test_ventana_tirada(stl_sintetico, tmp_path):
    from PySide6.QtWidgets import QApplication

    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    v.taller["calculo"]["rejilla"] = 1.0
    v.show()
    v.abrir(str(stl_sintetico), esperar=True)
    v.anadir_a_tirada()
    t = v.tirada
    t.anadir_abierto()  # dos veces el mismo paciente: 4 pies
    assert t.lista.count() == 4
    # Vista previa al momento, con los pies numerados antes de calcular nada.
    assert t.previa is not None and t.trabajo is None and not t.boton_guardar.isEnabled()
    numeros = sorted(int(t.lista.item(k).text().split(".")[0]) for k in range(4))
    assert numeros == [1, 2, 3, 4]
    previa = [(f.numero, f.x, f.y) for f in t.previa.fichas]
    t.lista.setCurrentRow(1)  # resaltar uno no rompe nada
    # Mover a mano: elegir con un clic en el mapa, arrastrar y soltar en un sitio libre.
    p = t.piezas[1]
    ny, nx = p.forma()
    paso = t.taller["calculo"]["rejilla"]
    m = cnc.margen_celdas(12.5, paso, t.taller["cnc"]) * paso
    x0, y0 = p.x * paso, p.y * paso
    t._al_pulsar(x0 + 5, y0 + 5)
    assert t.elegida() is p
    destino = (600 - nx * paso - m - 1, 500 - ny * paso - m - 1)
    t._al_arrastrar(destino[0] + 5, destino[1] + 5)
    t._al_soltar(destino[0] + 5, destino[1] + 5)
    assert p.fija and abs(p.x * paso - destino[0]) <= paso and "puesto a mano" in "".join(
        t.lista.item(k).text() for k in range(t.lista.count()))
    # Encima de otro pie: se rechaza y no se mueve.
    otro = next(q for q in t.piezas if q is not p)
    antes = (p.x, p.y)
    assert not t.mover_a(p, otro.x * paso, otro.y * paso) and (p.x, p.y) == antes
    # Girar y flechas.
    t.lista.setCurrentRow(t.piezas.index(p))
    t.mover(-5, 0)
    t.girar()
    assert p.giro in (1, 0)  # gira si cabe; si no, se queda como estaba
    fijo = (p.x, p.y, p.giro)
    previa = [(f.numero, f.x, f.y) for f in t.previa.fichas]
    t.calcular(esperar=True)
    assert t.trabajo is not None and len(t.trabajo.piezas) == 4
    assert [(f.numero, f.x, f.y) for f in t.trabajo.fichas] == previa  # misma colocación que la vista previa
    assert (p.x, p.y, p.giro) == fijo
    t._silencio = True
    t.guardar(str(tmp_path / "TIRADA.nc"))
    assert (tmp_path / "TIRADA.nc").read_text().startswith("(Rectificador")
    assert (tmp_path / "TIRADA_mapa.png").exists() and (tmp_path / "TIRADA_mapa.pdf").exists() and (tmp_path / "TIRADA.txt").exists()
    t.close()
    v.close()
