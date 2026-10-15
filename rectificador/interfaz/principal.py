"""Ventana principal del rectificador de moldes.

Arrancar (desde la carpeta rectificador):  python -m interfaz.principal [ESCANEO.stl]
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

from PySide6.QtCore import QObject, QThread, Qt, Signal
from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWidgets import (
    QApplication, QButtonGroup, QCheckBox, QDoubleSpinBox, QFileDialog, QGroupBox, QHBoxLayout,
    QLabel, QMainWindow, QMessageBox, QProgressDialog, QPushButton, QScrollArea, QSplitter,
    QVBoxLayout, QWidget,
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from interfaz.visor import COLORES, Visor  # noqa: E402
from ortomolde.exportar import exportar  # noqa: E402
from ortomolde.proyecto import Proyecto  # noqa: E402
from ortomolde.referencias import NOMBRES, OPCIONALES, ORDEN  # noqa: E402

AYUDA = (
    "<b>Marcar referencias:</b> clic <b>derecho</b> sobre el pie.<br>"
    "Se marcan en orden: 1.er MTT, 5.º MTT y talón (obligatorias) y luego, si quieres, "
    "2.º, 3.º y 4.º MTT (el recorte pasa por delante de todas las cabezas). "
    "Para corregir una, pulsa su botón y vuelve a hacer clic derecho. "
    "<b>Proponer referencias</b> las coloca todas automáticamente para empezar.<br>"
    "Girar: arrastrar con el botón izquierdo · Desplazar: Mayús + arrastrar · Zoom: rueda."
)


class Cargador(QObject):
    """Abre (y limpia) el escaneo en segundo plano para que la ventana no se congele."""

    terminado = Signal(object)
    fallo = Signal(str)

    def __init__(self, ruta: str):
        super().__init__()
        self.ruta = ruta

    def trabajar(self):
        try:
            self.terminado.emit(Proyecto.abrir(self.ruta))
        except Exception as e:  # noqa: BLE001 - se muestra al usuario
            traceback.print_exc()
            self.fallo.emit(str(e))


class PanelPie(QGroupBox):
    """Estado de las referencias de un pie y botones para corregirlas."""

    def __init__(self, ventana: "VentanaPrincipal", clave: str):
        super().__init__()
        self.ventana, self.clave = ventana, clave
        lay = QVBoxLayout(self)
        self.etiquetas: dict[str, QLabel] = {}
        self.grupo = QButtonGroup(self)
        self.grupo.setExclusive(False)
        for k in ORDEN:
            fila = QHBoxLayout()
            punto = QLabel("●")
            punto.setStyleSheet(f"color: {COLORES[k]}; font-size: 16px;")
            fila.addWidget(punto)
            self.etiquetas[k] = QLabel()
            fila.addWidget(self.etiquetas[k], 1)
            boton = QPushButton("Marcar")
            boton.setCheckable(True)
            boton.setToolTip(f"Pulsa y haz clic derecho sobre el pie para marcar: {NOMBRES[k]}")
            boton.clicked.connect(lambda marcado, k=k: self.ventana.elegir_referencia(self.clave, k if marcado else None))
            self.grupo.addButton(boton)
            boton.setProperty("referencia", k)
            fila.addWidget(boton)
            lay.addLayout(fila)
        fila = QHBoxLayout()
        proponer = QPushButton("Proponer referencias")
        proponer.setToolTip("Coloca las 3 referencias de forma aproximada (proporciones típicas del pie).\n"
                            "Después corrígelas con el botón Marcar y clic derecho.")
        proponer.clicked.connect(lambda: self.ventana.proponer_referencias(self.clave))
        fila.addWidget(proponer)
        borrar = QPushButton("Borrar referencias")
        borrar.clicked.connect(lambda: self.ventana.borrar_referencias(self.clave))
        fila.addWidget(borrar)
        lay.addLayout(fila)

        # Recorte en arco
        self.recortar = QCheckBox("Recortar en arco por delante de las cabezas metatarsales")
        self.recortar.toggled.connect(lambda v: self.ventana.cambiar_recorte(self.clave, activo=v))
        lay.addWidget(self.recortar)
        fila = QHBoxLayout()
        fila.addWidget(QLabel("Adelanto:"))
        self.adelanto = QDoubleSpinBox()
        self.adelanto.setRange(-30.0, 40.0)
        self.adelanto.setSingleStep(1.0)
        self.adelanto.setDecimals(1)
        self.adelanto.setSuffix(" mm")
        self.adelanto.setToolTip("Distancia del arco por delante de las cabezas (negativo = por detrás).")
        self.adelanto.valueChanged.connect(lambda v: self.ventana.cambiar_recorte(self.clave, adelanto=v))
        fila.addWidget(self.adelanto)
        fila.addWidget(QLabel("Curvatura:"))
        self.curvatura = QDoubleSpinBox()
        self.curvatura.setRange(0.0, 3.0)
        self.curvatura.setSingleStep(0.1)
        self.curvatura.setDecimals(1)
        self.curvatura.setToolTip("0 = recto · 1 = parábola metatarsal · más = más curvado.")
        self.curvatura.valueChanged.connect(lambda v: self.ventana.cambiar_recorte(self.clave, curvatura=v))
        fila.addWidget(self.curvatura)
        lay.addLayout(fila)

    def actualizar(self, pie, proyecto, activa: str | None):
        self.setTitle(f"{pie.nombre}  (mitad {'izquierda' if self.clave == 'p0' else 'derecha'})")
        for k in ORDEN:
            if k in pie.referencias.puntos:
                x, y = pie.referencias.puntos[k]
                xt, yt, zt = proyecto.a_taller(x, y, proyecto.altura_en(x, y))
                texto = f"{NOMBRES[k]}: X {xt:.1f}  Y {yt:.1f}  Z {zt:.1f}"
            else:
                texto = f"{NOMBRES[k]}: <i>{'opcional' if k in OPCIONALES else 'sin marcar'}</i>"
            self.etiquetas[k].setText(texto)
        for b in self.grupo.buttons():
            b.setChecked(b.property("referencia") == activa)
        for w, valor in ((self.recortar, pie.recorte.activo), (self.adelanto, pie.recorte.adelanto),
                         (self.curvatura, pie.recorte.curvatura)):
            w.blockSignals(True)
            w.setChecked(valor) if isinstance(w, QCheckBox) else w.setValue(valor)
            w.blockSignals(False)
        listo = pie.referencias.completas
        for w in (self.recortar, self.adelanto, self.curvatura):
            w.setEnabled(listo)
        self.recortar.setToolTip("" if listo else "Marca antes las 3 referencias de este pie.")


class VentanaPrincipal(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Rectificador de moldes – Ortosend")
        self.resize(1400, 850)
        self.proyecto: Proyecto | None = None
        self.activa: tuple[str, str] | None = None  # (pie, referencia) que se va a marcar
        self._hilo = None

        self.visor = Visor(self, al_hacer_clic=self.clic_en_molde)
        panel = QWidget()
        self.lay_panel = QVBoxLayout(panel)
        self.info = QLabel("Abre un escaneo (Archivo → Abrir escaneo…).")
        self.info.setWordWrap(True)
        self.lay_panel.addWidget(self.info)
        self.avisos = QLabel()
        self.avisos.setWordWrap(True)
        self.avisos.setStyleSheet("color: #c0392b;")
        self.lay_panel.addWidget(self.avisos)
        self.boton_lados = QPushButton("Intercambiar izquierdo ↔ derecho")
        self.boton_lados.setToolTip("Si el programa se ha equivocado de pie, pulsa aquí.")
        self.boton_lados.clicked.connect(self.intercambiar_lados)
        self.lay_panel.addWidget(self.boton_lados)
        self.lay_panel.addWidget(self._grupo_molde())
        self.paneles = {c: PanelPie(self, c) for c in ("p0", "p1")}
        for p in self.paneles.values():
            self.lay_panel.addWidget(p)
        ayuda = QLabel(AYUDA)
        ayuda.setWordWrap(True)
        ayuda.setStyleSheet("color: #555; font-size: 11px;")
        self.lay_panel.addWidget(ayuda)
        self.lay_panel.addStretch(1)
        desplazable = QScrollArea()
        desplazable.setWidget(panel)
        desplazable.setWidgetResizable(True)
        desplazable.setMinimumWidth(440)

        division = QSplitter(Qt.Horizontal)
        division.addWidget(self.visor)
        division.addWidget(desplazable)
        division.setStretchFactor(0, 1)
        self.setCentralWidget(division)
        self._menus()
        self._refrescar_panel()

    def _grupo_molde(self) -> QGroupBox:
        grupo = QGroupBox("Molde")
        lay = QVBoxLayout(grupo)
        fila = QHBoxLayout()
        fila.addWidget(QLabel("Lijado (tamaño del taco):"))
        self.caja_lijado = QDoubleSpinBox()
        self.caja_lijado.setRange(0.0, 12.0)
        self.caja_lijado.setSingleStep(0.5)
        self.caja_lijado.setDecimals(1)
        self.caja_lijado.setSuffix(" mm")
        self.caja_lijado.setToolTip(
            "Lija el molde: quita hoyitos, bultitos, ondulaciones y marcas conservando\n"
            "la forma y el contorno del pie. Más grande = lija ondulaciones más anchas.\n"
            "0 = sin lijar.")
        self.caja_lijado.valueChanged.connect(self.cambiar_lijado)
        fila.addWidget(self.caja_lijado)
        lay.addLayout(fila)
        self.ver_original = QCheckBox("Ver el escaneo sin lijar (para comparar)")
        self.ver_original.toggled.connect(lambda _: self._mostrar_molde(reiniciar_camara=False))
        lay.addWidget(self.ver_original)
        return grupo

    def cambiar_lijado(self, valor: float):
        if self.proyecto is None or abs(self.proyecto.lijado - valor) < 1e-9:
            return
        self.proyecto.lijado = float(valor)
        self.ver_original.setChecked(False)
        self._mostrar_molde(reiniciar_camara=False)
        self._redibujar_pies()

    def _mostrar_molde(self, reiniciar_camara: bool):
        p = self.proyecto
        campo = p.original if self.ver_original.isChecked() else p.calcular()
        self.visor.mostrar_molde(campo, reiniciar_camara=reiniciar_camara)

    def _menus(self):
        archivo = self.menuBar().addMenu("&Archivo")
        for texto, atajo, accion in (
            ("Abrir escaneo…", QKeySequence.Open, self.abrir_dialogo),
            ("Exportar…", QKeySequence("Ctrl+E"), self.exportar),
            ("Salir", QKeySequence.Quit, self.close),
        ):
            a = QAction(texto, self)
            a.setShortcut(atajo)
            a.triggered.connect(accion)
            archivo.addAction(a)
        ver = self.menuBar().addMenu("&Ver")
        for texto, accion in (("Vista inicial", lambda: self.visor.vista_inicial()),
                              ("Vista de planta (desde arriba)", lambda: self.visor.vista_planta())):
            a = QAction(texto, self)
            a.triggered.connect(accion)
            ver.addAction(a)

    # ---------------------------------------------------------------- abrir

    def abrir_dialogo(self):
        ruta, _ = QFileDialog.getOpenFileName(self, "Abrir escaneo", "", "Mallas STL (*.stl)")
        if ruta:
            self.abrir(ruta)

    def abrir(self, ruta: str, esperar: bool = False):
        """Abre el escaneo en segundo plano. Con `esperar` (pruebas) lo hace en este hilo."""
        if esperar:
            self._cargado(Proyecto.abrir(ruta))
            return
        self._progreso = QProgressDialog("Leyendo y limpiando el escaneo…", None, 0, 0, self)
        self._progreso.setWindowTitle("Abriendo")
        self._progreso.setWindowModality(Qt.WindowModal)
        self._progreso.show()
        self._hilo = QThread(self)
        self._cargador = Cargador(ruta)
        self._cargador.moveToThread(self._hilo)
        self._hilo.started.connect(self._cargador.trabajar)
        self._cargador.terminado.connect(self._cargado)
        self._cargador.fallo.connect(self._fallo)
        self._cargador.terminado.connect(self._hilo.quit)
        self._cargador.fallo.connect(self._hilo.quit)
        self._hilo.start()

    def _cargado(self, proyecto: Proyecto):
        if getattr(self, "_progreso", None):
            self._progreso.close()
        self.proyecto = proyecto
        self.activa = None
        self.caja_lijado.blockSignals(True)
        self.caja_lijado.setValue(proyecto.lijado)
        self.caja_lijado.blockSignals(False)
        self._mostrar_molde(reiniciar_camara=True)
        self._redibujar_pies()
        self._refrescar_panel()

    def _fallo(self, mensaje: str):
        self._progreso.close()
        QMessageBox.critical(self, "No se ha podido abrir", mensaje)

    # ---------------------------------------------------------------- referencias

    def _clave(self, pie) -> str:
        return f"p{self.proyecto.pies.index(pie)}"

    def elegir_referencia(self, clave: str, nombre: str | None):
        self.activa = (clave, nombre) if nombre else None
        self._refrescar_panel()

    def clic_en_molde(self, x: float, y: float, z: float):
        if self.proyecto is None:
            return
        pie = self.proyecto.pie_en(x, y)
        if pie is None:
            self.statusBar().showMessage("Ese punto no está sobre ningún pie.", 4000)
            return
        nombre = None
        if self.activa and self.activa[0] == self._clave(pie):
            nombre = self.activa[1]
        hecho = self.proyecto.poner_referencia(x, y, nombre)
        if hecho:
            _, nombre = hecho
            self.statusBar().showMessage(f"{pie.nombre}: marcada {NOMBRES[nombre]}.", 4000)
        self.activa = None
        self._actualizar_todo()

    def proponer_referencias(self, clave: str):
        if not self.proyecto:
            return
        self.proyecto.proponer_referencias(self.proyecto.pies[int(clave[1])])
        self._actualizar_todo()

    def cambiar_recorte(self, clave: str, **cambios):
        if not self.proyecto:
            return
        r = self.proyecto.pies[int(clave[1])].recorte
        for k, v in cambios.items():
            setattr(r, k, v)
        self._actualizar_todo()

    def _actualizar_todo(self):
        """Recalcula el molde y redibuja todo (tras cualquier cambio)."""
        self._mostrar_molde(reiniciar_camara=False)
        self._redibujar_pies()
        self._refrescar_panel()

    def borrar_referencias(self, clave: str):
        if not self.proyecto:
            return
        pie = self.proyecto.pies[int(clave[1])]
        pie.referencias.puntos.clear()
        self._actualizar_todo()

    def intercambiar_lados(self):
        if not self.proyecto:
            return
        self.proyecto.intercambiar_lados()
        self._mostrar_molde(reiniciar_camara=False)
        self._redibujar_pies()
        self._refrescar_panel()

    def _redibujar_pies(self):
        for clave in ("p0", "p1"):
            self.visor.borrar_pie(clave)
        for pie in self.proyecto.pies:
            try:
                geom = self.proyecto.geometria(pie)
            except ValueError as e:
                geom = None
                self.statusBar().showMessage(str(e), 6000)
            self.visor.dibujar_pie(self._clave(pie), pie, geom, self.proyecto.linea_recorte(pie))

    def _refrescar_panel(self):
        p = self.proyecto
        self.boton_lados.setEnabled(p is not None and len(p.pies) > 0)
        if p is None:
            for panel in self.paneles.values():
                panel.hide()
            return
        self.info.setText(
            f"<b>{p.ruta_stl.name}</b><br>"
            f"{'Escaneo en bruto (limpiado automáticamente)' if p.tipo == 'bruto' else 'Molde ya limpio'} · "
            f"{len(p.pies)} pie(s) encontrado(s)"
        )
        self.avisos.setText("<br>".join(f"⚠ {a}" for a in p.avisos))
        for clave, panel in self.paneles.items():
            k = int(clave[1])
            if k < len(p.pies):
                activa = self.activa[1] if self.activa and self.activa[0] == clave else None
                panel.actualizar(p.pies[k], p, activa)
                panel.show()
            else:
                panel.hide()

    # ---------------------------------------------------------------- exportar

    def exportar(self):
        if not self.proyecto:
            return
        sugerido = str(self.proyecto.ruta_stl.with_suffix("").name).upper()
        ruta, _ = QFileDialog.getSaveFileName(self, "Exportar molde", sugerido + ".stl", "Mallas STL (*.stl)")
        if not ruta:
            return
        ruta = Path(ruta)
        rutas = exportar(self.proyecto.calcular(), ruta.parent, ruta.stem, self.proyecto.receta(), self.proyecto.taller)
        QMessageBox.information(self, "Exportado", "Archivos guardados:\n" + "\n".join(str(r) for r in rutas.values()))


def main():
    app = QApplication(sys.argv)
    ventana = VentanaPrincipal()
    ventana.show()
    if len(sys.argv) > 1:
        ventana.abrir(sys.argv[1])
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
