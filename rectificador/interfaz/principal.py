"""Ventana principal del rectificador de moldes.

Arrancar (desde la carpeta rectificador):  python -m interfaz.principal [ESCANEO.stl]
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

import numpy as np
from PySide6.QtCore import QObject, QSettings, QThread, Qt, Signal
from PySide6.QtGui import QAction, QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QApplication, QButtonGroup, QCheckBox, QDoubleSpinBox, QFileDialog, QFrame, QHBoxLayout,
    QLabel, QMainWindow, QMessageBox, QProgressDialog, QPushButton, QScrollArea, QSizePolicy, QSplitter,
    QToolBar, QVBoxLayout, QWidget,
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from interfaz import estilo  # noqa: E402
from interfaz.estilo import C  # noqa: E402
from interfaz.visor import COLORES, Visor  # noqa: E402
from ortomolde.exportar import exportar, medidas_stl  # noqa: E402
from ortomolde import config  # noqa: E402
from ortomolde.limpieza import NOMBRE_MODO  # noqa: E402
from ortomolde.proyecto import Proyecto  # noqa: E402
from ortomolde.referencias import NOMBRES, OPCIONALES, ORDEN  # noqa: E402

AYUDA = (
    "<b>Proponer referencias</b> coloca las 5 cabezas metatarsales y el talón para empezar.<br>"
    "<b>Ajustar un punto:</b> cógelo con el botón izquierdo y arrástralo sobre el molde.<br>"
    "<b>Marcar a mano:</b> clic <b>derecho</b> sobre el pie (orden: 1.er MTT, 5.º MTT, talón y, si quieres, "
    "2.º, 3.º y 4.º). Para corregir una, pulsa su botón «Marcar» y haz clic derecho donde va.<br>"
    "<b>Vista 3D:</b> girar = arrastrar · desplazar = Mayús + arrastrar · zoom = rueda."
)


class Cargador(QObject):
    """Abre (y limpia) el escaneo en segundo plano para que la ventana no se congele."""

    terminado = Signal(int, object)
    fallo = Signal(int, str)

    def __init__(self, ruta: str, modo: str, peticion: int):
        super().__init__()
        self.ruta = ruta
        self.modo = modo
        self.peticion = peticion  # número de apertura: si llega tarde, la ventana lo ignora

    def trabajar(self):
        try:
            self.terminado.emit(self.peticion, Proyecto.abrir(self.ruta, modo=self.modo))
        except Exception as e:  # noqa: BLE001 - se muestra al usuario
            traceback.print_exc()
            self.fallo.emit(self.peticion, str(e))


class PanelPie(QFrame):
    """Tarjeta de un pie: sus referencias, el recorte en arco y sus medidas."""

    def __init__(self, ventana: "VentanaPrincipal", clave: str):
        super().__init__()
        self.ventana, self.clave = ventana, clave
        self.setObjectName("tarjeta")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(14, 12, 14, 14)
        lay.setSpacing(6)
        cab = QHBoxLayout()
        self.paso = QLabel("3" if clave == "p0" else "4")
        self.paso.setObjectName("paso")
        self.paso.setAlignment(Qt.AlignCenter)
        cab.addWidget(self.paso)
        self.titulo = QLabel()
        self.titulo.setObjectName("titulo_tarjeta")
        cab.addWidget(self.titulo, 1)
        lay.addLayout(cab)

        fila = QHBoxLayout()
        proponer = QPushButton("Proponer referencias")
        proponer.setToolTip("Coloca las 5 cabezas metatarsales y el talón automáticamente.\n"
                            "Después ajústalas arrastrándolas sobre el molde.")
        proponer.clicked.connect(lambda: self.ventana.proponer_referencias(self.clave))
        estilo.primario(proponer)
        fila.addWidget(proponer, 1)
        borrar = QPushButton("Borrar")
        borrar.setToolTip("Quita todas las referencias de este pie.")
        borrar.setIcon(estilo.icono("quitar"))
        borrar.clicked.connect(lambda: self.ventana.borrar_referencias(self.clave))
        fila.addWidget(borrar)
        lay.addLayout(fila)

        self.etiquetas: dict[str, QLabel] = {}
        self.grupo = QButtonGroup(self)
        self.grupo.setExclusive(False)
        for k in ORDEN:
            fila = QHBoxLayout()
            fila.setSpacing(8)
            punto = QLabel("●")
            punto.setStyleSheet(f"color: {COLORES[k]}; font-size: 14pt;")
            punto.setFixedWidth(16)
            fila.addWidget(punto)
            self.etiquetas[k] = QLabel()
            fila.addWidget(self.etiquetas[k], 1)
            boton = QPushButton("Marcar")
            boton.setCheckable(True)
            boton.setProperty("pequeno", True)
            boton.setToolTip(f"Pulsa y haz clic derecho sobre el pie para marcar: {NOMBRES[k]}")
            boton.clicked.connect(lambda marcado, k=k: self.ventana.elegir_referencia(self.clave, k if marcado else None))
            self.grupo.addButton(boton)
            boton.setProperty("referencia", k)
            fila.addWidget(boton)
            lay.addLayout(fila)

        separador = QFrame()
        separador.setFrameShape(QFrame.HLine)
        separador.setStyleSheet(f"color: {C['borde']};")
        lay.addWidget(separador)
        # Recorte en arco
        self.recortar = QCheckBox("Recortar en arco por delante de las cabezas")
        self.recortar.toggled.connect(lambda v: self.ventana.cambiar_recorte(self.clave, activo=v))
        lay.addWidget(self.recortar)
        fila = QHBoxLayout()
        fila.addWidget(estilo.etiqueta("Adelanto", "secundario", envolver=False))
        self.adelanto = QDoubleSpinBox()
        self.adelanto.setRange(-30.0, 40.0)
        self.adelanto.setSingleStep(1.0)
        self.adelanto.setDecimals(1)
        self.adelanto.setSuffix(" mm")
        self.adelanto.setToolTip("Distancia del arco por delante de las cabezas (negativo = por detrás).")
        self.adelanto.valueChanged.connect(lambda v: self.ventana.cambiar_recorte(self.clave, adelanto=v))
        fila.addWidget(self.adelanto, 1)
        fila.addSpacing(8)
        fila.addWidget(estilo.etiqueta("Curvatura", "secundario", envolver=False))
        self.curvatura = QDoubleSpinBox()
        self.curvatura.setRange(0.0, 3.0)
        self.curvatura.setSingleStep(0.1)
        self.curvatura.setDecimals(1)
        self.curvatura.setToolTip("0 = recto · 1 = parábola metatarsal · más = más curvado.")
        self.curvatura.valueChanged.connect(lambda v: self.ventana.cambiar_recorte(self.clave, curvatura=v))
        fila.addWidget(self.curvatura, 1)
        lay.addLayout(fila)

        self.medidas = QLabel()
        self.medidas.setObjectName("cifras")
        self.medidas.setWordWrap(True)
        self.medidas.setToolTip("Medidas reales del molde en mm, para comprobar la escala.")
        lay.addWidget(self.medidas)

    def setTitle(self, texto: str):
        self.titulo.setText(texto.upper())

    def actualizar(self, pie, proyecto, activa: str | None):
        x_medio = np.nonzero(pie.mascara)[1].mean() * proyecto.original.rejilla.dx
        mitad = "izquierda" if x_medio < proyecto.original.rejilla.ancho / 2 else "derecha"
        self.setTitle(f"{pie.nombre} · mitad {mitad}")
        for k in ORDEN:
            if k in pie.referencias.puntos:
                x, y = pie.referencias.puntos[k]
                xt, yt, zt = proyecto.a_taller(x, y, proyecto.altura_en(x, y))
                texto = (f"{NOMBRES[k]}<br><span style='color:{C['apagado']}; font-size:8.5pt'>"
                         f"X {xt:.1f} · Y {yt:.1f} · Z {zt:.1f}</span>")
            else:
                estado = "opcional" if k in OPCIONALES else "sin marcar"
                texto = f"{NOMBRES[k]}<br><span style='color:{C['apagado']}; font-size:8.5pt'>{estado}</span>"
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
        m = proyecto.medidas(pie)
        partes = [f"<b style='color:{C['texto']}'>Medidas (mm)</b> · largo {m['largo']:.0f} · "
                  f"ancho máx. {m['ancho_maximo']:.0f}"]
        if "ancho_cabezas" in m:
            partes.append(f"ancho a las cabezas {m['ancho_cabezas']:.0f} · ancho talón {m['ancho_talon']:.0f}")
            partes.append(f"talón→1.er MTT {m['talon_mtt1']:.0f} · talón→5.º MTT {m['talon_mtt5']:.0f} · "
                          f"1.º↔5.º MTT {m['mtt1_mtt5']:.0f}")
        partes.append(f"altura máx. del relieve {m['altura_maxima']:.1f}")
        self.medidas.setText("<br>".join(partes))
        # Alto suficiente para que no se corte ninguna línea.
        self.medidas.setMinimumHeight(self.medidas.fontMetrics().lineSpacing() * (len(partes) + 1) + 10)


class VentanaPrincipal(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Rectificador de moldes – Ortosend")
        self.resize(1400, 850)
        self.proyecto: Proyecto | None = None
        self.taller = config.taller()
        self.tirada = None  # ventana «Tirada de CNC» (se crea al abrirla)
        self._peticion = 0  # cada apertura lleva un número; solo vale el resultado de la última
        self._hilos: list = []
        self.activa: tuple[str, str] | None = None  # (pie, referencia) que se va a marcar
        self._hilo = None

        self.medida: list = []  # puntos de la herramienta Medir
        self.visor = Visor(self, al_hacer_clic=self.clic_en_molde,
                           al_arrastrar=self.arrastrar_referencia, al_soltar=self.soltar_referencia,
                           al_pasar=self.raton_sobre_molde)
        self.posicion = QLabel()
        self.statusBar().addPermanentWidget(self.posicion)
        self.statusBar().setSizeGripEnabled(False)

        panel = QWidget()
        self.lay_panel = QVBoxLayout(panel)
        self.lay_panel.setContentsMargins(4, 8, 10, 8)
        self.lay_panel.setSpacing(10)
        self.lay_panel.addWidget(self._grupo_escaneo())
        self.lay_panel.addWidget(self._grupo_molde())
        self.paneles = {c: PanelPie(self, c) for c in ("p0", "p1")}
        for p in self.paneles.values():
            self.lay_panel.addWidget(p)
        self.lay_panel.addWidget(self._grupo_ayuda())
        self.lay_panel.addStretch(1)
        desplazable = QScrollArea()
        desplazable.setWidget(panel)
        desplazable.setWidgetResizable(True)
        desplazable.setMinimumWidth(430)
        desplazable.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)

        marco_visor = QFrame()
        marco_visor.setObjectName("tarjeta")
        lv = QVBoxLayout(marco_visor)
        lv.setContentsMargins(1, 1, 1, 1)
        lv.addWidget(self.visor)
        division = QSplitter(Qt.Horizontal)
        division.addWidget(marco_visor)
        division.addWidget(desplazable)
        division.setStretchFactor(0, 1)
        division.setSizes([1000, 440])
        contenedor = QWidget()
        lc = QVBoxLayout(contenedor)
        lc.setContentsMargins(10, 10, 6, 6)
        lc.addWidget(division)
        self.setCentralWidget(contenedor)
        self.setAcceptDrops(True)
        self._menus()
        self._barra()
        self._refrescar_panel()

    def _grupo_escaneo(self) -> QFrame:
        """Paso 1: el escaneo abierto y qué se ha escaneado (huella en espuma o molde ya hecho)."""
        marco, lay, _ = estilo.tarjeta("Escaneo", "1")
        self.info = estilo.etiqueta("Abre un escaneo con el botón <b>Abrir</b> de arriba "
                                    "(o arrastra aquí el archivo).")
        lay.addWidget(self.info)
        lay.addWidget(estilo.etiqueta("Qué se ha escaneado:", "secundario"))
        fila = QHBoxLayout()
        fila.setSpacing(0)
        self.botones_modo = {}
        grupo = QButtonGroup(self)
        grupo.setExclusive(True)
        for modo, texto, ayuda, lado in (
            ("huellas", "Huellas en espuma", "La huella del pie hundida en los bloques de espuma.", "izq"),
            ("moldes", "Molde ya hecho", "Un molde que ya existe, con el pie en bulto sobre una base.", "der"),
        ):
            b = QPushButton(texto)
            b.setCheckable(True)
            b.setProperty("segmento", lado)
            b.setToolTip(ayuda + "\nPuede haber 1 o 2 pies.")
            b.toggled.connect(lambda marcado, m=modo: marcado and self.cambiar_modo(m))
            grupo.addButton(b)
            fila.addWidget(b, 1)
            self.botones_modo[modo] = b
        lay.addLayout(fila)
        self.ajustes = QSettings("Ortosend", "Rectificador")
        modo = self.ajustes.value("modo", "huellas")
        self.modo = modo if modo in self.botones_modo else "huellas"
        self.botones_modo[self.modo].blockSignals(True)
        self.botones_modo[self.modo].setChecked(True)
        self.botones_modo[self.modo].blockSignals(False)
        self.avisos = estilo.etiqueta("", "aviso")
        self.avisos.hide()
        lay.addWidget(self.avisos)
        self.boton_lados = QPushButton("Intercambiar izquierdo ↔ derecho")
        self.boton_lados.setIcon(estilo.icono("lados"))
        self.boton_lados.setToolTip("Si el programa se ha equivocado de pie, pulsa aquí.")
        self.boton_lados.clicked.connect(self.intercambiar_lados)
        lay.addWidget(self.boton_lados)
        return marco

    def _grupo_ayuda(self) -> QFrame:
        """Ayuda plegable."""
        marco, lay, _ = estilo.tarjeta("Ayuda")
        boton = QPushButton("  Cómo marcar y ajustar las referencias")
        boton.setIcon(estilo.icono("ayuda", C["secundario"]))
        boton.setProperty("plano", True)
        boton.setCheckable(True)
        boton.setStyleSheet("text-align: left;")
        texto = estilo.etiqueta(AYUDA, "nota")
        texto.setVisible(False)
        boton.toggled.connect(texto.setVisible)
        lay.addWidget(boton)
        lay.addWidget(texto)
        return marco

    def cambiar_modo(self, modo: str):
        if modo == self.modo:
            return
        self.modo = modo
        self.ajustes.setValue("modo", modo)
        if self.proyecto is not None:
            # Volver a procesar el mismo escaneo con el otro modo.
            self.abrir(str(self.proyecto.ruta_stl))

    def _grupo_molde(self) -> QFrame:
        """Paso 2: lijado, comparar con el escaneo y medir."""
        marco, lay, _ = estilo.tarjeta("Molde", "2")
        fila = QHBoxLayout()
        fila.addWidget(estilo.etiqueta("Lijado (tamaño del taco)", envolver=False), 1)
        self.caja_lijado = QDoubleSpinBox()
        self.caja_lijado.setRange(0.0, 12.0)
        self.caja_lijado.setSingleStep(0.5)
        self.caja_lijado.setDecimals(1)
        self.caja_lijado.setSuffix(" mm")
        self.caja_lijado.setMinimumWidth(110)
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
        self.boton_medir = QPushButton("Medir distancia")
        self.boton_medir.setIcon(estilo.icono("medir"))
        self.boton_medir.setCheckable(True)
        self.boton_medir.setToolTip("Actívalo (tecla M) y haz dos clics derechos sobre el molde: se dibuja la "
                                    "distancia en mm.\nEsc o volver a pulsar para quitarla.")
        self.boton_medir.toggled.connect(self.modo_medir)
        lay.addWidget(self.boton_medir)
        self.texto_medida = estilo.etiqueta()
        self.texto_medida.hide()
        lay.addWidget(self.texto_medida)
        self.texto_recuadro = estilo.etiqueta("", "nota")
        lay.addWidget(self.texto_recuadro)
        QShortcut(QKeySequence("M"), self, activated=self.boton_medir.toggle)
        QShortcut(QKeySequence("Esc"), self, activated=lambda: self.boton_medir.setChecked(False))
        return marco

    def modo_medir(self, activo: bool):
        self.medida = []
        self.visor.borrar_medida()
        self.texto_medida.setText(
            "Haz clic derecho en el primer punto y luego en el segundo." if activo else "")
        self.texto_medida.setVisible(activo)

    def raton_sobre_molde(self, punto):
        if self.proyecto is None or punto is None:
            self.posicion.setText("")
            return
        x, y, z = punto
        xt, yt, zt = self.proyecto.a_taller(x, y, z)
        self.posicion.setText(f"X {xt:.1f}  Y {yt:.1f} mm  ·  altura {z:.1f} mm (Z taller {zt:.1f})")

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
        self.acciones = {}
        archivo = self.menuBar().addMenu("&Archivo")
        for clave, texto, atajo, accion, ic in (
            ("abrir", "Abrir escaneo…", QKeySequence.Open, self.abrir_dialogo, "abrir"),
            ("exportar", "Exportar…", QKeySequence("Ctrl+E"), self.exportar, "exportar"),
            ("anadir", "Añadir este molde a la tirada de CNC", QKeySequence("Ctrl+T"), self.anadir_a_tirada, "anadir"),
            ("tirada", "Tirada de CNC (varios moldes en una plancha)…", QKeySequence("Ctrl+Shift+T"),
             self.abrir_tirada, "cnc"),
            ("salir", "Salir", QKeySequence.Quit, self.close, None),
        ):
            a = QAction(texto, self)
            a.setShortcut(atajo)
            a.triggered.connect(accion)
            if ic:
                a.setIcon(estilo.icono(ic))
            archivo.addAction(a)
            self.acciones[clave] = a
        ver = self.menuBar().addMenu("&Ver")
        for clave, texto, accion, ic in (("inicial", "Vista inicial", lambda: self.visor.vista_inicial(), "vista"),
                                         ("planta", "Vista de planta (desde arriba)", lambda: self.visor.vista_planta(),
                                          "planta")):
            a = QAction(estilo.icono(ic), texto, self)
            a.triggered.connect(accion)
            ver.addAction(a)
            self.acciones[clave] = a
        reglas = QAction("Mostrar reglas en mm", self)
        reglas.setCheckable(True)
        reglas.setChecked(True)
        reglas.toggled.connect(self.visor.mostrar_reglas)
        ver.addAction(reglas)

    def _barra(self):
        """Barra de herramientas de arriba: lo que más se usa, con icono y texto."""
        barra = QToolBar("Herramientas")
        barra.setMovable(False)
        barra.setIconSize(estilo.TAM_ICONO)
        barra.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        titulo = QLabel("  Ortosend · Rectificador")
        titulo.setObjectName("titulo_app")
        barra.addWidget(titulo)
        barra.addSeparator()
        cortos = {"abrir": "Abrir", "exportar": "Exportar", "anadir": "Añadir a la tirada", "tirada": "Tirada CNC",
                  "inicial": "Vista inicial", "planta": "Desde arriba"}
        for clave in ("abrir", "exportar", "anadir", "tirada", None, "inicial", "planta"):
            if clave is None:
                barra.addSeparator()
                continue
            a = self.acciones[clave]
            a.setIconText(cortos[clave])
            a.setToolTip(f"{a.text().rstrip('…')} ({a.shortcut().toString()})" if not a.shortcut().isEmpty()
                         else a.text())
            barra.addAction(a)
        medir = QAction(estilo.icono("medir"), "Medir", self)
        medir.setCheckable(True)
        medir.setToolTip("Medir una distancia en mm (M)")
        medir.toggled.connect(self.boton_medir.setChecked)
        self.boton_medir.toggled.connect(medir.setChecked)
        barra.addAction(medir)
        relleno = QWidget()
        relleno.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        barra.addWidget(relleno)
        self.addToolBar(Qt.TopToolBarArea, barra)
        self.barra = barra
        self._activar_acciones()

    def _activar_acciones(self):
        hay = self.proyecto is not None
        for clave in ("exportar", "anadir", "inicial", "planta"):
            if clave in getattr(self, "acciones", {}):
                self.acciones[clave].setEnabled(hay)

    # ---------------------------------------------------------------- abrir

    def abrir_dialogo(self):
        ruta, _ = QFileDialog.getOpenFileName(
            self, "Abrir escaneo", "",
            "Escaneos (*.stl *.ply *.obj *.revox *.zip);;Proyecto de Revo Scan (*.revox);;"
            "Mallas (*.stl *.ply *.obj);;ZIP (*.zip);;Todos los archivos (*.*)")
        if ruta:
            self.abrir(ruta)

    def abrir(self, ruta: str, esperar: bool = False):
        """Abre el escaneo en segundo plano. Con `esperar` (pruebas) lo hace en este hilo."""
        self._peticion += 1
        if esperar:
            self._cargado(self._peticion, Proyecto.abrir(ruta, modo=self.modo))
            return
        if getattr(self, "_progreso", None):
            self._progreso.close()
        self._progreso = QProgressDialog("Leyendo y limpiando el escaneo…", None, 0, 0, self)
        self._progreso.setWindowTitle("Abriendo")
        self._progreso.setWindowModality(Qt.WindowModal)
        self._progreso.show()
        hilo = QThread(self)
        cargador = Cargador(ruta, self.modo, self._peticion)
        cargador.moveToThread(hilo)
        hilo.started.connect(cargador.trabajar)
        cargador.terminado.connect(self._cargado)
        cargador.fallo.connect(self._fallo)
        cargador.terminado.connect(hilo.quit)
        cargador.fallo.connect(hilo.quit)
        hilo.finished.connect(lambda h=hilo, c=cargador: self._hilos.remove((h, c)) if (h, c) in self._hilos else None)
        self._hilos.append((hilo, cargador))
        self._hilo = hilo
        hilo.start()

    def _cargado(self, peticion: int, proyecto: Proyecto):
        if peticion != self._peticion:
            return  # resultado de una apertura anterior que ha llegado tarde
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

    def _fallo(self, peticion: int, mensaje: str):
        if peticion != self._peticion:
            return
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
        if self.boton_medir.isChecked():
            if len(self.medida) >= 2:
                self.medida = []
                self.visor.borrar_medida()
            self.medida.append((x, y, z))
            if len(self.medida) == 2:
                dp, d3 = self.visor.dibujar_medida(*self.medida)
                self.texto_medida.setText(f"<b>Distancia: {dp:.1f} mm</b> en planta "
                                          f"({d3:.1f} mm en línea recta en 3D). Otro clic empieza otra medida.")
            else:
                self.texto_medida.setText("Primer punto marcado. Clic derecho en el segundo.")
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

    def _mover_referencia(self, clave: str, nombre: str, x: float, y: float) -> bool:
        """Mueve una referencia si el punto sigue dentro de su pie."""
        pie = self.proyecto.pies[int(clave[1])]
        if self.proyecto.pie_en(x, y) is not pie:
            return False
        pie.referencias.puntos[nombre] = (float(x), float(y))
        return True

    def arrastrar_referencia(self, clave: str, nombre: str, x: float, y: float):
        """Vista previa mientras se arrastra: se redibujan punto, eje, arco y recorte (sin recalcular el molde)."""
        if not self.proyecto or not self._mover_referencia(clave, nombre, x, y):
            return
        pie = self.proyecto.pies[int(clave[1])]
        try:
            geom = self.proyecto.geometria(pie)
            recorte = self.proyecto.linea_recorte(pie)
        except ValueError:
            geom, recorte = None, None
        self.visor.dibujar_pie(clave, pie, geom, recorte)

    def soltar_referencia(self, clave: str, nombre: str, x: float, y: float):
        if not self.proyecto:
            return
        self._mover_referencia(clave, nombre, x, y)
        pie = self.proyecto.pies[int(clave[1])]
        self.statusBar().showMessage(f"{pie.nombre}: {NOMBRES[nombre]} movida.", 4000)
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
        self._activar_acciones()
        if p is None:
            for panel in self.paneles.values():
                panel.hide()
            return
        self.info.setText(
            f"<span style='font-size:11pt; font-weight:600'>{p.ruta_stl.name}</span><br>"
            f"<span style='color:{C['secundario']}'>"
            f"{('Escaneo en bruto · ' + NOMBRE_MODO[p.informe.modo]) if p.informe else 'Molde ya limpio'} · "
            f"{len(p.pies)} pie(s) encontrado(s)</span>"
        )
        self.avisos.setText("<br>".join(f"⚠ {a}" for a in p.avisos))
        self.avisos.setVisible(bool(p.avisos))
        r = p.original.rejilla
        self.texto_recuadro.setText(f"Recuadro: {r.ancho:.0f} × {r.largo:.0f} mm · bloque de "
                                    f"{p.taller['recuadro']['alto_z']:.0f} mm de alto")
        for clave, panel in self.paneles.items():
            k = int(clave[1])
            if k < len(p.pies):
                activa = self.activa[1] if self.activa and self.activa[0] == clave else None
                panel.actualizar(p.pies[k], p, activa)
                panel.show()
            else:
                panel.hide()

    # Arrastrar un escaneo desde el Explorador de Windows y soltarlo sobre la ventana lo abre.
    FORMATOS = (".stl", ".ply", ".obj", ".revox", ".zip")

    def _ruta_soltada(self, evento) -> str | None:
        for url in evento.mimeData().urls():
            if url.isLocalFile() and url.toLocalFile().lower().endswith(self.FORMATOS):
                return url.toLocalFile()
        return None

    def dragEnterEvent(self, evento):
        if self._ruta_soltada(evento):
            evento.acceptProposedAction()

    def dropEvent(self, evento):
        ruta = self._ruta_soltada(evento)
        if ruta:
            evento.acceptProposedAction()
            self.abrir(ruta)

    def closeEvent(self, evento):
        # Si se está procesando un escaneo en segundo plano, esperar a que acabe antes de cerrar.
        for hilo, _ in list(self._hilos):
            if hilo.isRunning():
                hilo.wait()
        super().closeEvent(evento)

    # ---------------------------------------------------------------- CNC

    def abrir_tirada(self):
        from interfaz.tirada import VentanaTirada
        if self.tirada is None:
            self.tirada = VentanaTirada(self)
        self.tirada.show()
        self.tirada.raise_()
        return self.tirada

    def anadir_a_tirada(self):
        if not self.proyecto:
            return
        t = self.abrir_tirada()
        t.anadir_abierto()
        self.statusBar().showMessage("Molde añadido a la tirada de CNC.", 4000)

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
        a = medidas_stl(rutas["stl"])
        f = medidas_stl(rutas["fusion"])
        escala = self.proyecto.taller["fusion"]["escala"]
        QMessageBox.information(
            self, "Exportado",
            "Archivos guardados:\n" + "\n".join(str(r) for r in rutas.values()) + "\n\n"
            f"Medidas para comprobar la escala:\n"
            f"  {rutas['stl'].name}: {a[0]:.1f} × {a[1]:.1f} × {a[2]:.1f} mm\n"
            f"  {rutas['fusion'].name}: {f[0]:.2f} × {f[1]:.2f} × {f[2]:.2f} (unidades del archivo)\n"
            f"  → En Fusion (cm) debe medir {f[0]:.2f} × {f[1]:.2f} × {f[2]:.2f} cm "
            f"= {f[0] / escala:.0f} × {f[1] / escala:.0f} × {f[2] / escala:.1f} mm.")


def main():
    app = QApplication(sys.argv)
    estilo.aplicar(app)
    ventana = VentanaPrincipal()
    ventana.show()
    if len(sys.argv) > 1:
        ventana.abrir(sys.argv[1])
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
