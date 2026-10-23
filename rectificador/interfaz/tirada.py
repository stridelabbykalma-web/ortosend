"""Ventana «Tirada de CNC»: varios moldes en una misma plancha de escayola y un solo archivo .nc."""

from __future__ import annotations

import tempfile
import threading
import traceback
import uuid
from pathlib import Path

from PySide6.QtCore import QObject, Qt, QThread, QTimer, QUrl, Signal
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QComboBox, QDialog, QDoubleSpinBox, QFileDialog, QFormLayout, QHBoxLayout, QInputDialog, QListWidget,
    QMessageBox, QPushButton, QVBoxLayout,
)

from ortomolde import cnc, mapa
from ortomolde import placa as placa_mod
from ortomolde.campo import malla_a_campo
from ortomolde.entrada import cargar_malla
from ortomolde.pies import detectar_pies
from ortomolde.trabajo import pedido_de_ruta

from interfaz import estilo
from interfaz.estilo import C
from interfaz.plancha_vista import VistaPlancha
from interfaz.web import ErrorWeb


class _Puente(QObject):
    hecho = Signal(object, object)  # (función, resultado)
    fallo = Signal(object, object)  # (función, error)


def _con_pedido(piezas: list[cnc.Pieza], pedido: int | None) -> list[cnc.Pieza]:
    """Apunta el nº de pedido en cada pie (y lo pone delante del nombre: sale en el mapa y en el .nc)."""
    if pedido:
        for p in piezas:
            p.pedido = int(pedido)
            p.nombre = f"#{p.pedido} {p.nombre}"
    return piezas


def piezas_de_proyecto(proyecto, nombre: str) -> list[cnc.Pieza]:
    """Las piezas (un pie cada una) del molde abierto, tal como se exportaría."""
    c = proyecto.calcular()
    piezas = cnc.piezas_de_molde(c.z, proyecto.fondo_molde, [p.mascara for p in proyecto.pies],
                                 [f"{nombre} · pie {p.lado}" for p in proyecto.pies],
                                 c.rejilla.dx, proyecto.taller["cnc"])
    pedido = (proyecto.paciente or {}).get("pedido") or pedido_de_ruta(proyecto.ruta_stl)
    return _con_pedido(piezas, pedido)


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
    piezas = cnc.piezas_de_molde(z, fondo, [p.mascara for p in pies], [f"{nombre} · pie {p.lado}" for p in pies],
                                 paso, taller["cnc"])
    return _con_pedido(piezas, pedido_de_ruta(ruta))


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
        finally:
            QThread.currentThread().quit()  # (ver Cargador en principal.py: evita quedarse colgado al cerrar)


def _fases(trabajo: cnc.TrabajoCNC) -> str:
    t = trabajo.tiempos
    return (f"desbaste {t.get('desbaste', 0):.0f} min, acabado {t.get('acabado', 0):.0f} min, "
            f"contorno {t.get('contorno', 0):.0f} min")


class VentanaTirada(QDialog):
    """Lista de moldes de la tirada, plancha, colocación (automática o a mano) y exportación del .nc."""

    def __init__(self, principal):
        super().__init__(principal)
        self.principal = principal
        self.taller = principal.taller
        self.setWindowTitle("Tirada de CNC – varios moldes en una plancha")
        self.resize(1200, 760)
        self.piezas: list[cnc.Pieza] = []
        self.trabajo: cnc.TrabajoCNC | None = None
        self.numeros: dict[int, int] = {}  # id(pieza) → orden en que se fresa
        self.avisos: list[str] = []
        self._hilo = None
        self._reloj = QTimer(self)  # espera a que se deje de teclear la medida de la plancha
        self._reloj.setSingleShot(True)
        self._reloj.setInterval(400)
        self._reloj.timeout.connect(lambda: self._colocar(conservar=True))

        izq = QVBoxLayout()
        izq.setSpacing(10)
        pl = self.taller["plancha"]
        # La placa que hay ahora en la CNC (con lo ya fresado en tiradas anteriores). Es de una máquina y se
        # guarda en la web; aquí queda una copia y lo pendiente de enviar si no hay conexión.
        self.estado = placa_mod.cargar_estado(pl["ancho_x"], pl["largo_y"], pl["alto_z"])
        self.placa = self.estado["placa"]
        self._puente = _Puente()
        self._puente.hecho.connect(lambda f, r: f(r))
        self._puente.fallo.connect(lambda f, e: f(e))
        self._sincronizando = False
        self._lote_iniciado: str | None = None  # tras «Inicio»: estos pies ya están en marcha
        marco, lay_pl, _ = estilo.tarjeta("Plancha de escayola", "1")
        form = QFormLayout()
        form.setHorizontalSpacing(12)
        self.cajas = []
        for texto, valor in (("Ancho (X)", self.placa["ancho"]), ("Largo (Y)", self.placa["largo"]),
                             ("Alto (Z)", self.placa["alto"])):
            c = QDoubleSpinBox()
            c.setRange(20, 2000)
            c.setDecimals(0)
            c.setSuffix(" mm")
            c.setValue(valor)
            c.valueChanged.connect(lambda *_: (self._invalidar(), self._reloj.start()))
            form.addRow(estilo.etiqueta(texto, "secundario", envolver=False), c)
            self.cajas.append(c)
        self.caja_margen = QDoubleSpinBox()
        self.caja_margen.setRange(0, 60)
        self.caja_margen.setDecimals(0)
        self.caja_margen.setSuffix(" mm")
        self.caja_margen.setValue(self.taller["cnc"].get("margen_bloque", 0.0))
        self.caja_margen.setToolTip("Distancia mínima extra entre lo que corta la fresa y el borde de la plancha.\n"
                                    "Con 0, la fresa (con su filo de fuera) llega justo al borde, sin salirse.\n"
                                    "Súbela si sujetas la plancha con topes o mordazas en los bordes.")
        self.caja_margen.valueChanged.connect(self._cambiar_margen)
        form.addRow(estilo.etiqueta("Margen bordes", "secundario", envolver=False), self.caja_margen)
        lay_pl.addLayout(form)
        self.boton_ajustes = QPushButton("Ajustes de la CNC (velocidades y pasadas)…")
        self.boton_ajustes.setToolTip("Revoluciones, velocidades de avance, bajada por capa y separación de líneas")
        self.boton_ajustes.clicked.connect(lambda: principal.ajustes_cnc())
        lay_pl.addWidget(self.boton_ajustes)
        izq.addWidget(marco)

        marco, lay_placa, _ = estilo.tarjeta("Placa en la CNC")
        fila = QHBoxLayout()
        fila.addWidget(estilo.etiqueta("Máquina", "secundario", envolver=False))
        self.combo_maquina = QComboBox()
        self.combo_maquina.setToolTip("La CNC en la que se va a fresar: cada máquina tiene su placa (guardada en la web)")
        self.combo_maquina.activated.connect(lambda i: self.elegir_maquina(self.combo_maquina.itemData(i)))
        fila.addWidget(self.combo_maquina, 1)
        self.boton_nueva_maquina = QPushButton("＋")
        self.boton_nueva_maquina.setFixedWidth(34)
        self.boton_nueva_maquina.setToolTip("Añadir una máquina CNC")
        self.boton_nueva_maquina.clicked.connect(lambda: self.anadir_maquina())
        fila.addWidget(self.boton_nueva_maquina)
        lay_placa.addLayout(fila)
        self.texto_nube = estilo.etiqueta("", "secundario")
        self.texto_nube.setTextFormat(Qt.RichText)
        lay_placa.addWidget(self.texto_nube)
        self.texto_placa = estilo.etiqueta("", "secundario")
        self.texto_placa.setTextFormat(Qt.RichText)
        lay_placa.addWidget(self.texto_placa)
        fila = QHBoxLayout()
        self.boton_placa_nueva = QPushButton("Placa nueva")
        self.boton_placa_nueva.setToolTip("Has puesto una placa sin fresar: todo vuelve a estar libre")
        self.boton_placa_nueva.clicked.connect(lambda: self.placa_nueva())
        fila.addWidget(self.boton_placa_nueva)
        self.boton_deshacer_placa = QPushButton("Deshacer la última tirada")
        self.boton_deshacer_placa.setToolTip("Si pulsaste «Inicio» pero la tirada no se llegó a fresar, libera su zona")
        self.boton_deshacer_placa.clicked.connect(lambda: self.deshacer_ultima_tirada())
        fila.addWidget(self.boton_deshacer_placa)
        lay_placa.addLayout(fila)
        izq.addWidget(marco)

        marco, lay_pies, _ = estilo.tarjeta("Pies de la tirada", "2")
        self.lista = QListWidget()
        self.lista.currentRowChanged.connect(self._al_elegir_en_lista)
        self.lista.setMinimumWidth(330)
        lay_pies.addWidget(self.lista, 1)
        fila = QHBoxLayout()
        for texto, accion, ic, ayuda in (
                ("Molde abierto", self.anadir_abierto, "anadir", "Añadir el molde abierto en la ventana principal"),
                ("Guardados…", self.anadir_archivos, "abrir", "Añadir trabajos guardados (.molde) o moldes exportados (STL)")):
            b = QPushButton(texto)
            b.setIcon(estilo.icono(ic))
            b.setToolTip(ayuda)
            b.clicked.connect(accion)
            fila.addWidget(b, 1)
        lay_pies.addLayout(fila)
        fila = QHBoxLayout()
        for texto, accion, ic, ayuda in (
                ("Girar", lambda: self.girar(), "girar", "Gira el pie elegido (también: doble clic sobre él, o R)"),
                ("Auto", self.todo_automatico, "auto", "Vuelve a colocar todos los pies lo más juntos posible"),
                ("Quitar", lambda: self.quitar(), "quitar", "Quita el pie elegido de la tirada (Supr)")):
            b = QPushButton(texto)
            b.setIcon(estilo.icono(ic))
            b.setToolTip(ayuda)
            b.clicked.connect(accion)
            fila.addWidget(b, 1)
        lay_pies.addLayout(fila)
        b = QPushButton("Vaciar la tirada")
        b.setProperty("plano", True)
        b.clicked.connect(self.vaciar)
        lay_pies.addWidget(b)
        izq.addWidget(marco, 1)

        marco, lay_cnc, _ = estilo.tarjeta("Archivo para la CNC", "3")
        self.boton_calcular = QPushButton("Calcular trayectorias")
        self.boton_calcular.setIcon(estilo.icono("calcular", "white"))
        estilo.primario(self.boton_calcular)
        self.boton_calcular.clicked.connect(lambda: self.calcular())
        lay_cnc.addWidget(self.boton_calcular)
        self.boton_guardar = QPushButton("Guardar archivo .nc…")
        self.boton_guardar.setIcon(estilo.icono("guardar", "white"))
        estilo.primario(self.boton_guardar)
        self.boton_guardar.clicked.connect(lambda: self.guardar())
        self.boton_guardar.setEnabled(False)
        lay_cnc.addWidget(self.boton_guardar)
        self.boton_inicio = QPushButton("▶  Inicio: la CNC empieza")
        self.boton_inicio.setToolTip("Púlsalo al arrancar la CNC: con el tiempo estimado, te avisa en Confección\n"
                                     "cuando acabe (y puedes pasar sus pedidos a confección de un clic).")
        self.boton_inicio.clicked.connect(lambda: self.iniciar())
        self.boton_inicio.setEnabled(False)
        lay_cnc.addWidget(self.boton_inicio)
        b = QPushButton("Ver mapa para imprimir")
        b.setIcon(estilo.icono("mapa"))
        b.clicked.connect(self.ver_mapa)
        lay_cnc.addWidget(b)
        izq.addWidget(marco)

        der = QVBoxLayout()
        der.setSpacing(8)
        ayuda = estilo.etiqueta("<b>Arrastra cada pie</b> para colocarlo (verde = cabe · rojo = no cabe) · "
                                "<b>doble clic</b> = girar · <b>clic derecho</b> = opciones · rueda = zoom · "
                                "doble clic en vacío = ver toda la plancha · flechas = mover 1 mm (Mayús: 10 mm)",
                                "nota")
        der.addWidget(ayuda)
        self.vista = VistaPlancha(self)
        self.vista.setMinimumSize(660, 520)
        der.addWidget(self.vista, 1)
        self.info = estilo.etiqueta()
        self.info.setObjectName("cifras")
        der.addWidget(self.info)

        lay = QHBoxLayout(self)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.setSpacing(12)
        lay.addLayout(izq, 0)
        lay.addLayout(der, 1)
        self._poner_maquinas()
        self._poner_plancha()
        self.sincronizar()

    def showEvent(self, evento):
        super().showEvent(evento)
        estilo.barra_titulo_oscura(self)
        self.sincronizar()  # lo que otro ordenador haya fresado en esta máquina

    def closeEvent(self, evento):
        if self._hilo is not None and self._hilo.isRunning():
            self._hilo.wait()
        super().closeEvent(evento)

    # ------------------------------------------------------------ datos básicos

    def plancha(self) -> tuple[float, float, float]:
        return tuple(c.value() for c in self.cajas)

    def _paso(self) -> float:
        return self.taller["calculo"]["rejilla"]

    def _radio(self) -> float:
        return self.taller["fresa"]["diametro"] / 2

    def _margen(self) -> int:
        return cnc.margen_celdas(self._radio(), self._paso(), self.taller["cnc"])

    def _numero(self, pieza) -> int | None:
        return self.numeros.get(id(pieza))

    def elegida(self) -> cnc.Pieza | None:
        fila = self.lista.currentRow()
        return self.piezas[fila] if 0 <= fila < len(self.piezas) else None

    def _motivo(self, p: cnc.Pieza, x: int, y: int, giro: int) -> str | None:
        return cnc.cabe(p, self.piezas, *self.plancha()[:2], self._paso(), self.taller["cnc"], self._radio(),
                        x, y, giro, self._usadas())

    # ------------------------------------------------------------ placa en la CNC

    def _zonas_mm(self) -> list[tuple[float, float, float, float]]:
        """Lo ya fresado de otras tiradas (para el mapa); sin los pies de esta si ya se pulsó Inicio."""
        if not self._placa_coincide():
            return []
        return [(z["x"], z["y"], z["ancho"], z["largo"]) for z in self.placa["zonas"]
                if self._lote_iniciado is None or z.get("tirada") != self._lote_iniciado]

    def _placa_coincide(self) -> bool:
        return placa_mod.misma_medida(self.placa, *self.plancha())

    def _usadas(self) -> list[tuple[int, int, int, int]]:
        """Zonas ya fresadas de la placa en uso (celdas). Si las medidas no son las de esa placa, ninguna."""
        return placa_mod.zonas_celdas(self.placa, self._paso()) if self._placa_coincide() else []

    def _texto_placa(self):
        if not self._placa_coincide():
            self.texto_placa.setText(
                f"<span style='color:{C['aviso']}'>La placa en uso mide {self.placa['ancho']:.0f} × "
                f"{self.placa['largo']:.0f} × {self.placa['alto']:.0f} mm. Si has puesto otra, pulsa "
                "<b>Placa nueva</b>.</span>")
        elif not self.placa["zonas"]:
            self.texto_placa.setText("Placa sin fresar: toda libre. El origen es siempre la esquina delantera "
                                     "izquierda (X0 Y0).")
        else:
            n = len(placa_mod.tiradas(self.placa))
            desde = self.placa.get("creada", "")[:10]
            desde = f" desde el {desde[8:10]}/{desde[5:7]}" if len(desde) == 10 else ""
            self.texto_placa.setText(
                f"Usada: <b>{100 * placa_mod.fraccion_usada(self.placa):.0f} %</b> · {n} tirada(s){desde}. "
                "Lo nuevo va en lo que queda libre (gris rayado = ya fresado), con el mismo origen X0 Y0.")
        self.boton_deshacer_placa.setEnabled(bool(self.placa["zonas"]))

    def placa_nueva(self, preguntar: bool = True):
        if preguntar and self.placa["zonas"]:
            r = QMessageBox.question(self, "Placa nueva", "¿Has puesto una placa nueva sin fresar?\n\n"
                                     "Toda la placa vuelve a estar libre para las próximas tiradas.")
            if r != QMessageBox.Yes:
                return
        # La placa nueva es del grosor del material elegido (XPS 50 mm, escayola 45 mm…).
        self.cajas[2].blockSignals(True)
        self.cajas[2].setValue(self.taller["plancha"]["alto_z"])
        self.cajas[2].blockSignals(False)
        self.placa = placa_mod.nueva(*self.plancha())
        self._operacion({"op": "placa", "id": self.placa["id"], "ancho": self.placa["ancho"],
                         "largo": self.placa["largo"], "alto": self.placa["alto"]})
        self._lote_iniciado = None
        self._invalidar()
        self._colocar(conservar=False)

    def deshacer_ultima_tirada(self):
        hecho = placa_mod.deshacer_ultima(self.placa)
        if hecho is None:
            return
        nombre, tirada_id = hecho
        self._operacion({"op": "anular", "tiradaId": tirada_id} if tirada_id else None)
        self._lote_iniciado = None
        self._invalidar()
        self._colocar(conservar=True)
        self._texto_info(f"Liberada la zona de la tirada «{nombre}».")

    def _marcar_en_placa(self, lote: str):
        """«Inicio»: la zona de cada pie de esta tirada queda gastada en la placa."""
        if not self._placa_coincide():
            self.placa = placa_mod.nueva(*self.plancha())
            self._operacion({"op": "placa", "id": self.placa["id"], "ancho": self.placa["ancho"],
                             "largo": self.placa["largo"], "alto": self.placa["alto"]}, enviar=False)
        paso, m = self._paso(), self._margen()
        huellas = [tuple(v * paso for v in cnc.huella(p, m)) for p in self.piezas if p.colocada]
        self._operacion(placa_mod.anadir_tirada(self.placa, huellas, lote))
        self._lote_iniciado = lote
        self.vista.poner_zonas(self.placa["zonas"])
        self._texto_placa()

    # ------------------------------------------------------------ la placa en la web (por máquina)

    def _web(self):
        conf = getattr(self.principal, "confeccion", None)
        return getattr(conf, "web", None)

    def _guardar_estado(self):
        self.estado["placa"] = self.placa
        placa_mod.guardar_estado(self.estado)

    def _operacion(self, op: dict | None, enviar: bool = True):
        """Apunta un cambio de la placa: se guarda en este ordenador y, si hay máquina, se manda a la web
        (si no hay conexión queda pendiente y se manda solo cuando vuelve)."""
        if op is not None and self.estado["maquina"]:
            self.estado["pendientes"].append({**op, "maquina": self.estado["maquina"]["id"], "uid": str(uuid.uuid4())})
        self._guardar_estado()
        if enviar:
            self.sincronizar()

    def _en_segundo_plano(self, trabajo, listo, fallo):
        def correr():
            try:
                r = trabajo()
            except Exception as e:  # noqa: BLE001 - se le dice a la persona
                self._puente.fallo.emit(fallo, e)
                return
            self._puente.hecho.emit(listo, r)

        if self.SINCRONO:
            correr()
        else:
            threading.Thread(target=correr, daemon=True).start()

    SINCRONO = False  # en las pruebas, sin hilos

    def sincronizar(self):
        """Manda lo pendiente a la web y trae la placa de la máquina (la de la web manda)."""
        web = self._web()
        self._texto_nube()
        if web is None or not web.token or self._sincronizando:
            return
        self._sincronizando = True
        pendientes = list(self.estado["pendientes"])

        def trabajo():
            hechas, descartadas, sin_conexion = [], [], None
            for op in pendientes:
                try:
                    web.enviar_operacion(op["maquina"], op)
                    hechas.append(op["uid"])
                except ErrorWeb as e:
                    if e.status in (0, 401) or e.status >= 500:
                        sin_conexion = e
                        break
                    descartadas.append((op["uid"], str(e)))  # la web no la acepta: no se reintenta
            maquinas = web.maquinas() if sin_conexion is None else None
            return hechas, descartadas, sin_conexion, maquinas

        self._en_segundo_plano(trabajo, self._sincronizado, self._fallo_sincronizar)

    def _fallo_sincronizar(self, e):
        self._sincronizando = False
        self._texto_nube(str(e))

    def _sincronizado(self, r):
        self._sincronizando = False
        hechas, descartadas, sin_conexion, maquinas = r
        quitar = set(hechas) | {u for u, _ in descartadas}
        self.estado["pendientes"] = [op for op in self.estado["pendientes"] if op.get("uid") not in quitar]
        if maquinas is not None:
            self.estado["maquinas"] = [{"id": m["id"], "nombre": m["nombre"]} for m in maquinas]
            actual = self.estado["maquina"]
            m = next((x for x in maquinas if actual and x["id"] == actual["id"]), None)
            if actual and m is None:
                self.estado["maquina"] = None  # la máquina ya no existe en la web
            elif m is not None and not self.estado["pendientes"]:
                desde = placa_mod.desde_web(m)
                if desde is None:
                    # Máquina sin placa en la web: se sube la de este ordenador (con lo ya fresado).
                    for op in placa_mod.operaciones_para_subir(self.placa):
                        self.estado["pendientes"].append({**op, "maquina": m["id"], "uid": str(uuid.uuid4())})
                    self._guardar_estado()
                    self.sincronizar()
                    return
                antes = [(z["x"], z["y"]) for z in self.placa["zonas"]]
                self.placa = desde
                if not placa_mod.misma_medida(self.placa, *self.plancha()):
                    for c, v in zip(self.cajas, (self.placa["ancho"], self.placa["largo"], self.placa["alto"])):
                        c.blockSignals(True)
                        c.setValue(v)
                        c.blockSignals(False)
                    antes = None
                if antes != [(z["x"], z["y"]) for z in self.placa["zonas"]]:
                    self._invalidar()
                    self._colocar(conservar=True)
        self._guardar_estado()
        self._poner_maquinas()
        aviso = (f"No se ha podido guardar en la web: {descartadas[-1][1]}" if descartadas else
                 str(sin_conexion) if sin_conexion is not None else "")
        self._texto_nube(aviso)

    def _poner_maquinas(self):
        self.combo_maquina.blockSignals(True)
        self.combo_maquina.clear()
        self.combo_maquina.addItem("— solo este ordenador —", None)
        for m in self.estado.get("maquinas") or ([self.estado["maquina"]] if self.estado["maquina"] else []):
            self.combo_maquina.addItem(m["nombre"], m)
        actual = self.estado["maquina"]
        i = next((k for k in range(self.combo_maquina.count())
                  if actual and (self.combo_maquina.itemData(k) or {}).get("id") == actual["id"]), 0)
        self.combo_maquina.setCurrentIndex(i)
        self.combo_maquina.blockSignals(False)

    def _texto_nube(self, aviso: str = ""):
        web = self._web()
        pend = len(self.estado["pendientes"])
        if not self.estado["maquina"]:
            texto = ("Elige la máquina para guardar su placa en la web (y verla igual desde cualquier ordenador)."
                     if web is not None and web.token else
                     "Solo en este ordenador. Para guardarla en la web por máquina, entra en <b>Confección</b> "
                     "con tu usuario del taller.")
        elif web is None or not web.token:
            texto = (f"Máquina <b>{self.estado['maquina']['nombre']}</b>. Sin sesión: los cambios se guardan aquí "
                     "y se mandarán a la web cuando entres en Confección.")
        elif pend:
            texto = f"⏳ {pend} cambio(s) sin enviar a la web: se mandarán solos al volver la conexión."
        else:
            texto = f"☁ Máquina <b>{self.estado['maquina']['nombre']}</b>: guardada en la web."
        if aviso:
            texto += f"<br><span style='color:{C['aviso']}'>{aviso}</span>"
        self.texto_nube.setText(texto)

    def elegir_maquina(self, maquina: dict | None):
        """Cambiar de máquina: se usa su placa (la de la web)."""
        actual = self.estado["maquina"]
        if (maquina or {}).get("id") == (actual or {}).get("id"):
            return
        self.estado["maquina"] = {"id": maquina["id"], "nombre": maquina["nombre"]} if maquina else None
        if maquina:  # mientras llega la de la web, sin zonas de la otra máquina
            self.placa = placa_mod.nueva(*self.plancha())
        self._lote_iniciado = None
        self._guardar_estado()
        self._invalidar()
        self._colocar(conservar=True)
        self.sincronizar()

    def anadir_maquina(self, nombre: str | None = None):
        web = self._web()
        if web is None or not web.token:
            QMessageBox.information(self, "Añadir máquina", "Para añadir una máquina, entra primero en "
                                    "<b>Confección</b> con tu usuario del taller.")
            return
        if nombre is None:
            nombre, ok = QInputDialog.getText(self, "Añadir máquina", "Nombre de la máquina CNC (p. ej. «CNC taller»):")
            if not ok or not nombre.strip():
                return

        def listo(m):
            # La placa de este ordenador (con lo ya fresado) pasa a ser la de la máquina nueva: al
            # sincronizar se sube a la web.
            self.estado.setdefault("maquinas", []).append({"id": m["id"], "nombre": m["nombre"]})
            self.estado["maquina"] = {"id": m["id"], "nombre": m["nombre"]}
            self._guardar_estado()
            self._poner_maquinas()
            self.sincronizar()

        self._en_segundo_plano(lambda: web.crear_maquina(nombre.strip()), listo,
                               lambda e: QMessageBox.warning(self, "Añadir máquina", str(e)))

    # ------------------------------------------------------------ colocación

    def _poner_plancha(self):
        ancho, largo, _ = self.plancha()
        self.vista.poner_plancha(ancho, largo, self._paso(), self._margen())
        self.vista.poner_zonas(self.placa["zonas"] if self._placa_coincide() else [])
        self._texto_placa()
        self._texto_nube()

    def _colocar(self, conservar: bool = True):
        """Coloca los pies que no tienen sitio. Con `conservar`, los que ya están colocados no se mueven
        (los nuevos van a los huecos); si así no caben, se recolocan los que no están puestos a mano.
        Nunca encima de lo ya fresado de la placa en uso."""
        cnc.a_paso(self.piezas, self._paso())
        self._poner_plancha()
        if self._lote_iniciado is not None:
            self._refrescar()  # esta tirada ya está en marcha: sus pies no se mueven
            return
        ancho, largo, _ = self.plancha()
        usadas = self._usadas()
        args = (ancho, largo, self._paso(), self.taller["cnc"], self._radio())
        fijas = {id(p): p.fija for p in self.piezas}
        avisos: list[str] = []
        if conservar:
            for p in self.piezas:
                p.fija = p.fija or p.colocada
        sobran = cnc.colocar(self.piezas, *args, avisos, usadas)
        for p in self.piezas:
            p.fija = fijas[id(p)] and p.colocada
        if conservar and sobran:
            avisos = []
            sobran = cnc.colocar(self.piezas, *args, avisos, usadas)
        if sobran:
            donde = ("en lo que queda libre de la placa. Pon una placa nueva o hazlos en otra tirada"
                     if usadas else ". Usa una plancha más grande o hazlos en otra tirada")
            avisos.append(f"No caben {len(sobran)} pie(s): " + ", ".join(p.nombre for p in sobran)
                          + (" " if usadas else "") + donde + ".")
        self.avisos = avisos
        self._refrescar()

    def _refrescar(self):
        """Numeración, lista y mapa (sin recalcular nada pesado)."""
        self.trabajo = None
        self.boton_guardar.setEnabled(False)
        self.boton_inicio.setEnabled(False)
        puestas = [p for p in self.piezas if p.colocada]
        self.numeros = {id(p): n for n, p in enumerate(cnc.orden_fresado(puestas, self._paso()), 1)}
        self._refrescar_lista()
        self.vista.poner_piezas(self.piezas, self.numeros)
        self.vista.elegir(self.elegida())
        self._texto_info()

    def _texto_info(self, extra: str = ""):
        if not self.piezas:
            self.info.setText("Añade moldes: aquí verás dónde queda cada uno en la plancha.")
            return
        n = sum(p.colocada for p in self.piezas)
        texto = (f"<b>{n} pie(s) en la plancha.</b> El número de cada pie es el orden en que se fresa. "
                 "Cuando esté bien, pulsa <b>Calcular trayectorias</b>.")
        if extra:
            texto = extra + "<br>" + texto
        if self.avisos:
            texto += f"<br><span style='color:{C['mal']}'>⚠ " + "<br>⚠ ".join(self.avisos) + "</span>"
        self.info.setText(texto)

    def _refrescar_lista(self):
        fila = self.lista.currentRow()
        self.lista.blockSignals(True)
        self.lista.clear()
        paso = self._paso()
        for p in self.piezas:
            ny, nx = p.h.shape
            n = self._numero(p)
            delante = f"{n}.  " if n else "NO CABE · "
            detras = "  · puesto a mano" if p.fija and p.colocada else ""
            self.lista.addItem(f"{delante}{p.nombre}  ({nx * paso:.0f} × {ny * paso:.0f} mm){detras}")
        self.lista.setCurrentRow(min(fila, self.lista.count() - 1))
        self.lista.blockSignals(False)

    def _invalidar(self, *_):
        """Lo calculado ya no vale."""
        self.trabajo = None
        self.boton_guardar.setEnabled(False)
        self.boton_inicio.setEnabled(False)
        self.vista.borrar_contornos()

    # ------------------------------------------------------------ elegir

    def _al_elegir_en_lista(self, fila: int):
        self.vista.elegir(self.elegida())

    def al_elegir_en_mapa(self, p: cnc.Pieza | None):
        if p is None:
            return
        k = self.piezas.index(p)
        if self.lista.currentRow() != k:
            self.lista.blockSignals(True)
            self.lista.setCurrentRow(k)
            self.lista.blockSignals(False)

    # ------------------------------------------------------------ mover a mano

    def al_mover(self, p: cnc.Pieza, x: int, y: int, motivo: str | None):
        """Mientras se arrastra: solo el texto de abajo (el color lo pone la vista)."""
        paso = self._paso()
        ny, nx = p.forma()
        donde = f"X {x * paso:.0f}–{(x + nx) * paso:.0f} mm, Y {y * paso:.0f}–{(y + ny) * paso:.0f} mm"
        if motivo is None:
            self.info.setText(f"Moviendo <b>{p.nombre}</b>: {donde} — <span style='color:{C['bien']}'>cabe aquí</span>")
        else:
            self.info.setText(f"Moviendo <b>{p.nombre}</b>: {donde} — "
                              f"<span style='color:{C['mal']}'>no cabe: {motivo}</span>")

    def al_soltar(self, p: cnc.Pieza, x: int, y: int):
        self.colocar_a_mano(p, x, y, p.giro)

    def colocar_a_mano(self, p: cnc.Pieza, x: int, y: int, giro: int) -> bool:
        """Pone un pie en una posición (celdas) y giro. Si no cabe, vuelve a su sitio y se dice por qué.
        Los demás pies no se mueven."""
        motivo = self._motivo(p, x, y, giro)
        if motivo:
            item = self.vista.item_de(p)
            if item is not None:
                item.sincronizar()
            self._texto_info(f"<span style='color:{C['mal']}'>⚠ No se puede poner ahí: {p.nombre} {motivo}. "
                             "Ha vuelto a su sitio.</span>")
            return False
        p.x, p.y, p.giro, p.fija = x, y, giro, True
        self._invalidar()
        self._refrescar()
        return True

    def mover_a(self, p: cnc.Pieza, x_mm: float, y_mm: float) -> bool:
        """Pone la esquina delantera izquierda del pie en (x_mm, y_mm)."""
        return self.colocar_a_mano(p, int(round(x_mm / self._paso())), int(round(y_mm / self._paso())), p.giro)

    def mover(self, dx_mm: float, dy_mm: float):
        p = self.elegida()
        if p is None or not p.colocada:
            self._texto_info("Elige primero un pie (clic sobre él o en la lista).")
            return
        self.mover_a(p, p.x * self._paso() + dx_mm, p.y * self._paso() + dy_mm)

    def girar(self, p: cnc.Pieza | None = None, cuartos: int = 1):
        p = p or self.elegida()
        if p is None or not p.colocada:
            self._texto_info("Elige primero un pie (clic sobre él o en la lista).")
            return
        ny, nx = p.forma()
        cx, cy = p.x + nx / 2, p.y + ny / 2
        g = (p.giro + cuartos) % 4
        ny2, nx2 = p.forma(g)
        x, y = int(round(cx - nx2 / 2)), int(round(cy - ny2 / 2))
        if self._motivo(p, x, y, g):
            # Girado sobre su centro no cabe (p. ej. junto al borde): el sitio libre más cercano.
            cerca = self._sitio_cercano(p, x, y, g)
            if cerca is not None:
                x, y = cerca
        self.colocar_a_mano(p, x, y, g)

    def _sitio_cercano(self, p: cnc.Pieza, x: int, y: int, giro: int) -> tuple[int, int] | None:
        paso = self._paso()
        salto = max(1, int(round(5 / paso)))
        W, L = (int(round(v / paso)) for v in self.plancha()[:2])
        candidatos = sorted(((i - x) ** 2 + (j - y) ** 2, i, j)
                            for i in range(0, W, salto) for j in range(0, L, salto))
        for _, i, j in candidatos:
            if self._motivo(p, i, j, giro) is None:
                return i, j
        return None

    def soltar(self, p: cnc.Pieza | None = None):
        """El pie vuelve a colocación automática."""
        p = p or self.elegida()
        if p is not None:
            p.fija = False
            p.x = p.y = None
            self._invalidar()
            self._colocar(conservar=True)

    def todo_automatico(self):
        for p in self.piezas:
            p.fija = False
        self._invalidar()
        self._colocar(conservar=False)

    def anadir_piezas(self, nuevas: list[cnc.Pieza]):
        if self._lote_iniciado is not None:
            # La tirada anterior ya está en la CNC (su zona quedó marcada): se empieza una nueva.
            self.piezas = []
            self._lote_iniciado = None
        for p in nuevas:
            p.x = p.y = None
            p.fija = False
        self.piezas += nuevas
        self._invalidar()
        self._colocar(conservar=True)  # los que ya estaban no se mueven

    def anadir_abierto(self):
        pr = self.principal.proyecto
        if pr is None:
            QMessageBox.information(self, "Tirada", "No hay ningún molde abierto en la ventana principal.")
            return
        from interfaz.principal import nombre_para_archivos
        self.anadir_piezas(piezas_de_proyecto(pr, nombre_para_archivos(pr)))

    def anadir_archivos(self):
        rutas, _ = QFileDialog.getOpenFileNames(self, "Trabajos guardados o moldes exportados", "",
                                                "Trabajos y moldes (*.molde *.stl *.ply *.obj *.zip);;"
                                                "Trabajos guardados (*.molde);;Todos los archivos (*.*)")
        errores = []
        for r in rutas:
            try:
                if r.lower().endswith(".molde"):
                    from interfaz.principal import nombre_para_archivos
                    from ortomolde import trabajo
                    pr = trabajo.abrir(r)
                    self.anadir_piezas(piezas_de_proyecto(pr, nombre_para_archivos(pr)))
                else:
                    self.anadir_piezas(piezas_de_archivo(r, self.taller))
            except Exception as e:  # noqa: BLE001
                errores.append(f"{Path(r).name}: {e}")
        if errores:
            QMessageBox.warning(self, "Algunos archivos no se han podido añadir", "\n".join(errores))

    def quitar(self, p: cnc.Pieza | None = None):
        p = p or self.elegida()
        if p is not None:
            self.piezas.remove(p)
            self._invalidar()
            self._refrescar()

    def vaciar(self):
        self.piezas = []
        self._invalidar()
        self._refrescar()

    # ------------------------------------------------------------ cálculo

    def calcular(self, esperar: bool = False):
        if not self.piezas:
            QMessageBox.information(self, "Tirada", "Añade al menos un molde.")
            return
        if self._reloj.isActive():
            self._reloj.stop()
            self._colocar(conservar=True)
        if not any(p.colocada for p in self.piezas):
            QMessageBox.information(self, "Tirada", "Ningún pie cabe en esta plancha.")
            return
        self.boton_calcular.setEnabled(False)
        self.info.setText("Calculando las trayectorias (con la colocación que ves en la plancha)…")
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
        self._hilo.start()

    def _listo(self, trabajo: cnc.TrabajoCNC):
        self.boton_calcular.setEnabled(True)
        trabajo.usadas = self._zonas_mm()
        self.trabajo = trabajo
        self.boton_guardar.setEnabled(True)
        self.boton_inicio.setEnabled(True)
        self.vista.dibujar_contornos(trabajo.contornos)
        a, l, h = trabajo.plancha
        texto = (f"<b>{len(trabajo.piezas)} pie(s) colocados</b> en la plancha de {a:.0f} × {l:.0f} × {h:.0f} mm "
                 f"(ocupan el {100 * trabajo.aprovechamiento:.0f} %). "
                 f"Tiempo estimado: <b>{trabajo.tiempo_min:.0f} min</b> ({_fases(trabajo)}).<br>"
                 f"Fresa de bola Ø{self.taller['fresa']['diametro']:g} mm: contorno de cada pie, desbaste en capas "
                 f"de {self.taller['cnc']['bajada_por_pasada']:g} mm y acabado cada "
                 f"{self.taller['cnc']['paso_acabado']:g} mm.")
        if trabajo.avisos:
            texto += f"<br><span style='color:{C['mal']}'>⚠ " + "<br>⚠ ".join(trabajo.avisos) + "</span>"
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
        self.nombre_tirada = ruta.stem.upper()
        ruta.write_text(self.trabajo.gcode, encoding="ascii", errors="replace")
        vacio = ruta.with_name(ruta.stem + "_PRUEBA_EN_VACIO.nc")
        vacio.write_text(cnc.en_vacio(self.trabajo.gcode, 5.0), encoding="ascii", errors="replace")
        hoja = ruta.with_suffix(".txt")
        a, l, h = self.trabajo.plancha
        lineas = [
            "TIRADA DE CNC - Ortosend Taller", "",
            f"Plancha de {self.taller['cnc'].get('material', '')}: {a:.0f} x {l:.0f} x {h:.0f} mm",
            "Origen: X0 Y0 = esquina delantera izquierda de la plancha; Z0 = cara de arriba.",
            f"Prueba sin cortar: {ruta.stem}_PRUEBA_EN_VACIO.nc (todo por encima de la plancha, cabezal apagado).",
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
            QMessageBox.information(self, "Guardado", f"Archivos guardados:\n{ruta}\n{vacio}\n{hoja}\n{png}\n{pdf}"
                                    "\n\nCopia los .nc al USB/tarjeta de la CNC.\n"
                                    f"Primera vez con una plancha nueva: lanza antes {vacio.name}: hace todo el "
                                    "recorrido por encima de la plancha (nunca baja de 5 mm sobre ella) y sin cortar, "
                                    "para comprobar el origen.\n"
                                    "Imprime el mapa (PDF) para saber qué molde es cada uno en la plancha.")

    def iniciar(self, lote: str | None = None):
        """La CNC empieza esta tirada: el programa avisa en Confección cuando acabe (según el tiempo estimado)."""
        if self.trabajo is None:
            return
        from datetime import datetime
        from PySide6.QtWidgets import QInputDialog

        puestas = [f.pieza for f in self.trabajo.fichas]
        pedidos = sorted({p.pedido for p in puestas if p.pedido})
        sin = [p.nombre for p in puestas if not p.pedido]
        if lote is None:
            sugerido = getattr(self, "nombre_tirada", "") or f"TIRADA {datetime.now():%d-%m %H:%M}"
            texto = (f"Tiempo estimado: {self.trabajo.tiempo_min:.0f} min. Te aviso en Confección cuando acabe.\n"
                     + (f"Pedidos: {', '.join(f'#{n}' for n in pedidos)}\n" if pedidos else "")
                     + (f"Sin nº de pedido: {len(sin)} pie(s) (ponlo en «Pedido nº» del molde).\n" if sin else "")
                     + "\nNombre de la tirada (lote):")
            lote, ok = QInputDialog.getText(self, "Inicio de la CNC", texto, text=sugerido)
            if not ok:
                return
        self.principal.cnc_iniciar(self.trabajo.tiempo_min, lote.strip(), pedidos, [p.nombre for p in puestas])
        self._marcar_en_placa(lote.strip())

    def _cambiar_margen(self, valor: float):
        self.taller["cnc"]["margen_bloque"] = float(valor)
        self._invalidar()
        self._reloj.start()

    def ver_mapa(self):
        """Abre el mapa para imprimir (el mismo que se guarda con el .nc) de la colocación actual."""
        hecho = self.trabajo
        if hecho is None:
            if not any(p.colocada for p in self.piezas):
                return
            hecho = cnc.previsualizar(self.piezas, *self.plancha(), self._paso(), self._radio(),
                                      self.taller["cnc"], colocar_antes=False)
            hecho.usadas = self._zonas_mm()
        carpeta = Path(tempfile.mkdtemp(prefix="tirada_"))
        _, pdf = mapa.guardar(hecho, carpeta / "TIRADA", "Tirada de CNC", self.taller["fresa"]["diametro"])
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(pdf)))
        return pdf
