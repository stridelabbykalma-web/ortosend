"""Plancha de la tirada vista desde arriba, para colocar los pies con el ratón.

Escena en milímetros (1 unidad = 1 mm). La Y de la plancha va hacia arriba en pantalla (delante = abajo,
como se ve la máquina de frente), así que en la escena y_escena = largo − y.

Cada pie es un `PieItem` que se arrastra entero y con suavidad: mientras se mueve solo se comprueba si
cabe (comprobación de rectángulos, instantánea) y se colorea su halo verde o rojo. Al soltarlo se avisa a
la ventana, que decide si se queda ahí.
"""

from __future__ import annotations

import numpy as np
from PySide6.QtCore import QPointF, QRectF, Qt, QTimer
from PySide6.QtGui import QBrush, QColor, QFont, QImage, QPainter, QPainterPath, QPen, QPixmap, QPolygonF
from PySide6.QtWidgets import (
    QGraphicsItem, QGraphicsObject, QGraphicsPathItem, QGraphicsScene, QGraphicsView, QMenu,
)
from scipy import ndimage

from ortomolde import cnc

COLORES = ["#0984e3", "#00b894", "#6c5ce7", "#e17055", "#d4a017", "#e84393", "#00a8a8", "#2d3436"]
VERDE, ROJO, GRIS = QColor(39, 174, 96, 110), QColor(231, 76, 60, 130), QColor(120, 120, 120, 70)


def _imagen(gris: np.ndarray, alfa: np.ndarray) -> QPixmap:
    """Matriz (filas = Y de la escena hacia abajo) de grises 0..255 y transparencia 0..255 → QPixmap."""
    rgba = np.empty(gris.shape + (4,), np.uint8)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = gris
    rgba[..., 3] = alfa
    rgba = np.ascontiguousarray(rgba)
    img = QImage(rgba.data, rgba.shape[1], rgba.shape[0], rgba.shape[1] * 4, QImage.Format_RGBA8888)
    return QPixmap.fromImage(img.copy())


class PieItem(QGraphicsObject):
    """Un pie de la tirada: su relieve, el halo que necesita la fresa, su número, nombre y dedos."""

    def __init__(self, vista: "VistaPlancha", pieza: cnc.Pieza):
        super().__init__()
        self.vista = vista
        self.pieza = pieza
        self.numero: int | None = None
        self.estado = "normal"  # normal / bien / mal (mientras se arrastra)
        self._cache: dict[int, tuple[QPixmap, QPixmap]] = {}
        self._halos: dict[tuple[int, str], QPixmap] = {}
        self._sincronizando = False
        self._celdas = (pieza.x, pieza.y)
        self.setFlags(QGraphicsItem.ItemIsSelectable | QGraphicsItem.ItemSendsGeometryChanges)
        self._agarre: QPointF | None = None  # dónde se cogió el pie (respecto a su esquina) al arrastrar
        self.setCursor(Qt.OpenHandCursor)
        self.setAcceptHoverEvents(True)

    # -------------------------------------------------------------- dibujo

    def _imagenes(self) -> tuple[QPixmap, QPixmap]:
        """(pie, halo) para el giro actual; se calculan una vez por giro."""
        g = self.pieza.giro
        if g not in self._cache:
            m = self.vista.margen
            h = np.flipud(self.pieza.h_girada())
            s = np.flipud(self.pieza.silueta_girada())
            alto = max(float(h.max()), 1e-6)
            gris = (150 + 100 * h / alto).astype(np.uint8)
            pie = _imagen(gris, np.where(s, 255, 0).astype(np.uint8))
            d = ndimage.distance_transform_edt(~np.pad(s, m), sampling=1.0)
            halo = _imagen(np.full(d.shape, 255, np.uint8), np.where(d <= m, 255, 0).astype(np.uint8))
            self._cache[g] = (pie, halo)
        return self._cache[g]

    def boundingRect(self) -> QRectF:
        ny, nx = self.pieza.forma()
        m, paso = self.vista.margen, self.vista.paso
        return QRectF(0, 0, (nx + 2 * m) * paso, (ny + 2 * m) * paso)

    def shape(self) -> QPainterPath:
        # Se coge por el pie, no por el halo.
        ny, nx = self.pieza.forma()
        m, paso = self.vista.margen, self.vista.paso
        camino = QPainterPath()
        camino.addRect(QRectF(m * paso, m * paso, nx * paso, ny * paso))
        return camino

    def paint(self, p: QPainter, opcion, widget=None):
        pie, halo = self._imagenes()
        ny, nx = self.pieza.forma()
        m, paso = self.vista.margen, self.vista.paso
        clave = (self.pieza.giro, self.estado)
        if clave not in self._halos:
            # Halo coloreado: la máscara del halo pintada con el color del estado.
            tenido = QPixmap(halo.size())
            tenido.fill(Qt.transparent)
            q = QPainter(tenido)
            q.drawPixmap(0, 0, halo)
            q.setCompositionMode(QPainter.CompositionMode_SourceIn)
            q.fillRect(tenido.rect(), {"bien": VERDE, "mal": ROJO}.get(self.estado, GRIS))
            q.end()
            self._halos[clave] = tenido
        tenido = self._halos[clave]
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        p.drawPixmap(self.boundingRect(), tenido, QRectF(tenido.rect()))
        caja_pie = QRectF(m * paso, m * paso, nx * paso, ny * paso)
        p.drawPixmap(caja_pie, pie, QRectF(pie.rect()))
        color = QColor(COLORES[((self.numero or 1) - 1) % len(COLORES)])
        if self.isSelected():
            p.setPen(QPen(color, 2.5, Qt.DashLine))
            p.setBrush(Qt.NoBrush)
            p.drawRect(caja_pie.adjusted(-1, -1, 1, 1))
        p.setRenderHint(QPainter.Antialiasing)
        centro = caja_pie.center()
        # Flecha hacia los dedos (en la escena la Y va hacia abajo).
        dx, dy = cnc._hacia_dedos(self.pieza)
        dy = -dy
        largo = 0.28 * max(caja_pie.width(), caja_pie.height())
        a = centro + QPointF(dx, dy) * (largo * 0.15)
        b = centro + QPointF(dx, dy) * largo
        p.setPen(QPen(color, 3, Qt.SolidLine, Qt.RoundCap))
        p.drawLine(a, b)
        n = QPointF(-dy, dx)
        p.setBrush(color)
        p.setPen(Qt.NoPen)
        p.drawPolygon(QPolygonF([b + QPointF(dx, dy) * 8, b + n * 6, b - n * 6]))
        f = QFont()
        f.setPixelSize(7)
        p.setFont(f)
        p.setPen(color)
        p.drawText(QRectF(b.x() - 30, b.y() + (4 if dy > 0 else -16), 60, 12), Qt.AlignCenter, "dedos")
        # Número y nombre, hacia el talón.
        c = centro - QPointF(dx, dy) * (largo * 0.6)
        if self.numero is not None:
            p.setBrush(color)
            p.setPen(QPen(QColor("white"), 1.5))
            p.drawEllipse(c, 12, 12)
            f.setPixelSize(15)
            f.setBold(True)
            p.setFont(f)
            p.setPen(QColor("white"))
            p.drawText(QRectF(c.x() - 12, c.y() - 12, 24, 24), Qt.AlignCenter, str(self.numero))
        molde, _, lado = self.pieza.nombre.partition(" · pie ")
        texto = f"{molde}\n{lado.upper()}" + ("\n(puesto a mano)" if self.pieza.fija else "")
        f.setPixelSize(7)
        p.setFont(f)
        r = QRectF(c.x() - 40, c.y() + 14, 80, 32)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(255, 255, 255, 220))
        caja_txt = p.boundingRect(r, Qt.AlignHCenter | Qt.AlignTop, texto).adjusted(-3, -1, 3, 1)
        p.drawRoundedRect(caja_txt, 3, 3)
        p.setPen(QColor("#222222"))
        p.drawText(r, Qt.AlignHCenter | Qt.AlignTop, texto)

    # -------------------------------------------------------------- posición

    def sincronizar(self):
        """Pone el item donde dice la pieza (sin avisar a nadie)."""
        self.prepareGeometryChange()
        self._sincronizando = True
        self.setPos(self.vista.a_escena(self.pieza))
        self._sincronizando = False
        self._celdas = (self.pieza.x, self.pieza.y)
        self.estado = "normal"
        self.update()

    def celdas_de(self, pos: QPointF) -> tuple[int, int]:
        """Posición del item en la escena → esquina del pie en celdas de la plancha."""
        ny, nx = self.pieza.forma()
        m, paso = self.vista.margen, self.vista.paso
        x = int(round(pos.x() / paso)) + m
        y = int(round((self.vista.largo - pos.y()) / paso)) - ny - m
        return x, y

    def itemChange(self, cambio, valor):
        if cambio == QGraphicsItem.ItemPositionChange and not self._sincronizando:
            paso = self.vista.paso
            valor = QPointF(round(valor.x() / paso) * paso, round(valor.y() / paso) * paso)
            x, y = self.celdas_de(valor)
            if (x, y) != self._celdas:
                self._celdas = (x, y)
                motivo = self.vista.motivo(self.pieza, x, y, self.pieza.giro)
                self.estado = "bien" if motivo is None else "mal"
                self.vista.al_mover(self.pieza, x, y, motivo)
                self.update()
            return valor
        if cambio == QGraphicsItem.ItemSelectedHasChanged:
            self.update()
        return super().itemChange(cambio, valor)

    # El arrastre se hace aquí (no con el de Qt) para que un giro a mitad de un clic no lo descoloque.

    def mousePressEvent(self, ev):
        super().mousePressEvent(ev)  # elegirlo
        if ev.button() == Qt.LeftButton:
            self.setCursor(Qt.ClosedHandCursor)
            self._agarre = ev.scenePos() - self.pos()
            self._inicio = (self.pieza.x, self.pieza.y)
            self.setZValue(2)  # por encima de los demás mientras se mueve
            ev.accept()

    def mouseMoveEvent(self, ev):
        if self._agarre is not None:
            self.setPos(ev.scenePos() - self._agarre)  # itemChange lo ajusta a la rejilla y lo colorea

    def mouseReleaseEvent(self, ev):
        self.setCursor(Qt.OpenHandCursor)
        self.setZValue(0)
        if self._agarre is None:
            return
        self._agarre = None
        x, y = self.celdas_de(self.pos())
        if (x, y) != self._inicio:
            self.vista.al_soltar(self.pieza, x, y)
        else:
            self.sincronizar()

    def mouseDoubleClickEvent(self, ev):
        self._agarre = None
        ev.accept()
        # Se gira cuando termina el doble clic (si no, el ratón aún «tiene cogido» el pie).
        QTimer.singleShot(0, self._girar)

    def _girar(self):
        if self.scene() is not None and self.pieza in self.vista.ventana.piezas:
            self.vista.ventana.girar(self.pieza)

    def contextMenuEvent(self, ev):
        self.setSelected(True)
        menu = QMenu()
        v = self.vista.ventana
        menu.addAction("Girar 90°", lambda: v.girar(self.pieza))
        menu.addAction("Girar 180° (dedos al otro lado)", lambda: v.girar(self.pieza, 2))
        if self.pieza.fija:
            menu.addAction("Volver a colocación automática", lambda: v.soltar(self.pieza))
        menu.addSeparator()
        menu.addAction("Quitar de la tirada", lambda: v.quitar(self.pieza))
        menu.exec(ev.screenPos())


class VistaPlancha(QGraphicsView):
    """La plancha con sus pies. `ventana` es la VentanaTirada (decide qué se puede hacer)."""

    def __init__(self, ventana):
        super().__init__()
        self.escena = QGraphicsScene(self)  # hija de la vista: se borran juntas al cerrar
        self.setScene(self.escena)
        self.ventana = ventana
        self.ancho = self.largo = 0.0
        self.paso = 0.5
        self.margen = 0
        self.items: dict[int, PieItem] = {}
        self._fondo = []
        self._contornos: list[QGraphicsPathItem] = []
        self.setRenderHints(QPainter.Antialiasing | QPainter.SmoothPixmapTransform)
        self.setBackgroundBrush(QColor("#2b2d31"))
        self.setDragMode(QGraphicsView.RubberBandDrag)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.setViewportUpdateMode(QGraphicsView.SmartViewportUpdate)
        self.escena.selectionChanged.connect(self._seleccion)
        self._zoom_usuario = False

    # -------------------------------------------------------------- coordenadas

    def a_escena(self, p: cnc.Pieza) -> QPointF:
        ny, nx = p.forma()
        m = self.margen
        return QPointF((p.x - m) * self.paso, self.largo - (p.y + ny + m) * self.paso)

    def motivo(self, p, x, y, giro):
        return self.ventana._motivo(p, x, y, giro)

    def al_mover(self, p, x, y, motivo):
        self.ventana.al_mover(p, x, y, motivo)

    def al_soltar(self, p, x, y):
        self.ventana.al_soltar(p, x, y)

    # -------------------------------------------------------------- contenido

    def poner_plancha(self, ancho: float, largo: float, paso: float, margen: int):
        cambio = (ancho, largo, paso, margen) != (self.ancho, self.largo, self.paso, self.margen)
        self.ancho, self.largo, self.paso, self.margen = ancho, largo, paso, margen
        if not cambio and self._fondo:
            return
        for it in self._fondo:
            self.escena.removeItem(it)
        self._fondo = []
        for it in self.items.values():
            it._cache.clear()
            it._halos.clear()
        e = self.escena
        r = e.addRect(QRectF(0, 0, ancho, largo), QPen(QColor("#333333"), 1.5), QBrush(QColor("white")))
        r.setZValue(-10)
        self._fondo.append(r)
        rejilla = QPen(QColor("#d0d0d0"), 0.5, Qt.DotLine)
        f = QFont()
        f.setPixelSize(9)
        for x in np.arange(0, ancho + 1e-6, 50):
            if 0 < x < ancho:
                self._fondo.append(e.addLine(x, 0, x, largo, rejilla))
            t = e.addSimpleText(f"{x:.0f}", f)
            t.setBrush(QColor("#bbbbbb"))
            t.setPos(x - t.boundingRect().width() / 2, largo + 3)
            self._fondo.append(t)
        for y in np.arange(0, largo + 1e-6, 50):
            if 0 < y < largo:
                self._fondo.append(e.addLine(0, largo - y, ancho, largo - y, rejilla))
            t = e.addSimpleText(f"{y:.0f}", f)
            t.setBrush(QColor("#bbbbbb"))
            t.setPos(-t.boundingRect().width() - 4, largo - y - t.boundingRect().height() / 2)
            self._fondo.append(t)
        for it in self._fondo:
            it.setZValue(-9)
        r.setZValue(-10)
        o = e.addEllipse(QRectF(-6, largo - 6, 12, 12), QPen(QColor("white"), 1.5), QBrush(QColor("#d63031")))
        o.setZValue(5)
        self._fondo.append(o)
        f.setPixelSize(10)
        f.setBold(True)
        t = e.addSimpleText("ORIGEN X0 Y0 (Z0 arriba)", f)
        t.setBrush(QColor("#ff7675"))
        t.setPos(8, largo + 14)
        self._fondo.append(t)
        t = e.addSimpleText("▼  DELANTE (frente de la máquina)  ▼", f)
        t.setBrush(QColor("#dddddd"))
        t.setPos(ancho / 2 - t.boundingRect().width() / 2, largo + 14)
        self._fondo.append(t)
        e.setSceneRect(QRectF(-40, -20, ancho + 80, largo + 50))
        self.ajustar()

    def poner_piezas(self, piezas: list[cnc.Pieza], numeros: dict[int, int]):
        """Crea, quita o recoloca los items según la lista de piezas (sin recalcular imágenes)."""
        vivos = {id(p) for p in piezas}
        for k in list(self.items):
            if k not in vivos:
                self.escena.removeItem(self.items.pop(k))
        for p in piezas:
            it = self.items.get(id(p))
            if it is None:
                it = PieItem(self, p)
                self.items[id(p)] = it
                self.escena.addItem(it)
            it.setVisible(p.colocada)
            it.numero = numeros.get(id(p))
            if p.colocada:
                it.sincronizar()
        self.borrar_contornos()

    def item_de(self, p: cnc.Pieza) -> PieItem | None:
        return self.items.get(id(p))

    def elegir(self, p: cnc.Pieza | None):
        self.escena.blockSignals(True)
        self.escena.clearSelection()
        if p is not None and (it := self.item_de(p)) is not None:
            it.setSelected(True)
        self.escena.blockSignals(False)
        self.escena.update()

    def _seleccion(self):
        try:
            sel = [it for it in self.escena.selectedItems() if isinstance(it, PieItem)]
        except RuntimeError:  # cerrando la ventana
            return
        self.ventana.al_elegir_en_mapa(sel[0].pieza if sel else None)

    def dibujar_contornos(self, contornos):
        self.borrar_contornos()
        for c in contornos:
            camino = QPainterPath(QPointF(c[0, 0], self.largo - c[0, 1]))
            for x, y in c[1:]:
                camino.lineTo(x, self.largo - y)
            it = self.escena.addPath(camino, QPen(QColor("#e67e22"), 1.2))
            it.setZValue(3)
            self._contornos.append(it)

    def borrar_contornos(self):
        for it in self._contornos:
            self.escena.removeItem(it)
        self._contornos = []

    # -------------------------------------------------------------- zoom y teclado

    def ajustar(self):
        self.fitInView(self.escena.sceneRect(), Qt.KeepAspectRatio)
        self._zoom_usuario = False

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        if not self._zoom_usuario:
            self.ajustar()

    def wheelEvent(self, ev):
        f = 1.15 if ev.angleDelta().y() > 0 else 1 / 1.15
        self.scale(f, f)
        self._zoom_usuario = True

    def mouseDoubleClickEvent(self, ev):
        if self.itemAt(ev.position().toPoint()) is None or not isinstance(
                self.itemAt(ev.position().toPoint()), PieItem):
            self.ajustar()  # doble clic en vacío: ver la plancha entera
        super().mouseDoubleClickEvent(ev)

    def keyPressEvent(self, ev):
        teclas = {Qt.Key_Left: (-1, 0), Qt.Key_Right: (1, 0), Qt.Key_Up: (0, 1), Qt.Key_Down: (0, -1)}
        if ev.key() in teclas:
            d = 10.0 if ev.modifiers() & Qt.ShiftModifier else 1.0
            dx, dy = teclas[ev.key()]
            self.ventana.mover(dx * d, dy * d)
        elif ev.key() == Qt.Key_R:
            self.ventana.girar()
        elif ev.key() == Qt.Key_Delete:
            self.ventana.quitar()
        else:
            super().keyPressEvent(ev)
