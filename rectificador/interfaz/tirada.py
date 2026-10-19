"""Ventana «Tirada de CNC»: varios moldes en una misma plancha de escayola y un solo archivo .nc."""

from __future__ import annotations

import traceback
from pathlib import Path

from PySide6.QtCore import QObject, Qt, QThread, QTimer, QUrl, Signal
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
                                            self.taller["fresa"]["diametro"] / 2, self.taller["cnc"],
                                            colocar_antes=False))
        except Exception as e:  # noqa: BLE001 - se muestra al usuario
            traceback.print_exc()
            self.fallo.emit(str(e))


def dibujo_plancha(trabajo: cnc.TrabajoCNC, ancho_px: int = 860, titulo: str = "", fresa=None,
                   resaltar: int | None = None) -> QPixmap:
    """El mismo mapa que se guarda junto al .nc, para verlo en la ventana."""
    pm = QPixmap()
    pm.loadFromData(mapa.png(trabajo, titulo, fresa, dpi=90, resaltar=resaltar))
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
        self.previa: cnc.TrabajoCNC | None = None  # colocación sin trayectorias (se ve al momento)
        self._hilo = None
        self._reloj = QTimer(self)  # espera a que se deje de teclear la medida de la plancha
        self._reloj.setSingleShot(True)
        self._reloj.setInterval(400)
        self._reloj.timeout.connect(self._previsualizar)

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
            c.valueChanged.connect(lambda *_: (self._invalidar(previa=False), self._reloj.start()))
            form.addRow(f"Plancha – {texto}:", c)
            self.cajas.append(c)
        izq.addLayout(form)
        izq.addWidget(QLabel("<b>Pies de la tirada</b>"))
        self.lista = QListWidget()
        self.lista.currentRowChanged.connect(lambda *_: self._dibujar())
        self.lista.setMinimumWidth(330)
        izq.addWidget(self.lista, 1)
        nota = QLabel("La colocación se ve al momento en el mapa. El número de cada pie es el orden en que se "
                      "fresa. Selecciona un pie en la lista para verlo resaltado.")
        nota.setWordWrap(True)
        nota.setStyleSheet("color: #666; font-size: 11px;")
        izq.addWidget(nota)
        for texto, accion in (("Añadir el molde abierto", self.anadir_abierto),
                              ("Añadir moldes exportados (STL)…", self.anadir_archivos),
                              ("Quitar el seleccionado", self.quitar),
                              ("Vaciar la tirada", self.vaciar)):
            b = QPushButton(texto)
            b.clicked.connect(accion)
            izq.addWidget(b)
        self.boton_calcular = QPushButton("Calcular trayectorias")
        self.boton_calcular.setStyleSheet("font-weight: bold;")
        self.boton_calcular.clicked.connect(self.calcular)
        izq.addWidget(self.boton_calcular)
        self.boton_guardar = QPushButton("Guardar archivo para la CNC (.nc)…")
        self.boton_guardar.clicked.connect(self.guardar)
        self.boton_guardar.setEnabled(False)
        izq.addWidget(self.boton_guardar)

        der = QVBoxLayout()
        self.vista = QLabel("Añade moldes: verás aquí dónde queda cada uno en la plancha.")
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

    def _numero(self, pieza) -> int | None:
        hecho = self.trabajo or self.previa
        if hecho is None:
            return None
        for f in hecho.fichas:
            if f.pieza is pieza:
                return f.numero
        return None

    def _refrescar_lista(self):
        fila = self.lista.currentRow()
        self.lista.blockSignals(True)
        self.lista.clear()
        paso = self.taller["calculo"]["rejilla"]
        for p in self.piezas:
            ny, nx = p.h.shape
            n = self._numero(p)
            delante = f"{n}.  " if n else ("NO CABE · " if self.previa is not None else "")
            self.lista.addItem(f"{delante}{p.nombre}  ({nx * paso:.0f} × {ny * paso:.0f} mm)")
        self.lista.setCurrentRow(min(fila, self.lista.count() - 1))
        self.lista.blockSignals(False)

    def _invalidar(self, *_, previa: bool = True):
        """Algo ha cambiado: lo calculado ya no vale y se vuelve a colocar (vista previa)."""
        self.trabajo = None
        self.boton_guardar.setEnabled(False)
        if previa:
            self._previsualizar()

    def _previsualizar(self):
        """Coloca los pies en la plancha y enseña el mapa sin calcular trayectorias (casi instantáneo)."""
        self.trabajo = None
        self.boton_guardar.setEnabled(False)
        if not self.piezas:
            self.previa = None
            self._refrescar_lista()
            self.vista.setPixmap(QPixmap())
            self.vista.setText("Añade moldes: verás aquí dónde queda cada uno en la plancha.")
            self.info.setText("")
            return
        self.previa = cnc.previsualizar(self.piezas, *self.plancha(), self.taller["calculo"]["rejilla"],
                                        self.taller["fresa"]["diametro"] / 2, self.taller["cnc"])
        self._refrescar_lista()
        self._dibujar()
        texto = (f"<b>Vista previa:</b> {len(self.previa.piezas)} pie(s) colocados en la plancha. "
                 "Si está bien, pulsa <b>Calcular trayectorias</b> para generar el archivo de la CNC "
                 "(se respeta esta colocación y esta numeración).")
        if self.previa.avisos:
            texto += "<br><span style='color:#e4572e'>⚠ " + "<br>⚠ ".join(self.previa.avisos) + "</span>"
        self.info.setText(texto)

    def _dibujar(self):
        hecho = self.trabajo or self.previa
        if hecho is None:
            return
        fila = self.lista.currentRow()
        resaltar = self._numero(self.piezas[fila]) if 0 <= fila < len(self.piezas) else None
        self.vista.setPixmap(dibujo_plancha(hecho, max(self.vista.width() - 10, 600),
                                            fresa=self.taller["fresa"]["diametro"], resaltar=resaltar))

    def anadir_piezas(self, nuevas: list[cnc.Pieza]):
        self.piezas += nuevas
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
            self._invalidar()

    def vaciar(self):
        self.piezas = []
        self._invalidar()

    # ------------------------------------------------------------ cálculo

    def plancha(self) -> tuple[float, float, float]:
        return tuple(c.value() for c in self.cajas)

    def calcular(self, esperar: bool = False):
        if not self.piezas:
            QMessageBox.information(self, "Tirada", "Añade al menos un molde.")
            return
        if self.previa is None or self._reloj.isActive():
            self._reloj.stop()
            self._previsualizar()
        if not self.previa.piezas:
            QMessageBox.information(self, "Tirada", "Ningún pie cabe en esta plancha.")
            return
        self.boton_calcular.setEnabled(False)
        self.info.setText("Calculando las trayectorias (con la colocación que ves en el mapa)…")
        calc = _Calculo(self.piezas, self.plancha(), self.taller)
        if esperar:
            try:
                self._listo(cnc.generar(self.piezas, *self.plancha(), self.taller["calculo"]["rejilla"],
                                        self.taller["fresa"]["diametro"] / 2, self.taller["cnc"],
                                        colocar_antes=False))
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
        self._refrescar_lista()
        self._dibujar()
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
