"""Ventana «Confección»: los pedidos del taller (de la web de Ortosend) en el orden en que deben salir,
la hoja de confección de cada par (proceso, capas de material, tiempos), su coste (material + fresado +
mano de obra) y los cambios de estado «molde fresado» y «confección terminada».

La lista, la pauta y los estados son los de la web: lo que se haga aquí se ve allí al momento (y al revés,
al pulsar «Actualizar» o cada 2 minutos). Sin internet se ve la última lista descargada (solo consulta).
"""

from __future__ import annotations

import html
import json
import threading
import traceback
from datetime import datetime

from PySide6.QtCore import QObject, Qt, QTimer, Signal
from PySide6.QtGui import QColor, QTextDocument
from PySide6.QtWidgets import (
    QAbstractItemView, QButtonGroup, QCheckBox, QComboBox, QDialog, QDialogButtonBox, QDoubleSpinBox,
    QFileDialog, QFormLayout, QHBoxLayout, QHeaderView, QInputDialog, QLabel, QLineEdit, QListWidget,
    QListWidgetItem, QMessageBox, QPlainTextEdit, QPushButton, QScrollArea, QSpinBox, QTableWidget,
    QTableWidgetItem, QVBoxLayout, QWidget,
)

from interfaz import estilo
from interfaz.estilo import C
from interfaz.web import ClienteWeb, ErrorWeb, coste, euros

COLOR_PLAZO = {"fuera": "#e03131", "ajustado": "#f59f00", "ok": "#2f9e44", None: "#868e96"}
FILTROS = (("todos", "Todos"), ("fresar", "Por fresar"), ("confeccion", "En confección"))
PIES = (("par", "Par"), ("I", "Izquierdo"), ("D", "Derecho"))
TIPOS = (("BASE", "Base"), ("REFUERZO", "Refuerzo"), ("FORRO", "Forro"), ("ADHESIVO", "Adhesivo"), ("OTRO", "Otro"))
ENTREGA = {"CLINICA": "Recogida en clínica", "DOMICILIO": "Envío a domicilio"}


class _Puente(QObject):
    hecho = Signal(object, object)  # (función a llamar, resultado)
    fallo = Signal(object, str)  # (función a llamar, mensaje)


class VentanaConfeccion(QDialog):
    SINCRONO = False  # en las pruebas, las peticiones se hacen en el momento (sin hilos)

    def __init__(self, principal):
        super().__init__(principal)
        self.principal = principal
        self.ajustes_qt = principal.ajustes
        url = principal.taller.get("web", {}).get("url", "https://ortosend-five.vercel.app")
        self.web = ClienteWeb(url, self.ajustes_qt.value("web_token", "") or None)
        self.setWindowTitle("Confección – pedidos del taller")
        self.resize(1250, 820)
        self.pedidos: list[dict] = []
        self.pedido: dict | None = None  # detalle del elegido
        self.materiales: list[dict] = []
        self.coste_ajustes: dict | None = None
        self.filtro = "todos"
        self._cargando_hoja = False
        self._puente = _Puente()
        self._puente.hecho.connect(lambda f, r: f(r))
        self._puente.fallo.connect(lambda f, m: f(m))

        # ---------------------------------------------------------------- izquierda: pedidos
        izq = QVBoxLayout()
        marco, lay, _ = estilo.tarjeta("Pedidos del taller", "1")
        fila = QHBoxLayout()
        self.texto_sesion = estilo.etiqueta("", "secundario")
        fila.addWidget(self.texto_sesion, 1)
        self.boton_sesion = QPushButton("Entrar")
        self.boton_sesion.setProperty("pequeno", True)
        self.boton_sesion.clicked.connect(self._entrar_o_salir)
        fila.addWidget(self.boton_sesion)
        lay.addLayout(fila)
        fila = QHBoxLayout()
        fila.setSpacing(0)
        grupo = QButtonGroup(self)
        self.botones_filtro = {}
        for (clave, texto), lado in zip(FILTROS, ("izq", "medio", "der")):
            b = QPushButton(texto)
            b.setCheckable(True)
            b.setProperty("segmento", lado)
            b.setProperty("pequeno", True)
            b.setChecked(clave == "todos")
            b.toggled.connect(lambda v, c=clave: v and self._cambiar_filtro(c))
            grupo.addButton(b)
            fila.addWidget(b, 1)
            self.botones_filtro[clave] = b
        lay.addLayout(fila)
        self.lista = QListWidget()
        self.lista.setMinimumWidth(380)
        self.lista.setSpacing(2)
        self.lista.currentRowChanged.connect(self._al_elegir)
        lay.addWidget(self.lista, 1)
        self.texto_lista = estilo.etiqueta("", "nota")
        lay.addWidget(self.texto_lista)
        fila = QHBoxLayout()
        self.boton_actualizar = QPushButton("Actualizar")
        self.boton_actualizar.setIcon(estilo.icono("reciente"))
        self.boton_actualizar.clicked.connect(lambda: self.actualizar())
        fila.addWidget(self.boton_actualizar, 1)
        b = QPushButton("Materiales…")
        b.clicked.connect(self.editar_materiales)
        fila.addWidget(b, 1)
        b = QPushButton("Costes…")
        b.clicked.connect(self.editar_ajustes)
        fila.addWidget(b, 1)
        lay.addLayout(fila)
        izq.addWidget(marco, 1)

        # ---------------------------------------------------------------- derecha: hoja
        marco, lay, _ = estilo.tarjeta("Hoja de confección", "2")
        self.cabecera = QLabel()
        self.cabecera.setTextFormat(Qt.RichText)
        self.cabecera.setWordWrap(True)
        lay.addWidget(self.cabecera)
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
            b.toggled.connect(lambda v: v and self._recalcular())
            self.grupo_proceso.addButton(b)
            fila.addWidget(b, 1)
            self.botones_proceso[clave] = b
        lh.addLayout(fila)
        lh.addWidget(estilo.etiqueta("Capas de material (de abajo arriba)", "secundario"))
        self.tabla = QTableWidget(0, 4)
        self.tabla.setHorizontalHeaderLabels(["Material", "Pies", "Notas", "Coste"])
        self.tabla.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.tabla.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.tabla.verticalHeader().setVisible(False)
        self.tabla.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.tabla.setMinimumHeight(150)
        self.tabla.itemChanged.connect(lambda *_: self._recalcular())
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
        self.caja_cnc.valueChanged.connect(lambda *_: self._recalcular())
        form.addRow(estilo.etiqueta("Fresado (CNC)", "secundario", envolver=False), self.caja_cnc)
        self.caja_confeccion = QSpinBox()
        self.caja_confeccion.setRange(0, 1440)
        self.caja_confeccion.setSuffix(" min")
        self.caja_confeccion.valueChanged.connect(lambda *_: self._recalcular())
        form.addRow(estilo.etiqueta("Confección (mano de obra)", "secundario", envolver=False), self.caja_confeccion)
        lh.addLayout(form)
        self.caja_notas = QPlainTextEdit()
        self.caja_notas.setPlaceholderText("Notas de confección (colores, acabados, observaciones…)")
        self.caja_notas.setFixedHeight(64)
        lh.addWidget(self.caja_notas)
        self.texto_coste = QLabel()
        self.texto_coste.setTextFormat(Qt.RichText)
        self.texto_coste.setWordWrap(True)
        lh.addWidget(self.texto_coste)
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

        raiz = QHBoxLayout(self)
        raiz.addLayout(izq, 0)
        raiz.addWidget(derecha, 1)

        self._reloj = QTimer(self)
        self._reloj.setInterval(120_000)
        self._reloj.timeout.connect(lambda: self.actualizar(silencio=True))
        estilo.barra_titulo_oscura(self)
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

    def showEvent(self, evento):
        super().showEvent(evento)
        if self.web.token:
            self.actualizar(silencio=True)
            self._reloj.start()

    def hideEvent(self, evento):
        self._reloj.stop()
        super().hideEvent(evento)

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

    # ---------------------------------------------------------------- lista de pedidos

    def actualizar(self, silencio: bool = False):
        if not self.web.token:
            return

        def trabajo():
            pedidos = self.web.pedidos()
            materiales = self.web.materiales()
            ajustes = self.web.ajustes()
            return pedidos, materiales, ajustes

        def listo(r):
            self.pedidos, self.materiales, self.coste_ajustes = r
            self._guardar_cache()
            self._llenar_lista(f"Actualizado a las {datetime.now():%H:%M}.")

        def fallo(m):
            if silencio:
                self.texto_lista.setText(f"<span style='color:{C['mal']}'>{html.escape(m)}</span>")
            else:
                self._avisar_error(m)

        self.texto_lista.setText("Actualizando…")
        self._en_segundo_plano(trabajo, listo, fallo)

    def _cambiar_filtro(self, clave: str):
        self.filtro = clave
        self._llenar_lista()

    def _visibles(self) -> list[dict]:
        if self.filtro == "fresar":
            return [p for p in self.pedidos if p.get("estado") == "FABRICACION" and p.get("fase") == "MECANIZADO"]
        if self.filtro == "confeccion":
            return [p for p in self.pedidos if p.get("estado") == "FABRICACION" and p.get("fase") == "CONFECCION"]
        return list(self.pedidos)

    def _llenar_lista(self, nota: str | None = None):
        elegido = self.pedido["id"] if self.pedido else None
        self.lista.blockSignals(True)
        self.lista.clear()
        fila_elegida = -1
        for p in self._visibles():
            plazo = p.get("plazo") or {}
            arriba = f"#{p['numero']}  {p['paciente']}"
            if p.get("rehacer"):
                arriba = "⚠ REHACER · " + arriba
            abajo = " · ".join(x for x in (p.get("paso"), plazo.get("texto") or "sin pago",
                                            f"lote {p['lote']}" if p.get("lote") else None, p.get("clinica")) if x)
            item = QListWidgetItem(f"{arriba}\n{abajo}")
            item.setData(Qt.UserRole, p["id"])
            color = "#e03131" if p.get("rehacer") else COLOR_PLAZO.get(plazo.get("nivel"), COLOR_PLAZO[None])
            item.setIcon(_punto(color))
            item.setToolTip(f"{p.get('clinica', '')} · {ENTREGA.get(p.get('entrega'), '')}")
            self.lista.addItem(item)
            if p["id"] == elegido:
                fila_elegida = self.lista.count() - 1
        self.lista.blockSignals(False)
        total = len(self.pedidos)
        fuera = sum(1 for p in self.pedidos if (p.get("plazo") or {}).get("nivel") == "fuera")
        resumen = f"{total} pedido(s) en el taller" + (f" · <b style='color:#e03131'>{fuera} fuera de plazo</b>" if fuera else "")
        self.texto_lista.setText(resumen + (f"<br>{nota}" if nota else ""))
        if fila_elegida >= 0:
            self.lista.setCurrentRow(fila_elegida)
        elif self.pedido is not None:
            self.pedido = None
            self._mostrar_pedido()

    def _guardar_cache(self):
        self.ajustes_qt.setValue("web_cache", json.dumps({
            "cuando": datetime.now().isoformat(timespec="minutes"), "pedidos": self.pedidos,
            "materiales": self.materiales, "ajustes": self.coste_ajustes}))

    def _cargar_cache(self):
        try:
            datos = json.loads(self.ajustes_qt.value("web_cache", "") or "{}")
        except ValueError:
            return
        if not datos.get("pedidos"):
            return
        self.pedidos = datos["pedidos"]
        self.materiales = datos.get("materiales") or []
        self.coste_ajustes = datos.get("ajustes")
        cuando = datos.get("cuando", "").replace("T", " a las ")
        self._llenar_lista(f"Lista guardada del {cuando} (pulsa «Actualizar»).")

    # ---------------------------------------------------------------- hoja del pedido

    def _al_elegir(self, fila: int):
        item = self.lista.item(fila) if fila >= 0 else None
        if item is None:
            return
        id_ = item.data(Qt.UserRole)
        if self.pedido and self.pedido.get("id") == id_ and "pies" in self.pedido:
            return
        resumen = next((p for p in self.pedidos if p["id"] == id_), None)
        self.pedido = dict(resumen or {"id": id_})
        self._mostrar_pedido()
        if not self.web.token:
            return
        self._en_segundo_plano(lambda: self.web.pedido(id_), self._detalle_llegado)

    def _detalle_llegado(self, detalle: dict):
        if not self.pedido or self.pedido.get("id") != detalle.get("id"):
            return  # ya se ha elegido otro
        self.pedido = detalle
        self._mostrar_pedido()

    def _mostrar_pedido(self):
        p = self.pedido
        hay = p is not None
        self.zona_hoja.setVisible(hay and "pies" in p)
        if not hay:
            self.cabecera.setText("<span style='color:%s'>Elige un pedido de la lista.</span>" % C["secundario"])
            self.texto_pauta.setText("")
            return
        plazo = p.get("plazo") or {}
        color = COLOR_PLAZO.get(plazo.get("nivel"), COLOR_PLAZO[None])
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
            datos = f"<br><span style='color:{C['secundario']}'>{html.escape(' · '.join(pie['datos']))}</span>" if pie.get("datos") else ""
            pauta.append(f"<b>{pie['pie']} · {html.escape(pie['nombre'])}</b>: {html.escape(pie['pauta'])}{datos}")
        if p.get("ficha"):
            pauta.append("<span style='color:%s'>%s</span>" % (C["secundario"], " · ".join(
                f"{html.escape(a)}: {html.escape(b)}" for a, b in p["ficha"])))
        self.texto_pauta.setText("<br>".join(pauta))
        self._poner_hoja(p.get("hoja"))
        fase = (p.get("estado"), p.get("fase"))
        self.boton_fresado.setVisible(fase == ("FABRICACION", "MECANIZADO"))
        self.boton_terminado.setVisible(fase == ("FABRICACION", "CONFECCION"))

    def _poner_hoja(self, hoja: dict | None):
        self._cargando_hoja = True
        a = self.coste_ajustes or {}
        hoja = hoja or {"proceso": "TERMOFORMADO", "capas": [], "notas": "",
                        "minutosCnc": a.get("minutosCnc", 30), "minutosConfeccion": a.get("minutosConfeccion", 45)}
        self.botones_proceso.get(hoja.get("proceso"), self.botones_proceso["TERMOFORMADO"]).setChecked(True)
        self.tabla.setRowCount(0)
        for capa in hoja.get("capas", []):
            self.anadir_capa(capa)
        self.caja_cnc.setValue(int(hoja.get("minutosCnc", 0)))
        self.caja_confeccion.setValue(int(hoja.get("minutosConfeccion", 0)))
        self.caja_notas.setPlainText(hoja.get("notas") or "")
        self._cargando_hoja = False
        self._recalcular()

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
        combo.currentIndexChanged.connect(lambda *_: self._recalcular())
        self.tabla.setCellWidget(fila, 0, combo)
        pies = QComboBox()
        for clave, texto in PIES:
            pies.addItem(texto, clave)
        pies.setCurrentIndex(max(0, pies.findData(capa.get("pies", "par"))))
        pies.currentIndexChanged.connect(lambda *_: self._recalcular())
        self.tabla.setCellWidget(fila, 1, pies)
        self.tabla.blockSignals(True)
        self.tabla.setItem(fila, 2, QTableWidgetItem(capa.get("notas", "")))
        importe = QTableWidgetItem("")
        importe.setFlags(Qt.ItemIsEnabled)
        importe.setTextAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.tabla.setItem(fila, 3, importe)
        self.tabla.blockSignals(False)
        self._recalcular()

    def quitar_capa(self):
        fila = self.tabla.currentRow()
        if fila < 0:
            fila = self.tabla.rowCount() - 1
        if fila >= 0:
            self.tabla.removeRow(fila)
            self._recalcular()

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

    def _recalcular(self):
        if self._cargando_hoja:
            return
        if not self.coste_ajustes:
            self.texto_coste.setText("")
            return
        c = coste(self.hoja_actual(), self.materiales, self.coste_ajustes)
        self.tabla.blockSignals(True)
        k = 0
        for fila in range(self.tabla.rowCount()):
            item = self.tabla.item(fila, 3)
            if item is not None and k < len(c["capas"]):
                item.setText(euros(c["capas"][k]))
                k += 1
        self.tabla.blockSignals(False)
        self.ultimo_coste = c
        self.texto_coste.setText(
            f"Material <b>{euros(c['materialCents'])}</b> · Fresado <b>{euros(c['fresadoCents'])}</b> · "
            f"Mano de obra <b>{euros(c['manoObraCents'])}</b> · "
            f"<span style='font-size:12pt'>Coste del par <b>{euros(c['totalCents'])}</b></span>")

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
            self.pedido = None
            self._mostrar_pedido()
            self.principal.notificar("Confección terminada: el par pasa a control de calidad.", "bien")
            self.actualizar(silencio=True)

        # Primero se guarda la hoja (con su coste) y luego se cambia el estado.
        self.guardar_hoja(al_terminar=lambda: self._en_segundo_plano(
            lambda: self.web.marcar_confeccion(id_, material.strip()), hecho))

    def _estado_cambiado(self, detalle: dict, texto: str):
        self.principal.notificar(texto, "bien")
        self.pedido = detalle
        self._mostrar_pedido()
        self.actualizar(silencio=True)

    # ---------------------------------------------------------------- imprimir

    def html_hoja(self) -> str:
        p = self.pedido or {}
        hoja = self.hoja_actual()
        c = coste(hoja, self.materiales, self.coste_ajustes) if self.coste_ajustes else None
        nombres = {m["id"]: m["nombre"] for m in self.materiales}
        e = html.escape
        filas_pies = "".join(
            f"<tr><td style='font-size:20pt; font-weight:bold; padding:4px 10px'>{e(pie['pie'])}</td>"
            f"<td><b>{e(pie['nombre'])}</b><br>{e(pie['pauta'])}<br><i>{e(' · '.join(pie.get('datos', [])))}</i></td></tr>"
            for pie in p.get("pies", []))
        capas = "".join(
            f"<tr><td>{i}</td><td>{e(nombres.get(capa['materialId'], capa['materialId']))}</td>"
            f"<td>{e(dict(PIES)[capa['pies']])}</td><td>{e(capa.get('notas', ''))}</td>"
            f"<td align='right'>{euros(c['capas'][i - 1]) if c else ''}</td></tr>"
            for i, capa in enumerate(hoja["capas"], 1))
        plazo = (p.get("plazo") or {}).get("texto") or "sin pago"
        proceso = "Termoformado al vacío" if hoja["proceso"] == "TERMOFORMADO" else "Capas pegadas y prensadas"
        coste_html = (f"<p>Material {euros(c['materialCents'])} · Fresado {euros(c['fresadoCents'])} · "
                      f"Mano de obra {euros(c['manoObraCents'])} · <b>Coste del par {euros(c['totalCents'])}</b></p>"
                      if c else "")
        return f"""<html><body style="font-family:sans-serif; font-size:10pt">
<h2>Hoja de confección · caso #{p.get('numero', '')}</h2>
<p><b>{e(p.get('paciente', ''))}</b> · {e(p.get('clinica', ''))} · {e(ENTREGA.get(p.get('entrega'), ''))}<br>
Plazo: {e(plazo)}{(' · lote ' + e(p['lote'])) if p.get('lote') else ''} · impresa el {datetime.now():%d/%m/%Y %H:%M}</p>
<h3>Pauta por pie</h3><table border="1" cellspacing="0" cellpadding="4" width="100%">{filas_pies}</table>
<h3>Confección: {proceso}</h3>
<table border="1" cellspacing="0" cellpadding="4" width="100%"><tr><th>#</th><th>Material</th><th>Pies</th><th>Notas</th><th>Coste</th></tr>{capas}</table>
<p>Fresado: {hoja['minutosCnc']} min · Confección: {hoja['minutosConfeccion']} min</p>
<p>{e(hoja['notas']).replace(chr(10), '<br>')}</p>
{coste_html}
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

    # ---------------------------------------------------------------- materiales y costes

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

    def editar_ajustes(self):
        if not self.web.token or not self.coste_ajustes:
            QMessageBox.information(self, "Costes", "Entra primero con tu usuario de taller.")
            return
        d = QDialog(self)
        d.setWindowTitle("Costes del taller")
        form = QFormLayout(d)
        a = self.coste_ajustes
        cajas = {}
        for clave, texto, sufijo, euros_ in (
                ("precioHoraCents", "Mano de obra (por hora)", " €/h", True),
                ("costeCncMinutoCents", "CNC (por minuto)", " €/min", True),
                ("costeMoldeCents", "Escayola de los dos moldes", " €", True),
                ("minutosCnc", "Minutos de CNC (por defecto)", " min", False),
                ("minutosConfeccion", "Minutos de confección (por defecto)", " min", False)):
            c = QDoubleSpinBox()
            c.setRange(0, 100000)
            c.setDecimals(2 if euros_ else 0)
            c.setSuffix(sufijo)
            c.setValue(a.get(clave, 0) / 100 if euros_ else a.get(clave, 0))
            form.addRow(texto, c)
            cajas[clave] = (c, euros_)
        botones = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        botones.accepted.connect(d.accept)
        botones.rejected.connect(d.reject)
        form.addRow(botones)
        estilo.barra_titulo_oscura(d)
        if d.exec() != QDialog.Accepted:
            return
        nuevos = {k: round(c.value() * 100) if e else int(c.value()) for k, (c, e) in cajas.items()}

        def listo(guardados):
            self.coste_ajustes = guardados
            self._guardar_cache()
            self._recalcular()
            self.principal.notificar("Costes guardados en la web.", "bien")

        self._en_segundo_plano(lambda: self.web.guardar_ajustes(nuevos), listo)


def _punto(color: str):
    from PySide6.QtGui import QIcon, QPainter, QPixmap

    pm = QPixmap(14, 14)
    pm.fill(Qt.transparent)
    q = QPainter(pm)
    q.setRenderHint(QPainter.Antialiasing)
    q.setBrush(QColor(color))
    q.setPen(Qt.NoPen)
    q.drawEllipse(1, 1, 12, 12)
    q.end()
    return QIcon(pm)


class DialogoMateriales(QDialog):
    """Tabla editable del catálogo de materiales (se guarda entero en la web)."""

    COLUMNAS = ("Nombre", "Tipo", "Grosor (mm)", "Dureza", "Plancha ancho (mm)", "Plancha largo (mm)",
                "Precio plancha (€)", "Pares por plancha", "En uso")

    def __init__(self, parent, materiales: list[dict]):
        super().__init__(parent)
        self.setWindowTitle("Materiales del taller")
        self.resize(1050, 520)
        lay = QVBoxLayout(self)
        lay.addWidget(estilo.etiqueta(
            "El coste de cada capa es el precio de la plancha entre los pares que salen de ella. "
            "Los materiales que quites se dejan de ofrecer, pero las hojas antiguas los conservan.", "nota"))
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
        m = m or {"nombre": "", "tipo": "BASE", "precioCents": 0, "paresPorPlancha": 1, "activo": True}
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
        self.tabla.setCellWidget(f, 6, self._numero((m.get("precioCents") or 0) / 100, 2))
        pares = self._numero(m.get("paresPorPlancha") or 1, 1, 10000)
        pares.setMinimum(0.1)
        self.tabla.setCellWidget(f, 7, pares)
        activo = QCheckBox()
        activo.setChecked(m.get("activo", True))
        self.tabla.setCellWidget(f, 8, activo)

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
                "precioCents": round(self.tabla.cellWidget(f, 6).value() * 100),
                "paresPorPlancha": self.tabla.cellWidget(f, 7).value(),
                "activo": self.tabla.cellWidget(f, 8).isChecked(),
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
