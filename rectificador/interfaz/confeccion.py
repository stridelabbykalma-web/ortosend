"""Apartado «Confección» de Ortosend Taller: los pedidos del taller (de la web de Ortosend) como post-its en
un tablero por columnas (Por diseñar · Por fresar · En confección · Calidad), cada columna en el orden en que
deben salir; la hoja de confección del pedido elegido (proceso, capas de material, tiempos) y los cambios de
estado «molde fresado» y «confección terminada».

Aquí también sale el aviso de que la CNC ha terminado una tirada (lo pone en marcha el apartado Fresado con
«Inicio»), con un botón para pasar a confección los pedidos de esa tirada.

Los costes no se ven en el taller: los calcula la web y solo los ve el administrador.
"""

from __future__ import annotations

import html
import json
import threading
import traceback
from datetime import datetime

from PySide6.QtCore import QObject, Qt, QTimer, Signal
from PySide6.QtGui import QKeySequence, QShortcut, QTextDocument
from PySide6.QtWidgets import (
    QAbstractItemView, QButtonGroup, QCheckBox, QComboBox, QDialog, QDialogButtonBox, QDoubleSpinBox, QFormLayout,
    QFrame, QGraphicsDropShadowEffect, QHBoxLayout, QHeaderView, QInputDialog, QLabel, QLineEdit, QMessageBox,
    QPlainTextEdit, QPushButton, QScrollArea, QSizePolicy, QSpinBox, QSplitter, QTableWidget, QTableWidgetItem,
    QVBoxLayout, QWidget,
)

from interfaz import estilo
from interfaz.estilo import C
from interfaz.web import ClienteWeb, ErrorWeb

# Columnas del tablero: (clave, título, ¿está aquí este pedido?)
COLUMNAS = (
    ("diseno", "Por diseñar", lambda p: p.get("estado") in ("ENTRADA_TALLER", "DISENO")),
    ("fresar", "Por fresar", lambda p: p.get("estado") == "FABRICACION" and p.get("fase") == "MECANIZADO"),
    ("confeccion", "En confección", lambda p: p.get("estado") == "FABRICACION" and p.get("fase") == "CONFECCION"),
    ("calidad", "Calidad", lambda p: p.get("estado") == "CALIDAD"),
)
# Color del post-it según el plazo: (papel, borde).
PAPEL = {"fuera": ("#ffc9c9", "#e03131"), "ajustado": ("#ffec99", "#f59f00"), "ok": ("#d3f9d8", "#2f9e44"),
         None: ("#e9ecef", "#adb5bd")}
PIES = (("par", "Par"), ("I", "Izquierdo"), ("D", "Derecho"))
TIPOS = (("BASE", "Base"), ("REFUERZO", "Refuerzo"), ("FORRO", "Forro"), ("ADHESIVO", "Adhesivo"), ("OTRO", "Otro"))
ENTREGA = {"CLINICA": "Recogida en clínica", "DOMICILIO": "Envío a domicilio"}


def columna_de(p: dict) -> str | None:
    return next((clave for clave, _, esta in COLUMNAS if esta(p)), None)


class _Puente(QObject):
    hecho = Signal(object, object)  # (función a llamar, resultado)
    fallo = Signal(object, str)  # (función a llamar, mensaje)


class PostIt(QFrame):
    """Un pedido en el tablero."""

    def __init__(self, pedido: dict, al_elegir):
        super().__init__()
        self.pedido = pedido
        self._al_elegir = al_elegir
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedWidth(208)
        self.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        plazo = pedido.get("plazo") or {}
        self.papel, self.borde = PAPEL["fuera"] if pedido.get("rehacer") else PAPEL.get(plazo.get("nivel"), PAPEL[None])
        lay = QVBoxLayout(self)
        lay.setContentsMargins(10, 8, 10, 8)
        lay.setSpacing(2)
        arriba = f"#{pedido.get('numero', '')}"
        if pedido.get("rehacer"):
            arriba += "  ⚠ REHACER"
        partes = [f"<div style='font-size:15pt; font-weight:700'>{html.escape(arriba)}</div>",
                  f"<div style='font-size:10.5pt; font-weight:600'>{html.escape(pedido.get('paciente', ''))}</div>",
                  f"<div>{html.escape(plazo.get('texto') or 'sin pago')}"
                  + (f" · lote {html.escape(pedido['lote'])}" if pedido.get("lote") else "") + "</div>",
                  f"<div style='color:#495057'>{html.escape(pedido.get('clinica', ''))}</div>"]
        texto = QLabel("".join(partes))
        texto.setTextFormat(Qt.RichText)
        texto.setWordWrap(True)
        texto.setStyleSheet("color: #212529; background: transparent; border: none;")
        lay.addWidget(texto)
        sombra = QGraphicsDropShadowEffect(self)
        sombra.setBlurRadius(10)
        sombra.setOffset(2, 3)
        sombra.setColor(Qt.black)
        self.setGraphicsEffect(sombra)
        self.marcar(False)

    def marcar(self, elegido: bool):
        grosor, color = (3, "#1c7ed6") if elegido else (1, self.borde)
        self.setStyleSheet(f"PostIt {{ background: {self.papel}; border: {grosor}px solid {color}; "
                           f"border-left: 6px solid {self.borde}; border-radius: 3px; }}")

    def mousePressEvent(self, evento):
        if evento.button() == Qt.LeftButton:
            self._al_elegir(self.pedido["id"])
        super().mousePressEvent(evento)


class PanelConfeccion(QWidget):
    SINCRONO = False  # en las pruebas, las peticiones se hacen en el momento (sin hilos)

    def __init__(self, principal):
        super().__init__(principal)
        self.principal = principal
        self.ajustes_qt = principal.ajustes
        url = principal.taller.get("web", {}).get("url", "https://ortosend-five.vercel.app")
        self.web = ClienteWeb(url, self.ajustes_qt.value("web_token", "") or None)
        self.pedidos: list[dict] = []
        self.pedido: dict | None = None  # detalle del elegido
        self.materiales: list[dict] = []
        self.postits: dict[str, PostIt] = {}
        self._cargando_hoja = False
        self._puente = _Puente()
        self._puente.hecho.connect(lambda f, r: f(r))
        self._puente.fallo.connect(lambda f, m: f(m))

        # ---------------------------------------------------------------- aviso de la CNC
        self.aviso_cnc = QFrame()
        self.aviso_cnc.setObjectName("aviso_cnc")
        self.aviso_cnc.setStyleSheet("QFrame#aviso_cnc { background: #1c7ed6; border-radius: 8px; }"
                                     "QFrame#aviso_cnc QLabel { color: white; }")
        la = QHBoxLayout(self.aviso_cnc)
        la.setContentsMargins(14, 10, 14, 10)
        self.texto_aviso_cnc = QLabel()
        self.texto_aviso_cnc.setTextFormat(Qt.RichText)
        self.texto_aviso_cnc.setWordWrap(True)
        la.addWidget(self.texto_aviso_cnc, 1)
        self.boton_pasar = QPushButton("Pasar sus pedidos a confección")
        self.boton_pasar.clicked.connect(lambda: self.pasar_tirada_a_confeccion())
        la.addWidget(self.boton_pasar)
        b = QPushButton("Hecho")
        b.setToolTip("Quitar el aviso")
        b.clicked.connect(lambda: self.principal.cnc_parar())
        la.addWidget(b)
        self.aviso_cnc.hide()

        # ---------------------------------------------------------------- tablero
        cab = QHBoxLayout()
        self.texto_sesion = estilo.etiqueta("", "secundario")
        cab.addWidget(self.texto_sesion, 1)
        self.texto_lista = estilo.etiqueta("", "nota")
        self.boton_actualizar = QPushButton("Actualizar")
        self.boton_actualizar.setIcon(estilo.icono("reciente"))
        self.boton_actualizar.clicked.connect(lambda: self.actualizar())
        cab.addWidget(self.boton_actualizar)
        b = QPushButton("Materiales…")
        b.clicked.connect(self.editar_materiales)
        cab.addWidget(b)
        self.boton_sesion = QPushButton("Entrar")
        self.boton_sesion.clicked.connect(self._entrar_o_salir)
        cab.addWidget(self.boton_sesion)

        tablero = QWidget()
        self.lay_tablero = QHBoxLayout(tablero)
        self.lay_tablero.setContentsMargins(2, 2, 2, 2)
        self.lay_tablero.setSpacing(12)
        self.columnas: dict[str, tuple[QLabel, QVBoxLayout]] = {}
        for clave, titulo, _ in COLUMNAS:
            col = QFrame()
            col.setObjectName("tarjeta")
            lc = QVBoxLayout(col)
            lc.setContentsMargins(10, 10, 10, 10)
            lc.setSpacing(10)
            t = QLabel(titulo.upper())
            t.setObjectName("titulo_tarjeta")
            lc.addWidget(t)
            lista = QVBoxLayout()
            lista.setSpacing(10)
            lc.addLayout(lista)
            lc.addStretch(1)
            col.setMinimumWidth(232)
            self.lay_tablero.addWidget(col)
            self.columnas[clave] = (t, lista)
        self.lay_tablero.addStretch(1)
        desplazable = QScrollArea()
        desplazable.setWidget(tablero)
        desplazable.setWidgetResizable(True)
        desplazable.setFrameShape(QScrollArea.NoFrame)

        izquierda = QWidget()
        li = QVBoxLayout(izquierda)
        li.setContentsMargins(0, 0, 0, 0)
        li.addLayout(cab)
        li.addWidget(self.texto_lista)
        li.addWidget(desplazable, 1)

        # ---------------------------------------------------------------- hoja
        marco, lay, _ = estilo.tarjeta("Hoja de confección")
        nav = QHBoxLayout()
        self.cabecera = QLabel()
        self.cabecera.setTextFormat(Qt.RichText)
        self.cabecera.setWordWrap(True)
        nav.addWidget(self.cabecera, 1)
        self.boton_anterior = QPushButton("◀")
        self.boton_anterior.setToolTip("Pedido anterior (Re Pág)")
        self.boton_anterior.setFixedWidth(40)
        self.boton_anterior.clicked.connect(lambda: self.mover(-1))
        nav.addWidget(self.boton_anterior, 0, Qt.AlignTop)
        self.boton_siguiente = QPushButton("▶")
        self.boton_siguiente.setToolTip("Pedido siguiente (Av Pág)")
        self.boton_siguiente.setFixedWidth(40)
        self.boton_siguiente.clicked.connect(lambda: self.mover(1))
        nav.addWidget(self.boton_siguiente, 0, Qt.AlignTop)
        lay.addLayout(nav)
        self.texto_pauta = QLabel()
        self.texto_pauta.setTextFormat(Qt.RichText)
        self.texto_pauta.setWordWrap(True)
        self.texto_pauta.setTextInteractionFlags(Qt.TextSelectableByMouse)
        lay.addWidget(self.texto_pauta)

        self.zona_hoja = QWidget()
        lh = QVBoxLayout(self.zona_hoja)
        lh.setContentsMargins(0, 0, 0, 0)
        fila = QHBoxLayout()
        fila.setSpacing(0)
        fila.addWidget(estilo.etiqueta("Proceso  ", "secundario", envolver=False))
        self.grupo_proceso = QButtonGroup(self)
        self.botones_proceso = {}
        for (clave, texto), lado in zip((("TERMOFORMADO", "Termoformado al vacío"), ("CAPAS", "Capas pegadas y prensadas")),
                                        ("izq", "der")):
            b = QPushButton(texto)
            b.setCheckable(True)
            b.setProperty("segmento", lado)
            b.setProperty("pequeno", True)
            self.grupo_proceso.addButton(b)
            fila.addWidget(b, 1)
            self.botones_proceso[clave] = b
        lh.addLayout(fila)
        lh.addWidget(estilo.etiqueta("Capas de material (de abajo arriba)", "secundario"))
        self.tabla = QTableWidget(0, 3)
        self.tabla.setHorizontalHeaderLabels(["Material", "Pies", "Notas"])
        self.tabla.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.tabla.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.tabla.verticalHeader().setVisible(False)
        self.tabla.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.tabla.setMinimumHeight(140)
        lh.addWidget(self.tabla)
        fila = QHBoxLayout()
        b = QPushButton("＋ Añadir capa")
        b.clicked.connect(lambda: self.anadir_capa())
        fila.addWidget(b)
        b = QPushButton("Quitar capa")
        b.clicked.connect(self.quitar_capa)
        fila.addWidget(b)
        fila.addStretch(1)
        lh.addLayout(fila)
        form = QFormLayout()
        self.caja_cnc = QSpinBox()
        self.caja_cnc.setRange(0, 1440)
        self.caja_cnc.setSuffix(" min")
        form.addRow(estilo.etiqueta("Tiempo de fresado (CNC)", "secundario", envolver=False), self.caja_cnc)
        self.caja_confeccion = QSpinBox()
        self.caja_confeccion.setRange(0, 1440)
        self.caja_confeccion.setSuffix(" min")
        form.addRow(estilo.etiqueta("Tiempo de confección", "secundario", envolver=False), self.caja_confeccion)
        lh.addLayout(form)
        self.caja_notas = QPlainTextEdit()
        self.caja_notas.setPlaceholderText("Notas de confección (colores, acabados, observaciones…)")
        self.caja_notas.setFixedHeight(64)
        lh.addWidget(self.caja_notas)
        fila = QHBoxLayout()
        self.boton_guardar = QPushButton("Guardar hoja")
        self.boton_guardar.setIcon(estilo.icono("guardar", "white"))
        estilo.primario(self.boton_guardar)
        self.boton_guardar.clicked.connect(lambda: self.guardar_hoja())
        fila.addWidget(self.boton_guardar)
        b = QPushButton("Imprimir hoja…")
        b.clicked.connect(self.imprimir)
        fila.addWidget(b)
        fila.addStretch(1)
        lh.addLayout(fila)
        fila = QHBoxLayout()
        self.boton_fresado = QPushButton("Molde fresado → a confección")
        self.boton_fresado.clicked.connect(lambda: self.marcar_fresado())
        fila.addWidget(self.boton_fresado)
        self.boton_terminado = QPushButton("Confección terminada → a calidad")
        self.boton_terminado.clicked.connect(lambda: self.marcar_terminado())
        fila.addWidget(self.boton_terminado)
        fila.addStretch(1)
        lh.addLayout(fila)
        lay.addWidget(self.zona_hoja)
        lay.addStretch(1)
        derecha = QScrollArea()
        derecha.setWidgetResizable(True)
        derecha.setFrameShape(QScrollArea.NoFrame)
        derecha.setWidget(marco)
        derecha.setMinimumWidth(420)

        division = QSplitter(Qt.Horizontal)
        division.addWidget(izquierda)
        division.addWidget(derecha)
        division.setStretchFactor(0, 1)
        division.setSizes([980, 520])
        raiz = QVBoxLayout(self)
        raiz.setContentsMargins(10, 10, 6, 6)
        raiz.addWidget(self.aviso_cnc)
        raiz.addWidget(division, 1)

        for tecla, paso in ((Qt.Key_PageDown, 1), (Qt.Key_PageUp, -1)):
            atajo = QShortcut(QKeySequence(tecla), self)
            atajo.setContext(Qt.WidgetWithChildrenShortcut)
            atajo.activated.connect(lambda p=paso: self.mover(p))

        self._reloj = QTimer(self)
        self._reloj.setInterval(120_000)
        self._reloj.timeout.connect(lambda: self.actualizar(silencio=True))
        self._mostrar_sesion()
        self._mostrar_pedido()
        self._cargar_cache()

    # ---------------------------------------------------------------- utilidades

    def _en_segundo_plano(self, trabajo, al_terminar, al_fallar=None):
        """Las peticiones a la web van en otro hilo para que la ventana no se quede parada."""
        al_fallar = al_fallar or self._avisar_error

        def correr():
            try:
                r = trabajo()
            except ErrorWeb as e:
                if e.status == 401:
                    self._puente.fallo.emit(lambda m: (self._sesion_caducada(), al_fallar(m)), str(e))
                else:
                    self._puente.fallo.emit(al_fallar, str(e))
                return
            except Exception as e:  # noqa: BLE001 - se le dice a la persona
                traceback.print_exc()
                self._puente.fallo.emit(al_fallar, f"Error inesperado: {e}")
                return
            self._puente.hecho.emit(al_terminar, r)

        if self.SINCRONO:
            correr()
        else:
            threading.Thread(target=correr, daemon=True).start()

    def _avisar_error(self, mensaje: str):
        self.texto_lista.setText(f"<span style='color:{C['mal']}'>{html.escape(mensaje)}</span>")
        QMessageBox.warning(self, "Confección", mensaje)

    def al_entrar(self):
        """Se llama al pasar a este apartado."""
        if self.web.token:
            self.actualizar(silencio=True)
            self._reloj.start()

    def al_salir(self):
        self._reloj.stop()

    # ---------------------------------------------------------------- sesión

    def _mostrar_sesion(self):
        nombre = self.ajustes_qt.value("web_usuario", "")
        if self.web.token:
            self.texto_sesion.setText(f"Conectado a la web como <b>{html.escape(nombre or 'taller')}</b>")
            self.boton_sesion.setText("Desconectar")
        else:
            self.texto_sesion.setText("Entra con tu usuario de <b>taller</b> de la web de Ortosend.")
            self.boton_sesion.setText("Entrar")
        self.boton_actualizar.setEnabled(bool(self.web.token))

    def _entrar_o_salir(self):
        if self.web.token:
            if QMessageBox.question(self, "Desconectar", "¿Desconectar este ordenador de la web?") == QMessageBox.Yes:
                self.desconectar()
        else:
            self.entrar()

    def entrar(self, email: str | None = None, contrasena: str | None = None) -> bool:
        if email is None:
            d = QDialog(self)
            d.setWindowTitle("Entrar en la web de Ortosend")
            form = QFormLayout(d)
            form.addRow(estilo.etiqueta("Usuario de <b>taller</b> de la web (el mismo de /equipo).", "secundario"))
            caja_email = QLineEdit(self.ajustes_qt.value("web_email", ""))
            caja_email.setPlaceholderText("email o móvil")
            caja_clave = QLineEdit()
            caja_clave.setEchoMode(QLineEdit.Password)
            form.addRow("Email o móvil", caja_email)
            form.addRow("Contraseña", caja_clave)
            botones = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
            botones.button(QDialogButtonBox.Ok).setText("Entrar")
            botones.accepted.connect(d.accept)
            botones.rejected.connect(d.reject)
            form.addRow(botones)
            if caja_email.text():
                caja_clave.setFocus()
            estilo.barra_titulo_oscura(d)
            if d.exec() != QDialog.Accepted:
                return False
            email, contrasena = caja_email.text().strip(), caja_clave.text()
        try:
            nombre = self.web.entrar(email, contrasena)
        except ErrorWeb as e:
            QMessageBox.warning(self, "No se ha podido entrar", str(e))
            return False
        self.ajustes_qt.setValue("web_token", self.web.token)
        self.ajustes_qt.setValue("web_usuario", nombre)
        self.ajustes_qt.setValue("web_email", email)
        self._mostrar_sesion()
        self.actualizar()
        self._reloj.start()
        return True

    def desconectar(self):
        self.web.token = None
        for k in ("web_token", "web_usuario"):
            self.ajustes_qt.remove(k)
        self._mostrar_sesion()
        self._reloj.stop()

    def _sesion_caducada(self):
        self.desconectar()
        self.texto_sesion.setText("La sesión ha caducado: vuelve a <b>entrar</b>.")

    # ---------------------------------------------------------------- tablero de post-its

    def actualizar(self, silencio: bool = False, despues=None):
        if not self.web.token:
            return

        def trabajo():
            return self.web.pedidos(), self.web.materiales()

        def listo(r):
            self.pedidos, self.materiales = r
            self._guardar_cache()
            self._llenar_tablero(f"Actualizado a las {datetime.now():%H:%M}")
            if despues:
                despues()

        def fallo(m):
            if silencio:
                self.texto_lista.setText(f"<span style='color:{C['mal']}'>{html.escape(m)}</span>")
            else:
                self._avisar_error(m)

        self.texto_lista.setText("Actualizando…")
        self._en_segundo_plano(trabajo, listo, fallo)

    def orden(self) -> list[dict]:
        """Los pedidos del tablero en el orden en que se recorren (columna a columna, de arriba abajo)."""
        return [p for clave, _, _ in COLUMNAS for p in self.pedidos if columna_de(p) == clave]

    def _llenar_tablero(self, nota: str | None = None):
        for _, lista in self.columnas.values():
            while lista.count():
                w = lista.takeAt(0).widget()
                if w is not None:
                    w.deleteLater()
        self.postits = {}
        for clave, titulo, _ in COLUMNAS:
            t, lista = self.columnas[clave]
            suyos = [p for p in self.pedidos if columna_de(p) == clave]  # ya vienen en orden de salida
            t.setText(f"{titulo.upper()} · {len(suyos)}")
            for p in suyos:
                postit = PostIt(p, self.elegir)
                lista.addWidget(postit)
                self.postits[p["id"]] = postit
        fuera = sum(1 for p in self.pedidos if (p.get("plazo") or {}).get("nivel") == "fuera")
        resumen = f"{len(self.pedidos)} pedido(s)" + (f" · <b style='color:#e03131'>{fuera} fuera de plazo</b>" if fuera else "")
        self.texto_lista.setText(resumen + (f" · {nota}" if nota else ""))
        if self.pedido and self.pedido["id"] in self.postits:
            self.postits[self.pedido["id"]].marcar(True)
            self.pedido.update(next(p for p in self.pedidos if p["id"] == self.pedido["id"]))
            self._mostrar_pedido()
        elif self.pedido is not None:
            self.pedido = None
            self._mostrar_pedido()

    def _guardar_cache(self):
        self.ajustes_qt.setValue("web_cache", json.dumps({
            "cuando": datetime.now().isoformat(timespec="minutes"), "pedidos": self.pedidos,
            "materiales": self.materiales}))

    def _cargar_cache(self):
        try:
            datos = json.loads(self.ajustes_qt.value("web_cache", "") or "{}")
        except ValueError:
            return
        if not datos.get("pedidos"):
            return
        self.pedidos = datos["pedidos"]
        self.materiales = datos.get("materiales") or []
        cuando = datos.get("cuando", "").replace("T", " a las ")
        self._llenar_tablero(f"lista guardada del {cuando} (pulsa «Actualizar»)")

    def elegir(self, id_: str):
        if self.pedido and self.pedido.get("id") == id_:
            return
        if self.pedido and self.pedido["id"] in self.postits:
            self.postits[self.pedido["id"]].marcar(False)
        if id_ in self.postits:
            self.postits[id_].marcar(True)
        resumen = next((p for p in self.pedidos if p["id"] == id_), None)
        self.pedido = dict(resumen or {"id": id_})
        self._mostrar_pedido()
        if self.web.token:
            self._en_segundo_plano(lambda: self.web.pedido(id_), self._detalle_llegado)

    def mover(self, paso: int):
        """Al pedido anterior o siguiente del tablero."""
        orden = self.orden()
        if not orden:
            return
        ids = [p["id"] for p in orden]
        i = ids.index(self.pedido["id"]) if self.pedido and self.pedido["id"] in ids else (-1 if paso > 0 else 0)
        self.elegir(ids[(i + paso) % len(ids)])

    def _detalle_llegado(self, detalle: dict):
        if not self.pedido or self.pedido.get("id") != detalle.get("id"):
            return  # ya se ha elegido otro
        self.pedido = detalle
        self._mostrar_pedido()

    # ---------------------------------------------------------------- hoja del pedido

    def _mostrar_pedido(self):
        p = self.pedido
        hay = p is not None
        self.zona_hoja.setVisible(hay and "pies" in p)
        self.boton_anterior.setEnabled(bool(self.pedidos))
        self.boton_siguiente.setEnabled(bool(self.pedidos))
        if not hay:
            self.cabecera.setText("<span style='color:%s'>Elige un post-it del tablero.</span>" % C["secundario"])
            self.texto_pauta.setText("")
            return
        plazo = p.get("plazo") or {}
        color = PAPEL.get(plazo.get("nivel"), PAPEL[None])[1]
        partes = [f"<span style='font-size:14pt; font-weight:600'>#{p.get('numero', '')} · "
                  f"{html.escape(p.get('paciente', ''))}</span>",
                  f"{html.escape(p.get('clinica', ''))} · {html.escape(p.get('paso', ''))}"
                  f" · <b style='color:{color}'>{html.escape(plazo.get('texto') or 'sin pago')}</b>"
                  + (f" · lote {html.escape(p['lote'])}" if p.get("lote") else "")
                  + (f" · {ENTREGA[p['entrega']]}" if p.get("entrega") in ENTREGA else "")]
        if p.get("rehacer"):
            partes.append("<b style='color:#e03131'>⚠ Rehacer con prioridad (no pasó calidad)</b>")
        self.cabecera.setText("<br>".join(partes))
        if "pies" not in p:
            self.texto_pauta.setText("Cargando la pauta…" if self.web.token else "")
            return
        pauta = []
        for pie in p["pies"]:
            datos = (f"<br><span style='color:{C['secundario']}'>{html.escape(' · '.join(pie['datos']))}</span>"
                     if pie.get("datos") else "")
            pauta.append(f"<b>{pie['pie']} · {html.escape(pie['nombre'])}</b>: {html.escape(pie['pauta'])}{datos}")
        ficha = [(a, b) for a, b in p.get("ficha") or [] if a != "Entrega"]
        if ficha:
            pauta.append("<span style='color:%s'>%s</span>" % (C["secundario"], " · ".join(
                f"{html.escape(a)}: {html.escape(b)}" for a, b in ficha)))
        self.texto_pauta.setText("<br>".join(pauta))
        self._poner_hoja(p.get("hoja"))
        fase = (p.get("estado"), p.get("fase"))
        self.boton_fresado.setVisible(fase == ("FABRICACION", "MECANIZADO"))
        self.boton_terminado.setVisible(fase == ("FABRICACION", "CONFECCION"))

    def _poner_hoja(self, hoja: dict | None):
        self._cargando_hoja = True
        hoja = hoja or {"proceso": "TERMOFORMADO", "capas": [], "notas": "", "minutosCnc": 0, "minutosConfeccion": 0}
        self.botones_proceso.get(hoja.get("proceso"), self.botones_proceso["TERMOFORMADO"]).setChecked(True)
        self.tabla.setRowCount(0)
        for capa in hoja.get("capas", []):
            self.anadir_capa(capa)
        self.caja_cnc.setValue(int(hoja.get("minutosCnc", 0)))
        self.caja_confeccion.setValue(int(hoja.get("minutosConfeccion", 0)))
        self.caja_notas.setPlainText(hoja.get("notas") or "")
        self._cargando_hoja = False

    def anadir_capa(self, capa: dict | None = None):
        capa = capa or {}
        fila = self.tabla.rowCount()
        self.tabla.insertRow(fila)
        combo = QComboBox()
        activos = [m for m in self.materiales if m.get("activo", True) or m["id"] == capa.get("materialId")]
        for m in activos:
            grosor = f"{m['grosorMm']:g}".replace(".", ",") + " mm" if m.get("grosorMm") else ""
            detalle = " · ".join(x for x in (grosor, m.get("dureza") or "") if x)
            combo.addItem(m["nombre"] + (f" ({detalle})" if detalle else ""), m["id"])
        if capa.get("materialId") and combo.findData(capa["materialId"]) < 0:
            combo.addItem(capa.get("nombre") or "(material borrado)", capa["materialId"])
        if capa.get("materialId"):
            combo.setCurrentIndex(combo.findData(capa["materialId"]))
        self.tabla.setCellWidget(fila, 0, combo)
        pies = QComboBox()
        for clave, texto in PIES:
            pies.addItem(texto, clave)
        pies.setCurrentIndex(max(0, pies.findData(capa.get("pies", "par"))))
        self.tabla.setCellWidget(fila, 1, pies)
        self.tabla.setItem(fila, 2, QTableWidgetItem(capa.get("notas", "")))

    def quitar_capa(self):
        fila = self.tabla.currentRow()
        if fila < 0:
            fila = self.tabla.rowCount() - 1
        if fila >= 0:
            self.tabla.removeRow(fila)

    def hoja_actual(self) -> dict:
        capas = []
        for fila in range(self.tabla.rowCount()):
            material = self.tabla.cellWidget(fila, 0)
            if material is None or material.currentData() is None:
                continue
            capa = {"materialId": material.currentData(), "pies": self.tabla.cellWidget(fila, 1).currentData()}
            notas = (self.tabla.item(fila, 2).text() if self.tabla.item(fila, 2) else "").strip()
            if notas:
                capa["notas"] = notas
            capas.append(capa)
        proceso = next((k for k, b in self.botones_proceso.items() if b.isChecked()), "TERMOFORMADO")
        return {"proceso": proceso, "capas": capas, "notas": self.caja_notas.toPlainText().strip(),
                "minutosCnc": self.caja_cnc.value(), "minutosConfeccion": self.caja_confeccion.value()}

    def guardar_hoja(self, al_terminar=None):
        if not self.pedido:
            return
        id_ = self.pedido["id"]
        hoja = self.hoja_actual()

        def listo(guardada):
            if self.pedido and self.pedido.get("id") == id_:
                self.pedido["hoja"] = guardada
            self.principal.notificar("Hoja de confección guardada en la web.", "bien")
            if al_terminar:
                al_terminar()

        self._en_segundo_plano(lambda: self.web.guardar_hoja(id_, hoja), listo)

    # ---------------------------------------------------------------- estados

    def marcar_fresado(self, lote: str | None = None):
        if not self.pedido:
            return
        if lote is None:
            lote, ok = QInputDialog.getText(self, "Molde fresado", "Lote de CNC (tirada) de este molde:",
                                            text=self.pedido.get("lote") or "")
            if not ok:
                return
        id_ = self.pedido["id"]
        self._en_segundo_plano(lambda: self.web.marcar_fresado(id_, lote.strip()),
                               lambda d: self._estado_cambiado(d, "Molde fresado: pasa a confección."))

    def marcar_terminado(self, material: str | None = None):
        if not self.pedido:
            return
        if material is None:
            sugerido = ", ".join(dict.fromkeys(
                self.tabla.cellWidget(f, 0).currentText().split(" (")[0] for f in range(self.tabla.rowCount())))
            material, ok = QInputDialog.getText(
                self, "Confección terminada",
                "Material y lote de material (trazabilidad del par).\nEl par pasa a control de calidad en la web:",
                text=self.pedido.get("material") or sugerido)
            if not ok:
                return
        if not material.strip():
            QMessageBox.warning(self, "Confección", "Escribe el material y su lote para la trazabilidad.")
            return
        id_ = self.pedido["id"]

        def hecho(_):
            self.principal.notificar("Confección terminada: el par pasa a control de calidad.", "bien")
            self.actualizar(silencio=True)

        # Primero se guarda la hoja y luego se cambia el estado.
        self.guardar_hoja(al_terminar=lambda: self._en_segundo_plano(
            lambda: self.web.marcar_confeccion(id_, material.strip()), hecho))

    def _estado_cambiado(self, detalle: dict, texto: str):
        self.principal.notificar(texto, "bien")
        self.pedido = detalle
        self._mostrar_pedido()
        self.actualizar(silencio=True)

    # ---------------------------------------------------------------- aviso de la CNC

    def mostrar_aviso_cnc(self, estado: dict | None):
        """Lo llama la ventana principal cuando la CNC acaba (según el tiempo estimado). None = quitarlo."""
        if not estado:
            self.aviso_cnc.hide()
            return
        pedidos = estado.get("pedidos") or []
        nums = ", ".join(f"#{n}" for n in pedidos)
        self.texto_aviso_cnc.setText(
            f"<span style='font-size:12pt; font-weight:600'>La CNC ha terminado la tirada "
            f"{html.escape(estado.get('lote') or '')}</span><br>{len(estado.get('moldes') or [])} pie(s)"
            + (f" · pedidos {html.escape(nums)}" if nums else " · sin nº de pedido")
            + ". Retira los moldes de la plancha.")
        self.boton_pasar.setVisible(bool(pedidos))
        self.boton_pasar.setText(f"Pasar sus {len(pedidos)} pedidos a confección" if len(pedidos) != 1
                                 else "Pasar su pedido a confección")
        self.aviso_cnc.show()

    def pasar_tirada_a_confeccion(self):
        estado = self.principal.cnc_estado()
        if not estado or not estado.get("pedidos"):
            return
        if not self.web.token and not self.entrar():
            return
        numeros = [int(n) for n in estado["pedidos"]]
        lote = estado.get("lote") or ""

        def trabajo():
            por_numero = {p["numero"]: p for p in self.web.pedidos()}
            hechos, otros = [], []
            for n in numeros:
                p = por_numero.get(n)
                if p and p.get("estado") == "FABRICACION" and p.get("fase") == "MECANIZADO":
                    self.web.marcar_fresado(p["id"], lote)
                    hechos.append(n)
                else:
                    otros.append(n)
            return hechos, otros

        def listo(r):
            hechos, otros = r
            texto = f"{len(hechos)} pedido(s) pasados a confección" if hechos else "Ningún pedido cambiado"
            if otros:
                texto += f" · {', '.join(f'#{n}' for n in otros)} no estaba(n) por fresar"
            self.principal.notificar(texto + ".", "bien" if hechos else "aviso")
            self.principal.cnc_parar()
            self.actualizar(silencio=True)

        self._en_segundo_plano(trabajo, listo)

    # ---------------------------------------------------------------- imprimir

    def html_hoja(self) -> str:
        p = self.pedido or {}
        hoja = self.hoja_actual()
        nombres = {m["id"]: m["nombre"] for m in self.materiales}
        e = html.escape
        filas_pies = "".join(
            f"<tr><td style='font-size:20pt; font-weight:bold; padding:4px 10px'>{e(pie['pie'])}</td>"
            f"<td><b>{e(pie['nombre'])}</b><br>{e(pie['pauta'])}<br><i>{e(' · '.join(pie.get('datos', [])))}</i></td></tr>"
            for pie in p.get("pies", []))
        capas = "".join(
            f"<tr><td>{i}</td><td>{e(nombres.get(capa['materialId'], capa['materialId']))}</td>"
            f"<td>{e(dict(PIES)[capa['pies']])}</td><td>{e(capa.get('notas', ''))}</td></tr>"
            for i, capa in enumerate(hoja["capas"], 1))
        plazo = (p.get("plazo") or {}).get("texto") or "sin pago"
        proceso = "Termoformado al vacío" if hoja["proceso"] == "TERMOFORMADO" else "Capas pegadas y prensadas"
        return f"""<html><body style="font-family:sans-serif; font-size:10pt">
<h2>Hoja de confección · caso #{p.get('numero', '')}</h2>
<p><b>{e(p.get('paciente', ''))}</b> · {e(p.get('clinica', ''))} · {e(ENTREGA.get(p.get('entrega'), ''))}<br>
Plazo: {e(plazo)}{(' · lote ' + e(p['lote'])) if p.get('lote') else ''} · impresa el {datetime.now():%d/%m/%Y %H:%M}</p>
<h3>Pauta por pie</h3><table border="1" cellspacing="0" cellpadding="4" width="100%">{filas_pies}</table>
<h3>Confección: {proceso}</h3>
<table border="1" cellspacing="0" cellpadding="4" width="100%"><tr><th>#</th><th>Material</th><th>Pies</th><th>Notas</th></tr>{capas}</table>
<p>Fresado: {hoja['minutosCnc']} min · Confección: {hoja['minutosConfeccion']} min</p>
<p>{e(hoja['notas']).replace(chr(10), '<br>')}</p>
<p>Material y lote: ______________________ · Hecho por: ______________ · Fecha: ________</p>
</body></html>"""

    def guardar_pdf(self, ruta: str):
        from PySide6.QtGui import QPageSize
        from PySide6.QtPrintSupport import QPrinter

        impresora = QPrinter(QPrinter.HighResolution)
        impresora.setOutputFormat(QPrinter.PdfFormat)
        impresora.setPageSize(QPageSize(QPageSize.A4))
        impresora.setOutputFileName(ruta)
        doc = QTextDocument()
        doc.setHtml(self.html_hoja())
        doc.print_(impresora)

    def imprimir(self):
        if not self.pedido or "pies" not in self.pedido:
            return
        from PySide6.QtPrintSupport import QPrintDialog, QPrinter

        impresora = QPrinter(QPrinter.HighResolution)
        d = QPrintDialog(impresora, self)
        d.setWindowTitle("Imprimir la hoja de confección")
        if d.exec() != QDialog.Accepted:
            return
        doc = QTextDocument()
        doc.setHtml(self.html_hoja())
        doc.print_(impresora)

    # ---------------------------------------------------------------- materiales

    def editar_materiales(self):
        if not self.web.token:
            QMessageBox.information(self, "Materiales", "Entra primero con tu usuario de taller.")
            return
        d = DialogoMateriales(self, self.materiales)
        if d.exec() != QDialog.Accepted:
            return
        lista = d.materiales()

        def listo(guardados):
            self.materiales = guardados
            self._guardar_cache()
            if self.pedido and "pies" in self.pedido:
                self._poner_hoja(self.hoja_actual())
            self.principal.notificar("Materiales guardados en la web.", "bien")

        self._en_segundo_plano(lambda: self.web.guardar_materiales(lista), listo)


class DialogoMateriales(QDialog):
    """Lista de materiales del taller (se guarda entera en la web). Sin precios: esos solo los ve el
    administrador, y la web no los cambia aunque se edite la lista desde aquí."""

    COLUMNAS = ("Nombre", "Tipo", "Grosor (mm)", "Dureza", "Plancha ancho (mm)", "Plancha largo (mm)", "En uso")

    def __init__(self, parent, materiales: list[dict]):
        super().__init__(parent)
        self.setWindowTitle("Materiales del taller")
        self.resize(900, 480)
        lay = QVBoxLayout(self)
        lay.addWidget(estilo.etiqueta(
            "Los materiales que se eligen en cada capa. Los que quites se dejan de ofrecer, pero las hojas "
            "antiguas los conservan.", "nota"))
        self.tabla = QTableWidget(0, len(self.COLUMNAS))
        self.tabla.setHorizontalHeaderLabels(self.COLUMNAS)
        self.tabla.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.tabla.verticalHeader().setVisible(False)
        lay.addWidget(self.tabla, 1)
        for m in materiales:
            self.anadir(m)
        fila = QHBoxLayout()
        b = QPushButton("＋ Añadir material")
        b.clicked.connect(lambda: self.anadir())
        fila.addWidget(b)
        b = QPushButton("Quitar")
        b.clicked.connect(lambda: self.tabla.removeRow(self.tabla.currentRow()) if self.tabla.currentRow() >= 0 else None)
        fila.addWidget(b)
        fila.addStretch(1)
        botones = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        botones.accepted.connect(self._aceptar)
        botones.rejected.connect(self.reject)
        fila.addWidget(botones)
        lay.addLayout(fila)
        estilo.barra_titulo_oscura(self)

    def _numero(self, valor, decimales: int, maximo: float = 100000) -> QDoubleSpinBox:
        c = QDoubleSpinBox()
        c.setRange(0, maximo)
        c.setDecimals(decimales)
        c.setSpecialValueText("—")  # 0 = sin dato
        c.setValue(float(valor or 0))
        return c

    def anadir(self, m: dict | None = None):
        m = m or {"nombre": "", "tipo": "BASE", "activo": True}
        f = self.tabla.rowCount()
        self.tabla.insertRow(f)
        nombre = QTableWidgetItem(m.get("nombre", ""))
        nombre.setData(Qt.UserRole, m.get("id"))
        self.tabla.setItem(f, 0, nombre)
        tipo = QComboBox()
        for clave, texto in TIPOS:
            tipo.addItem(texto, clave)
        tipo.setCurrentIndex(max(0, tipo.findData(m.get("tipo", "BASE"))))
        self.tabla.setCellWidget(f, 1, tipo)
        self.tabla.setCellWidget(f, 2, self._numero(m.get("grosorMm"), 1, 100))
        self.tabla.setItem(f, 3, QTableWidgetItem(m.get("dureza") or ""))
        self.tabla.setCellWidget(f, 4, self._numero(m.get("planchaAnchoMm"), 0))
        self.tabla.setCellWidget(f, 5, self._numero(m.get("planchaLargoMm"), 0))
        activo = QCheckBox()
        activo.setChecked(m.get("activo", True))
        self.tabla.setCellWidget(f, 6, activo)

    def materiales(self) -> list[dict]:
        lista = []
        for f in range(self.tabla.rowCount()):
            nombre = self.tabla.item(f, 0).text().strip() if self.tabla.item(f, 0) else ""
            if not nombre:
                continue
            vacio = lambda c: c.value() or None  # noqa: E731
            m = {
                "nombre": nombre,
                "tipo": self.tabla.cellWidget(f, 1).currentData(),
                "grosorMm": vacio(self.tabla.cellWidget(f, 2)),
                "dureza": (self.tabla.item(f, 3).text().strip() if self.tabla.item(f, 3) else "") or None,
                "planchaAnchoMm": vacio(self.tabla.cellWidget(f, 4)),
                "planchaLargoMm": vacio(self.tabla.cellWidget(f, 5)),
                "activo": self.tabla.cellWidget(f, 6).isChecked(),
                "orden": (f + 1) * 10,
            }
            id_ = self.tabla.item(f, 0).data(Qt.UserRole)
            if id_:
                m["id"] = id_
            lista.append(m)
        return lista

    def _aceptar(self):
        if not self.materiales():
            QMessageBox.warning(self, "Materiales", "Pon al menos un material con nombre.")
            return
        self.accept()
