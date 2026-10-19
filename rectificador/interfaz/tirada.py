"""Ventana «Tirada de CNC»: varios moldes en una misma plancha de escayola y un solo archivo .nc."""

from __future__ import annotations

import traceback
from pathlib import Path

from PySide6.QtCore import QObject, Qt, QThread, QUrl, Signal
from PySide6.QtGui import QDesktopServices, QPixmap
from PySide6.QtWidgets import (
    QDialog, QDoubleSpinBox, QFileDialog, QFormLayout, QHBoxLayout, QLabel, QListWidget,
    QMessageBox, QPushButton, QVBoxLayout,
)

from ortomolde import cnc, mapa
from ortomolde.campo import malla_a_campo
from ortomolde.entrada import cargar_malla
from ortomolde.pies import detectar_pies


def piezas_de_proyecto(proyecto, nombre: str) -> list[cnc.Pieza]:
    """Las piezas (un pie cada una) del molde abierto, tal como se exportaría."""
    c = proyecto.calcular()
    return cnc.piezas_de_molde(c.z, proyecto.fondo, [p.mascara for p in proyecto.pies],
                               [f"{nombre} · pie {p.lado}" for p in proyecto.pies],
                               c.rejilla.dx, proyecto.taller["cnc"])


def piezas_de_archivo(ruta: str, taller: dict) -> list[cnc.Pieza]:
    """Piezas de un molde ya rectificado y exportado (NOMBRE.stl). Se usa tal cual, sin retocar."""
    malla = cargar_malla(ruta)
    paso = taller["calculo"]["rejilla"]
    tam = malla.extents
    campo = malla_a_campo(malla, paso)
    z = campo.z - campo.z.min()  # el fondo del archivo a 0
    from ortomolde.campo import detectar_fondo
    fondo = detectar_fondo(z)
    pies = detectar_pies(campo.copia(z), fondo, taller["limpieza"]["pie_izquierdo_en"])
    if not pies:
        raise ValueError(f"En {Path(ruta).name} ({tam[0]:.0f} × {tam[1]:.0f} mm) no encuentro ningún pie.")
    nombre = Path(ruta).stem.upper()
    return cnc.piezas_de_molde(z, fondo, [p.mascara for p in pies], [f"{nombre} · pie {p.lado}" for p in pies],
                               paso, taller["cnc"])


class _Calculo(QObject):
    terminado = Signal(object)
    fallo = Signal(str)

    def __init__(self, piezas, plancha, taller):
        super().__init__()
        self.piezas, self.plancha, self.taller = piezas, plancha, taller

    def trabajar(self):
        try:
            ancho, largo, alto = self.plancha
            self.terminado.emit(cnc.generar(self.piezas, ancho, largo, alto, self.taller["calculo"]["rejilla"],
                                            self.taller["fresa"]["diametro"] / 2, self.taller["cnc"]))
        except Exception as e:  # noqa: BLE001 - se muestra al usuario
            traceback.print_exc()
            self.fallo.emit(str(e))


def dibujo_plancha(trabajo: cnc.TrabajoCNC, ancho_px: int = 860, titulo: str = "", fresa=None) -> QPixmap:
    """El mismo mapa que se guarda junto al .nc, para verlo en la ventana."""
    pm = QPixmap()
    pm.loadFromData(mapa.png(trabajo, titulo, fresa, dpi=90))
    return pm.scaledToWidth(ancho_px, Qt.SmoothTransformation)


def _fases(trabajo: cnc.TrabajoCNC) -> str:
    t = trabajo.tiempos
    return (f"contorno {t.get('contorno', 0):.0f} min, desbaste {t.get('desbaste', 0):.0f} min, "
            f"acabado {t.get('acabado', 0):.0f} min")


class VentanaTirada(QDialog):
    """Lista de moldes de la tirada, plancha, colocación automática y exportación del .nc."""

    def __init__(self, principal):
        super().__init__(principal)
        self.principal = principal
        self.taller = principal.taller
        self.setWindowTitle("Tirada de CNC – varios moldes en una plancha")
        self.resize(1100, 720)
        self.piezas: list[cnc.Pieza] = []
        self.trabajo: cnc.TrabajoCNC | None = None
        self._hilo = None

        izq = QVBoxLayout()
        pl = self.taller["plancha"]
        form = QFormLayout()
        self.cajas = []
        for texto, valor in (("Ancho (X)", pl["ancho_x"]), ("Largo (Y)", pl["largo_y"]), ("Alto (Z)", pl["alto_z"])):
            c = QDoubleSpinBox()
            c.setRange(20, 2000)
            c.setDecimals(0)
            c.setSuffix(" mm")
            c.setValue(valor)
            c.valueChanged.connect(self._invalidar)
            form.addRow(f"Plancha – {texto}:", c)
            self.cajas.append(c)
        izq.addLayout(form)
        izq.addWidget(QLabel("<b>Pies de la tirada</b>"))
        self.lista = QListWidget()
        izq.addWidget(self.lista, 1)
        for texto, accion in (("Añadir el molde abierto", self.anadir_abierto),
                              ("Añadir moldes exportados (STL)…", self.anadir_archivos),
                              ("Quitar el seleccionado", self.quitar),
                              ("Vaciar la tirada", self.vaciar)):
            b = QPushButton(texto)
            b.clicked.connect(accion)
            izq.addWidget(b)
        self.boton_calcular = QPushButton("Colocar y calcular")
        self.boton_calcular.setStyleSheet("font-weight: bold;")
        self.boton_calcular.clicked.connect(self.calcular)
        izq.addWidget(self.boton_calcular)
        self.boton_guardar = QPushButton("Guardar archivo para la CNC (.nc)…")
        self.boton_guardar.clicked.connect(self.guardar)
        self.boton_guardar.setEnabled(False)
        izq.addWidget(self.boton_guardar)

        der = QVBoxLayout()
        self.vista = QLabel("Añade moldes y pulsa «Colocar y calcular».")
        self.vista.setAlignment(Qt.AlignCenter)
        self.vista.setMinimumSize(660, 560)
        self.vista.setStyleSheet("background: #2b2d31; color: #ddd;")
        der.addWidget(self.vista, 1)
        self.info = QLabel()
        self.info.setWordWrap(True)
        der.addWidget(self.info)

        lay = QHBoxLayout(self)
        lay.addLayout(izq, 0)
        lay.addLayout(der, 1)

    def closeEvent(self, evento):
        if self._hilo is not None and self._hilo.isRunning():
            self._hilo.wait()
        super().closeEvent(evento)

    # ------------------------------------------------------------ lista

    def _refrescar_lista(self):
        self.lista.clear()
        paso = self.taller["calculo"]["rejilla"]
        for p in self.piezas:
            ny, nx = p.h.shape
            self.lista.addItem(f"{p.nombre}  ({nx * paso:.0f} × {ny * paso:.0f} mm)")

    def _invalidar(self, *_):
        self.trabajo = None
        self.boton_guardar.setEnabled(False)

    def anadir_piezas(self, nuevas: list[cnc.Pieza]):
        self.piezas += nuevas
        self._refrescar_lista()
        self._invalidar()

    def anadir_abierto(self):
        pr = self.principal.proyecto
        if pr is None:
            QMessageBox.information(self, "Tirada", "No hay ningún molde abierto en la ventana principal.")
            return
        self.anadir_piezas(piezas_de_proyecto(pr, pr.ruta_stl.stem.upper()))

    def anadir_archivos(self):
        rutas, _ = QFileDialog.getOpenFileNames(self, "Moldes exportados", "",
                                                "Moldes (*.stl *.ply *.obj *.zip);;Todos los archivos (*.*)")
        errores = []
        for r in rutas:
            try:
                self.anadir_piezas(piezas_de_archivo(r, self.taller))
            except Exception as e:  # noqa: BLE001
                errores.append(f"{Path(r).name}: {e}")
        if errores:
            QMessageBox.warning(self, "Algunos archivos no se han podido añadir", "\n".join(errores))

    def quitar(self):
        fila = self.lista.currentRow()
        if fila >= 0:
            del self.piezas[fila]
            self._refrescar_lista()
            self._invalidar()

    def vaciar(self):
        self.piezas = []
        self._refrescar_lista()
        self._invalidar()

    # ------------------------------------------------------------ cálculo

    def plancha(self) -> tuple[float, float, float]:
        return tuple(c.value() for c in self.cajas)

    def calcular(self, esperar: bool = False):
        if not self.piezas:
            QMessageBox.information(self, "Tirada", "Añade al menos un molde.")
            return
        self.boton_calcular.setEnabled(False)
        self.info.setText("Calculando las trayectorias…")
        calc = _Calculo(self.piezas, self.plancha(), self.taller)
        if esperar:
            try:
                self._listo(cnc.generar(self.piezas, *self.plancha(), self.taller["calculo"]["rejilla"],
                                        self.taller["fresa"]["diametro"] / 2, self.taller["cnc"]))
            except Exception as e:  # noqa: BLE001
                self._fallo(str(e))
            return
        self._hilo = QThread(self)
        self._calc = calc
        calc.moveToThread(self._hilo)
        self._hilo.started.connect(calc.trabajar)
        calc.terminado.connect(self._listo)
        calc.fallo.connect(self._fallo)
        calc.terminado.connect(self._hilo.quit)
        calc.fallo.connect(self._hilo.quit)
        self._hilo.start()

    def _listo(self, trabajo: cnc.TrabajoCNC):
        self.boton_calcular.setEnabled(True)
        self.trabajo = trabajo
        self.boton_guardar.setEnabled(True)
        self.vista.setPixmap(dibujo_plancha(trabajo, max(self.vista.width() - 10, 600),
                                            fresa=self.taller["fresa"]["diametro"]))
        a, l, h = trabajo.plancha
        texto = (f"<b>{len(trabajo.piezas)} pie(s) colocados</b> en la plancha de {a:.0f} × {l:.0f} × {h:.0f} mm "
                 f"(ocupan el {100 * trabajo.aprovechamiento:.0f} %). "
                 f"Tiempo estimado: <b>{trabajo.tiempo_min:.0f} min</b> ({_fases(trabajo)}).<br>"
                 f"Fresa de bola Ø{self.taller['fresa']['diametro']:g} mm: contorno de cada pie, desbaste en capas "
                 f"de {self.taller['cnc']['bajada_por_pasada']:g} mm y acabado cada "
                 f"{self.taller['cnc']['paso_acabado']:g} mm.")
        if trabajo.avisos:
            texto += "<br><span style='color:#e4572e'>⚠ " + "<br>⚠ ".join(trabajo.avisos) + "</span>"
        self.info.setText(texto)

    def _fallo(self, mensaje: str):
        self.boton_calcular.setEnabled(True)
        self.info.setText("")
        QMessageBox.critical(self, "No se ha podido calcular", mensaje)

    def guardar(self, ruta: str | None = None):
        if self.trabajo is None:
            return
        if not ruta:
            ruta, _ = QFileDialog.getSaveFileName(self, "Guardar para la CNC", "TIRADA.nc", "G-code (*.nc)")
            if not ruta:
                return
        ruta = Path(ruta)
        ruta.write_text(self.trabajo.gcode, encoding="ascii", errors="replace")
        hoja = ruta.with_suffix(".txt")
        a, l, h = self.trabajo.plancha
        lineas = [
            "TIRADA DE CNC - Rectificador de moldes Ortosend", "",
            f"Plancha de {self.taller['cnc'].get('material', '')}: {a:.0f} x {l:.0f} x {h:.0f} mm",
            "Origen: X0 Y0 = esquina delantera izquierda de la plancha; Z0 = cara de arriba.",
            f"Fresa: punta de bola de {self.taller['fresa']['diametro']:.0f} mm.",
            f"Tiempo estimado: {self.trabajo.tiempo_min:.0f} min ({_fases(self.trabajo)})",
            "Por cada pie: 1) contorno de la silueta, 2) desbaste por capas, 3) acabado en lineas paralelas a X.",
            "", "Pies, en el orden en que se fresan (el numero es el del mapa y el de «Pieza N» del .nc):",
        ]
        for f in self.trabajo.fichas:
            lineas.append(f"  {f.numero}. {f.nombre}: X {f.x[0]:.0f}-{f.x[1]:.0f} mm, Y {f.y[0]:.0f}-{f.y[1]:.0f} mm, "
                          f"alto {f.alto:.0f} mm, {f.tiempo_min:.0f} min"
                          + (f", girado {90 * f.pieza.giro}°" if f.pieza.giro else ""))
        for av in self.trabajo.avisos:
            lineas.append("AVISO: " + av)
        hoja.write_text("\n".join(lineas) + "\n", encoding="utf-8")
        png, pdf = mapa.guardar(self.trabajo, ruta, ruta.stem.upper(), self.taller["fresa"]["diametro"])
        if not getattr(self, "_silencio", False):
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(pdf)))  # el mapa, para verlo o imprimirlo
            QMessageBox.information(self, "Guardado", f"Archivos guardados:\n{ruta}\n{hoja}\n{png}\n{pdf}"
                                    "\n\nCopia el .nc al USB/tarjeta de la CNC.\n"
                                    "Imprime el mapa (PDF) para saber qué molde es cada uno en la plancha.")
