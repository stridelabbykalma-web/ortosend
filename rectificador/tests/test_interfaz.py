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
    import time

    from PySide6.QtCore import QPoint, Qt
    from PySide6.QtTest import QTest
    from PySide6.QtWidgets import QApplication

    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    v.taller["calculo"]["rejilla"] = 1.0
    v.show()
    v.abrir(str(stl_sintetico), esperar=True)
    v.anadir_a_tirada()
    t = v.tirada
    t.resize(1200, 800)
    app.processEvents()
    t.anadir_abierto()  # dos veces el mismo paciente: 4 pies
    assert t.lista.count() == 4
    # Colocados y numerados al momento, antes de calcular nada.
    assert t.trabajo is None and not t.boton_guardar.isEnabled()
    numeros = sorted(int(t.lista.item(k).text().split(".")[0]) for k in range(4))
    assert numeros == [1, 2, 3, 4]
    assert all(t.vista.item_de(q).isVisible() for q in t.piezas)

    # Arrastrar un pie con el ratón (de verdad, sobre la vista) a la esquina de detrás a la derecha.
    p = t.piezas[1]
    item = t.vista.item_de(p)
    paso = t.taller["calculo"]["rejilla"]
    m = cnc.margen_celdas(12.5, paso, t.taller["cnc"]) * paso
    ny, nx = p.forma()
    vista = t.vista

    def en_pantalla(x_mm, y_mm):
        return vista.mapFromScene(x_mm, vista.largo - y_mm)

    origen = en_pantalla((p.x + nx / 2) * paso, (p.y + ny / 2) * paso)
    # El sitio libre más a la derecha y detrás (los pies van encajados por su forma: puede no ser la esquina).
    libre = next((x, y) for x in range(int(600 / paso) - nx, -1, -5) for y in range(int(500 / paso) - ny, -1, -5)
                 if abs(x - p.x) + abs(y - p.y) > 60  # con holgura: el ratón no cae justo en la celda
                 and all(t._motivo(p, x + dx, y + dy, p.giro) is None for dx in (-6, 0, 6) for dy in (-6, 0, 6)))
    destino_mm = ((libre[0] + nx / 2) * paso, (libre[1] + ny / 2) * paso)
    destino = en_pantalla(*destino_mm)
    vp = vista.viewport()
    QTest.mousePress(vp, Qt.LeftButton, Qt.NoModifier, origen)
    assert t.elegida() is p
    inicio = time.perf_counter()
    pasos = 12
    for k in range(1, pasos + 1):
        q = origen + (destino - origen) * k / pasos
        QTest.mouseMove(vp, QPoint(int(q.x()), int(q.y())))
        app.processEvents()
    por_movimiento = (time.perf_counter() - inicio) / pasos
    assert por_movimiento < 0.1  # suave: nada pesado mientras se arrastra
    QTest.mouseRelease(vp, Qt.LeftButton, Qt.NoModifier, destino)
    app.processEvents()
    assert p.fija and abs((p.x + nx / 2) * paso - destino_mm[0]) <= 3 * paso, (libre, p.x, p.y, t.info.text())
    assert "puesto a mano" in "".join(t.lista.item(k).text() for k in range(t.lista.count()))

    # Encima de otro pie: se rechaza, vuelve a su sitio y los demás no se mueven.
    otro = next(q for q in t.piezas if q is not p)
    antes = {id(q): (q.x, q.y) for q in t.piezas}
    assert not t.mover_a(p, otro.x * paso, otro.y * paso)
    assert {id(q): (q.x, q.y) for q in t.piezas} == antes
    assert item.pos() == vista.a_escena(p)

    # Doble clic = girar; flechas del teclado = mover; clic derecho → automático.
    t.lista.setCurrentRow(t.piezas.index(p))
    giro_antes = p.giro
    t.girar(p)
    assert p.giro == (giro_antes + 1) % 4 and p.fija
    vista.setFocus()
    x_antes = p.x
    QTest.keyClick(vp, Qt.Key_Left)
    QTest.keyClick(vista, Qt.Key_Left)
    app.processEvents()
    assert p.x < x_antes
    fijo = (p.x, p.y, p.giro)
    colocacion = {id(q): (q.x, q.y, q.giro) for q in t.piezas}
    numeros = dict(t.numeros)
    t.calcular(esperar=True)
    assert t.trabajo is not None and len(t.trabajo.piezas) == 4
    assert {id(f.pieza): f.numero for f in t.trabajo.fichas} == numeros  # misma numeración que en pantalla
    assert {id(q): (q.x, q.y, q.giro) for q in t.piezas} == colocacion
    assert (p.x, p.y, p.giro) == fijo
    t._silencio = True
    t.guardar(str(tmp_path / "TIRADA.nc"))
    assert (tmp_path / "TIRADA.nc").read_text().startswith("(Ortosend Taller")
    assert (tmp_path / "TIRADA_mapa.png").exists() and (tmp_path / "TIRADA_mapa.pdf").exists()
    assert (tmp_path / "TIRADA.txt").exists()
    # Volver a automático: ya no hay ninguno puesto a mano.
    t.todo_automatico()
    assert not any(q.fija for q in t.piezas) and all(q.colocada for q in t.piezas)
    # Quitar uno: los demás se quedan donde estaban.
    sitio = {id(q): (q.x, q.y) for q in t.piezas[1:]}
    t.quitar(t.piezas[0])
    assert {id(q): (q.x, q.y) for q in t.piezas} == sitio
    t.close()
    v.close()


def test_deshacer_y_rehacer(stl_sintetico):
    from PySide6.QtWidgets import QApplication

    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    v.show()
    v.abrir(str(stl_sintetico), esperar=True)
    assert v.pila.currentIndex() == 1  # se ve el molde, no la bienvenida
    pie = v.proyecto.pies[0]
    assert not v.acciones["deshacer"].isEnabled()
    v.proponer_referencias("p0")
    propuestas = dict(pie.referencias.puntos)
    assert propuestas and v.acciones["deshacer"].isEnabled()
    # Mover un punto (arrastrar y soltar) y cambiar el adelanto.
    x, y = propuestas["mtt1"]
    v.arrastrar_referencia("p0", "mtt1", x + 3, y)
    v.soltar_referencia("p0", "mtt1", x + 3, y)
    v.cambiar_recorte("p0", adelanto=8.0)
    assert pie.recorte.adelanto == 8.0 and pie.referencias.puntos["mtt1"] == (x + 3, y)
    v.deshacer()
    assert pie.recorte.adelanto != 8.0
    v.deshacer()
    assert pie.referencias.puntos["mtt1"] == (x, y)  # todo el arrastre se deshace de una vez
    v.deshacer()
    assert not pie.referencias.puntos
    v.rehacer()
    assert pie.referencias.puntos == propuestas
    # Intercambiar lados también se deshace.
    lados = [p.lado for p in v.proyecto.pies]
    v.intercambiar_lados()
    v.deshacer()
    assert [p.lado for p in v.proyecto.pies] == lados
    v.close()


def test_correcciones_desde_la_ventana(stl_sintetico):
    import numpy as np
    from PySide6.QtWidgets import QApplication

    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    v.show()
    v.abrir(str(stl_sintetico), esperar=True)
    panel = v.paneles["p0"]
    fila = panel.filas_piezas["oliva"]
    assert not fila["activa"].isEnabled()  # sin referencias no se pueden poner
    v.proponer_referencias("p0")
    assert fila["activa"].isEnabled()
    pie = v.proyecto.pies[0]
    antes = v.proyecto.calcular().z.copy()
    fila["activa"].setChecked(True)  # como si se marcara la casilla
    assert pie.piezas["oliva"].activa
    hueco = antes - v.proyecto.calcular().z
    assert hueco.max() > 3  # oliva = hueco en el molde
    # Su bola se puede arrastrar en el 3D.
    clave = ("p0", "pieza:oliva")
    assert clave in v.visor.puntos_arrastrables
    x, y, _ = v.visor.puntos_arrastrables[clave]
    v.arrastrar_referencia("p0", "pieza:oliva", x, y - 6)
    v.soltar_referencia("p0", "pieza:oliva", x, y - 6)
    assert abs(np.hypot(pie.piezas["oliva"].du, pie.piezas["oliva"].dv) - 6) < 0.5
    # La altura con la casilla de números; y todo se deshace.
    fila["altura"].setValue(3.0)
    assert pie.piezas["oliva"].altura == 3.0
    v.deshacer()
    assert pie.piezas["oliva"].altura == 5.0
    v.deshacer()
    assert pie.piezas["oliva"].du == 0 and pie.piezas["oliva"].dv == 0
    v.deshacer()
    assert not pie.piezas["oliva"].activa and np.allclose(v.proyecto.calcular().z, antes)
    # El arco con «Subir».
    panel.filas_piezas["arco"]["activa"].setChecked(True)
    panel.filas_piezas["arco"]["sentido_subir"].setChecked(True)
    assert pie.piezas["arco"].sentido == "subir"
    # Tamaño según el pie: en la ventana se ven los mm de este pie y al quitar «Adaptar» no cambia.
    fila["mas"].setChecked(True)
    f = panel._escala_pie()
    oliva = pie.piezas["oliva"]
    assert fila["adaptar"].isChecked() and fila["ajustes"]["largo"].value() == pytest.approx(round(oliva.largo * f))
    fila["ajustes"]["largo"].setValue(30)
    assert oliva.largo * f == pytest.approx(30)
    fila["adaptar"].setChecked(False)
    assert not oliva.adaptar and oliva.largo == pytest.approx(30) and fila["ajustes"]["largo"].value() == 30
    v.close()


def test_guardar_y_reabrir_trabajo(stl_sintetico, tmp_path):
    from PySide6.QtWidgets import QApplication

    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    v.show()
    v.abrir(str(stl_sintetico), esperar=True)
    assert not v.cambios_sin_guardar and v.caja_nombre.isEnabled()
    v.proponer_referencias("p0")
    v.paneles["p0"].filas_piezas["skive"]["activa"].setChecked(True)
    v.caja_nombre.setText("Ana Ruiz")
    v.caja_nombre.textEdited.emit("Ana Ruiz")
    assert v.cambios_sin_guardar and v.isWindowModified() and "Ana Ruiz" in v.windowTitle()
    assert v._guardar_en(tmp_path / "ana.molde")
    assert not v.cambios_sin_guardar and v.ruta_trabajo.name == "ana.molde"
    z = v.proyecto.calcular().z.copy()
    v.abrir(str(tmp_path / "ana.molde"), esperar=True)
    assert v.proyecto.paciente["nombre"] == "Ana Ruiz" and v.caja_nombre.text() == "Ana Ruiz"
    assert v.proyecto.pies[0].piezas["skive"].activa
    assert (v.proyecto.calcular().z == z).all()
    assert str(tmp_path / "ana.molde") in v._recientes()
    v.close()


def test_seguridad_cnc_en_la_ventana(stl_sintetico, tmp_path):
    from PySide6.QtWidgets import QApplication

    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    v.taller["calculo"]["rejilla"] = 1.0
    v.show()
    v.abrir(str(stl_sintetico), esperar=True)
    # Ver dónde no llega la fresa: colorea el molde y explica dónde.
    v.ver_fresa.setChecked(True)
    assert v.texto_fresa.isVisible() and "planta" in v.texto_fresa.text()
    assert "No llega (mm)" in v.visor._malla.point_data
    v.ver_fresa.setChecked(False)
    assert "No llega (mm)" not in v.visor._malla.point_data
    # Margen en los bordes de la plancha: ningún pie (con su sitio para la fresa) más cerca del borde.
    v.anadir_a_tirada()
    t = v.tirada
    t.caja_margen.setValue(30)
    t._reloj.stop()
    t._colocar(conservar=False)
    m = cnc.margen_celdas(12.5, 1.0, t.taller["cnc"])
    for p in t.piezas:
        x, y, w, l = cnc.huella(p, m)
        assert x >= 30 and y >= 30 and x + w <= 601 - 30 and y + l <= 501 - 30
    t.calcular(esperar=True)
    t._silencio = True
    t.guardar(str(tmp_path / "T.nc"))
    assert (tmp_path / "T_PRUEBA_EN_VACIO.nc").exists()
    t.caja_margen.setValue(0)
    t.close()
    v.close()


def test_version_y_actualizaciones(monkeypatch):
    from datetime import date
    from pathlib import Path

    from PySide6.QtWidgets import QApplication, QMessageBox

    import interfaz.principal as principal
    from ortomolde import __version__

    raiz = Path(principal.__file__).resolve().parent.parent
    assert (raiz / "VERSION").read_text().strip() == __version__
    assert f"## {__version__}" in (raiz / "NOVEDADES.md").read_text(encoding="utf-8")  # cada versión, sus novedades
    app = QApplication.instance() or QApplication([])
    v = principal.VentanaPrincipal()
    dialogos, mensajes = [], []
    monkeypatch.setattr(v, "_dialogo_actualizar", lambda nueva, notas: dialogos.append((nueva, notas)))
    monkeypatch.setattr(QMessageBox, "information", lambda *a, **k: mensajes.append(a[2]))
    notas = "## 99.0.0\n- Algo nuevo\n\n## 0.0.1\n- Viejo\n"
    v._resultado_version("99.0.0", notas, True)
    assert dialogos == [("99.0.0", "## 99.0.0\n- Algo nuevo")]
    v._resultado_version(__version__, "", True)  # al abrir y sin novedades: no dice nada
    assert len(dialogos) == 1 and not mensajes
    v._resultado_version(__version__, "", False)  # buscando a mano: dice que está al día
    assert mensajes and __version__ in mensajes[-1]
    # «Más tarde» hoy: al abrir no vuelve a preguntar por esa versión.
    v.ajustes.setValue("actualizacion_pospuesta", f"{date.today().isoformat()}:99.0.0")
    v._resultado_version("99.0.0", notas, True)
    assert len(dialogos) == 1
    v.ajustes.remove("actualizacion_pospuesta")
    v.close()


def test_escanear_con_revo_scan(tmp_path, monkeypatch):
    """«Escanear» abre Revo Scan y, al exportar a la carpeta de escaneos, propone abrir el archivo."""
    from PySide6.QtWidgets import QApplication, QMessageBox
    from PySide6.QtTest import QTest

    from interfaz import escanear as escaneo
    from interfaz.principal import VentanaPrincipal

    # Busca Revo Scan en las carpetas de programas.
    exe = tmp_path / "Programas" / "Revo Scan 5" / "Revo Scan 5.exe"
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"")
    assert escaneo.buscar_revo_scan([tmp_path / "Programas"]) == exe
    assert escaneo.buscar_revo_scan([tmp_path / "nada"]) is None

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    carpeta = tmp_path / "Escaneos"
    v.ajustes.setValue("carpeta_escaneos", str(carpeta))
    v.ajustes.setValue("revo_scan", str(exe))
    lanzados, abiertos = [], []
    monkeypatch.setattr(escaneo, "abrir_revo_scan", lambda e: lanzados.append(e))
    monkeypatch.setattr(QMessageBox, "information", staticmethod(lambda *a, **k: None))
    monkeypatch.setattr(QMessageBox, "question", staticmethod(lambda *a, **k: QMessageBox.Yes))
    monkeypatch.setattr(v, "abrir", lambda ruta, **k: abiertos.append(ruta))
    (carpeta).mkdir()
    (carpeta / "viejo.stl").write_text("ya estaba")
    v.vigilante = None
    v.escanear()
    assert lanzados == [exe] and QApplication.clipboard().text() == str(carpeta)
    v.vigilante._reloj.setInterval(50)
    (carpeta / "nuevo.stl").write_text("solid x\nendsolid x\n")
    (carpeta / "nota.txt").write_text("no es un escaneo")
    for _ in range(60):
        QTest.qWait(50)
        if abiertos:
            break
    assert abiertos == [str(carpeta / "nuevo.stl")]  # solo el nuevo, y una vez
    v.ajustes.remove("carpeta_escaneos")
    v.ajustes.remove("revo_scan")
    v.ajustes.remove("vigilar_escaneos")
    v.close()


def test_carpeta_de_escaneos_en_onedrive(tmp_path, monkeypatch):
    from interfaz import escanear as escaneo

    for v in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setattr(escaneo.Path, "home", staticmethod(lambda: tmp_path / "casa"))
    assert escaneo.carpeta_por_defecto() == tmp_path / "casa" / "Escaneos Rectificador"
    nube = tmp_path / "OneDrive"
    nube.mkdir()
    monkeypatch.setenv("OneDrive", str(nube))
    assert escaneo.carpeta_por_defecto() == nube / "Escaneos"  # aunque aún no exista
    (nube / "escaneos").mkdir()
    assert escaneo.carpeta_por_defecto() == nube / "escaneos"  # la que ya hay, con su nombre
    # Revo Scan también se encuentra si está dentro de OneDrive\Escaneos.
    exe = nube / "escaneos" / "Revo Scan 5" / "Revo Scan 5.exe"
    exe.parent.mkdir()
    exe.write_bytes(b"")
    for v in ("ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "LOCALAPPDATA"):
        monkeypatch.delenv(v, raising=False)
    assert escaneo.buscar_revo_scan() == exe


def test_nombres_y_correcciones_en_color(stl_sintetico):
    """Con las referencias puestas los nombres no tapan el molde; las correcciones se pintan de color."""
    from PySide6.QtWidgets import QApplication

    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    v.show()
    v.accion_nombres.setChecked(False)
    v.abrir(str(stl_sintetico), esperar=True)
    v.proponer_referencias("p0")
    textos = [n for n in v.visor._actores_pie["p0"] if n.endswith("_texto") or n.endswith("_rotulo")]
    assert textos == []  # pie con referencias: sin nombres
    assert any(n.endswith("_rotulo") for n in v.visor._actores_pie["p1"])  # al otro aún le faltan
    v.accion_nombres.setChecked(True)
    assert any(n.endswith("_texto") for n in v.visor._actores_pie["p0"])
    v.accion_nombres.setChecked(False)
    # Correcciones en color.
    v.ver_cambios.setChecked(True)
    assert not v.leyenda_cambios.isVisibleTo(v)
    v.cambiar_pieza("p0", "oliva", activa=True)
    assert v.leyenda_cambios.isVisibleTo(v) and "Corrección (mm)" in v.visor._malla.point_data
    assert v.visor._malla.point_data["Corrección (mm)"].min() < -3
    v.ver_cambios.setChecked(False)
    assert not v.leyenda_cambios.isVisibleTo(v)
    v.ver_cambios.setChecked(True)  # se deja como estaba
    v.close()


def test_buscar_actualizaciones_a_mano_no_se_queda_pensando(monkeypatch):
    from PySide6.QtTest import QTest
    from PySide6.QtWidgets import QApplication

    from interfaz import actualizar
    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    monkeypatch.setattr(actualizar, "base_publicada", lambda *a, **k: actualizar.URL_BRUTO)
    monkeypatch.setattr(actualizar, "version_publicada", lambda *a, **k: "99.0.0")
    monkeypatch.setattr(actualizar, "novedades_publicadas", lambda *a, **k: "## 99.0.0\n- algo")
    vistos = []
    monkeypatch.setattr(v, "_dialogo_actualizar",
                        lambda nueva, notas: vistos.append((nueva, QApplication.overrideCursor() is None)))
    v.buscar_actualizaciones()
    assert not v.acciones["actualizar"].isEnabled()  # mientras busca
    for _ in range(100):
        QTest.qWait(20)
        if vistos:
            break
    assert vistos == [("99.0.0", True)]  # el aviso sale sin el cursor de espera
    assert v.acciones["actualizar"].isEnabled()
    v.close()


def test_lee_siempre_lo_ultimo_publicado():
    from interfaz import actualizar as A

    a, b = A._sin_cache(A.URL_VERSION), A._sin_cache(A.URL_VERSION)
    assert a.startswith(A.URL_VERSION + "?v=") and a != b
    assert A._sin_cache(A.URL_DESCARGA) == A.URL_DESCARGA


def test_ajustes_cnc_desde_la_app(monkeypatch, tmp_path):
    from PySide6.QtCore import QTimer
    from PySide6.QtWidgets import QApplication

    from interfaz.ajustes_cnc import DialogoAjustesCNC, cresta
    from interfaz.principal import VentanaPrincipal
    from ortomolde import config

    ruta = tmp_path / "ajustes_taller.json"
    monkeypatch.setenv("ORTOSEND_AJUSTES", str(ruta))
    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    v.taller = config.taller()
    fabrica = config.cnc_de_fabrica()
    assert round(cresta(12.5, 1.75), 2) == 0.03

    def cambiar():
        d = app.activeModalWidget()
        assert isinstance(d, DialogoAjustesCNC)
        assert "0.03 mm" in d.info_crestas.text()
        assert d.combo_material.currentData() == "xps"
        d.cajas["avance_acabado"].setValue(2200)
        d.cajas["bajada_por_pasada"].setValue(20)
        assert "filo" in d.avisos.text()  # XPS: más que lo que corta la broca
        d.cajas["bajada_por_pasada"].setValue(fabrica["bajada_por_pasada"])
        d.guardar()

    QTimer.singleShot(200, cambiar)
    assert v.ajustes_cnc() is True
    assert v.taller["cnc"]["avance_acabado"] == 2200 and v.taller["cnc"]["ajustes_propios"] is True
    assert config.ajustes_cnc() == {"avance_acabado": 2200}

    def fabrica_otra_vez():
        d = app.activeModalWidget()
        assert d.cajas["avance_acabado"].value() == 2200
        d.de_fabrica()
        d.guardar()

    QTimer.singleShot(200, fabrica_otra_vez)
    assert v.ajustes_cnc() is True
    assert v.taller["cnc"]["avance_acabado"] == fabrica["avance_acabado"]
    assert v.taller["cnc"]["ajustes_propios"] is False and not ruta.exists()

    # Cambiar a escayola: sus valores (capas de 5, hélice) y la placa de 45 mm.
    monkeypatch.setattr(DialogoAjustesCNC, "AVISAR_PLACA", False)

    def a_escayola():
        d = app.activeModalWidget()
        d.combo_material.setCurrentIndex(d.combo_material.findData("escayola_celular"))
        assert d.cajas["bajada_por_pasada"].value() == 5 and d.cajas["radio_helice"].value() == 3
        d.cajas["bajada_por_pasada"].setValue(14)
        assert "romper" in d.avisos.text()
        d.cajas["bajada_por_pasada"].setValue(5)
        d.guardar()

    QTimer.singleShot(200, a_escayola)
    assert v.ajustes_cnc() is True
    assert v.taller["cnc"]["material"] == "Escayola celular" and v.taller["plancha"]["alto_z"] == 45
    assert config.material_actual() == "escayola_celular"
    v.close()
    v.deleteLater()
    app.processEvents()


def test_placa_de_la_cnc_entre_tiradas(stl_sintetico, monkeypatch, tmp_path):
    """Lo fresado en una tirada queda marcado en la placa; la siguiente va en lo que queda libre."""
    from PySide6.QtCore import QSettings
    from PySide6.QtWidgets import QApplication, QMessageBox

    from interfaz.principal import VentanaPrincipal
    from ortomolde import placa

    app = QApplication.instance() or QApplication([])
    QSettings("Ortosend", "Rectificador").remove("cnc_en_marcha")
    v = VentanaPrincipal()
    v.taller["calculo"]["rejilla"] = 1.0
    v.abrir(str(stl_sintetico), esperar=True)
    t = v.abrir_tirada()
    assert t.plancha() == (600.0, 500.0, 50.0)  # la placa de la mesa de la CNC (XPS de 50 mm)
    assert "sin fresar" in t.texto_placa.text() and not t.boton_deshacer_placa.isEnabled()
    t.anadir_abierto()
    t.calcular(esperar=True)
    primera = [cnc.huella(p, t._margen()) for p in t.piezas]
    t.iniciar("L-01")
    guardada = placa.cargar(600, 500, 45)
    assert placa.tiradas(guardada) == ["L-01"] and len(guardada["zonas"]) == 2
    assert "Usada" in t.texto_placa.text() and t.boton_deshacer_placa.isEnabled()
    # Siguiente tirada: los pies van a lo libre, nunca encima de lo ya fresado.
    t.anadir_abierto()
    assert len(t.piezas) == 2 and all(p.colocada for p in t.piezas)  # la tirada anterior ya no está en la lista
    for p in t.piezas:
        assert not any(cnc._se_pisan(cnc.huella(p, t._margen()), u) for u in primera)
    t.calcular(esperar=True)
    assert len(t.trabajo.usadas) == 2  # el mapa enseña lo ya fresado
    # Deshacer la última (no se llegó a fresar) y placa nueva.
    t.iniciar("L-02")
    assert placa.tiradas(placa.cargar(600, 500, 45)) == ["L-01", "L-02"]
    t.deshacer_ultima_tirada()
    assert placa.tiradas(placa.cargar(600, 500, 45)) == ["L-01"]
    monkeypatch.setattr(QMessageBox, "question", staticmethod(lambda *a, **k: QMessageBox.Yes))
    t.placa_nueva()
    assert placa.cargar(600, 500, 45)["zonas"] == [] and "sin fresar" in t.texto_placa.text()
    # Otra medida de plancha: se avisa de que la placa en uso es otra.
    t.cajas[2].setValue(40)
    t._poner_plancha()
    assert "Placa nueva" in t.texto_placa.text()
    v.cnc_parar()
    t.close()
    v.close()
    app.processEvents()
