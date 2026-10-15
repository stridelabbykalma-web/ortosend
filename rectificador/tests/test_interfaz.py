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
