"""Prueba rápida de la ventana. Solo se ejecuta si hay pantalla (o xvfb-run)."""

import os

import pytest

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
    t.calcular(esperar=True)
    assert t.trabajo is not None and len(t.trabajo.piezas) == 4
    t._silencio = True
    t.guardar(str(tmp_path / "TIRADA.nc"))
    assert (tmp_path / "TIRADA.nc").read_text().startswith("; Rectificador")
    assert (tmp_path / "TIRADA.png").exists() and (tmp_path / "TIRADA.txt").exists()
    t.close()
    v.close()
