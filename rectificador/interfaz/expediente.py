"""Expediente de un pedido, para que el técnico lo revise: la receta (lo que hay que hacer), los vídeos de
la marcha y las fotos de los pies con su análisis, y el cuestionario y la exploración.

Es lo mismo que el taller ve en la web («Expediente clínico completo») y cada consulta queda registrada
en la web (RGPD). Los vídeos, fotos y la receta en PDF se bajan a una carpeta temporal que se borra al
cerrar la ventana (y al salir del programa): son datos de salud y no se quedan en el ordenador.
"""

from __future__ import annotations

import atexit
import html
import shutil
import tempfile
import threading
import traceback
from pathlib import Path

from PySide6.QtCore import QObject, Qt, QSize, QUrl, Signal
from PySide6.QtGui import QDesktopServices, QIcon, QPixmap
from PySide6.QtWidgets import (QHBoxLayout, QLabel, QListWidget, QListWidgetItem, QPushButton, QScrollArea,
                               QSlider, QSplitter, QStackedWidget, QStyle, QTabWidget, QTextBrowser, QVBoxLayout,
                               QWidget)

from . import estilo
from .estilo import C
from .web import ClienteWeb, ErrorWeb

try:  # reproductor dentro del programa (si no está, se abre con el del ordenador)
    from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
    from PySide6.QtMultimediaWidgets import QVideoWidget
except ImportError:  # pragma: no cover - depende de la instalación
    QMediaPlayer = None

_CARPETAS: set[str] = set()


@atexit.register
def _borrar_todo():
    for c in list(_CARPETAS):
        shutil.rmtree(c, ignore_errors=True)


class _Puente(QObject):
    hecho = Signal(object, object)
    fallo = Signal(object, str)


def _p(texto) -> str:
    return html.escape(str(texto or "")).replace("\n", "<br>")


def html_receta(d: dict) -> str:
    """La receta y la pauta, en HTML (lo primero que tiene que ver el técnico)."""
    r = d.get("receta")
    partes = []
    pies = d.get("pies") or []
    if pies:
        partes.append("<h3>Qué hay que hacer (pauta de fabricación)</h3>")
        for pie in pies:
            datos = (f"<br><span style='color:{C['secundario']}'>{_p(' · '.join(pie.get('datos') or []))}</span>"
                     if pie.get("datos") else "")
            partes.append(f"<p><b>{_p(pie.get('pie'))} · {_p(pie.get('nombre'))}</b>: "
                          f"<span style='font-size:12pt'>{_p(pie.get('pauta'))}</span>{datos}</p>")
    if not r:
        partes.append(f"<p style='color:{C['secundario']}'>Este pedido aún no tiene receta firmada.</p>")
        return "".join(partes)
    if r.get("pauta") and not pies:
        partes.append(f"<h3>Pauta de fabricación</h3><p style='font-size:12pt'>{_p(r['pauta'])}</p>")
    partes.append("<h3>Receta</h3>")
    filas = [("Diagnóstico", r.get("diagnostico")), ("Valoración", r.get("valoracion")),
             ("Pauta general", r.get("pauta")), ("Pie izquierdo", r.get("pautaIzq")),
             ("Pie derecho", r.get("pautaDcha")), ("Pauta de uso (para el paciente)", r.get("pautaUso")),
             ("Notas de contacto", r.get("contacto"))]
    partes.append("<table cellspacing=0 cellpadding=4>" + "".join(
        f"<tr><td valign=top style='color:{C['secundario']}'>{_p(a)}</td><td>{_p(b)}</td></tr>"
        for a, b in filas if b) + "</table>")
    firma = r.get("firmada")
    firmada = f" · firmada el {firma[8:10]}/{firma[5:7]}/{firma[:4]}" if firma else ""
    partes.append(f"<p style='color:{C['secundario']}'>Prescribe {_p(r.get('prescriptor'))}"
                  f"{' (col. ' + _p(r['colegiado']) + ')' if r.get('colegiado') else ''}{firmada}</p>")
    return "".join(partes)


def html_expediente(d: dict) -> str:
    """Cuestionario, exploración y escaneo, en HTML."""
    partes = []
    for s in d.get("expediente") or []:
        partes.append(f"<h3>{_p(s.get('titulo'))}</h3>")
        filas = s.get("filas") or []
        if not filas:
            partes.append(f"<p style='color:{C['secundario']}'>Pendiente</p>")
            continue
        partes.append("<table cellspacing=0 cellpadding=3>" + "".join(
            f"<tr><td valign=top style='color:{C['secundario']}'>{_p(a)}</td><td>{_p(b)}</td></tr>"
            for a, b in filas) + "</table>")
    e = d.get("escaneo")
    partes.append("<h3>Escaneo de las espumas</h3>")
    partes.append(f"<p>Proyecto de Revo Scan <b>«{_p(e['proyecto'])}»</b> en la carpeta compartida de "
                  f"<b>{_p(e['clinica'])}</b>.</p>" if e else
                  f"<p style='color:{C['secundario']}'>Pendiente</p>")
    return "".join(partes)


class VentanaExpediente(QWidget):
    """Ventana (no bloquea el programa) con el expediente de un pedido."""

    SINCRONO = False  # en las pruebas, sin hilos

    def __init__(self, parent, web: ClienteWeb, id_: str, titulo: str = ""):
        super().__init__(parent, Qt.Window)
        self.web = web
        self.id_ = id_
        self.detalle: dict | None = None
        self.carpeta = Path(tempfile.mkdtemp(prefix="ortosend_expediente_"))
        _CARPETAS.add(str(self.carpeta))
        self.archivos: dict[str, Path] = {}  # url → archivo bajado
        self._puente = _Puente()
        self._puente.hecho.connect(lambda f, r: f(r))
        self._puente.fallo.connect(lambda f, m: f(m))
        self.setWindowTitle(f"Expediente · {titulo}" if titulo else "Expediente del pedido")
        self.resize(1100, 760)

        lay = QVBoxLayout(self)
        self.cabecera = QLabel(f"<span style='font-size:14pt; font-weight:600'>{_p(titulo)}</span>")
        self.cabecera.setTextFormat(Qt.RichText)
        lay.addWidget(self.cabecera)
        self.aviso = QLabel("Cargando el expediente…")
        self.aviso.setWordWrap(True)
        lay.addWidget(self.aviso)
        self.pestanas = QTabWidget()
        lay.addWidget(self.pestanas, 1)

        # ---------------------------------------------------------------- receta
        receta = QWidget()
        lr = QVBoxLayout(receta)
        self.texto_receta = QTextBrowser()
        self.texto_receta.setOpenLinks(False)
        lr.addWidget(self.texto_receta, 1)
        fila = QHBoxLayout()
        self.boton_pdf = QPushButton("Abrir la receta firmada (PDF)")
        self.boton_pdf.setEnabled(False)
        self.boton_pdf.clicked.connect(self.abrir_pdf)
        fila.addWidget(self.boton_pdf)
        fila.addStretch(1)
        lr.addLayout(fila)
        self.pestanas.addTab(receta, "Receta")

        # ---------------------------------------------------------------- estudio
        estudio = QSplitter()
        self.lista = QListWidget()
        self.lista.setIconSize(QSize(120, 90))
        self.lista.setMinimumWidth(380)
        self.lista.setWordWrap(True)
        self.lista.currentRowChanged.connect(self._ver)
        estudio.addWidget(self.lista)
        derecha = QWidget()
        ld = QVBoxLayout(derecha)
        self.visor = QStackedWidget()
        self.imagen = QLabel()
        self.imagen.setAlignment(Qt.AlignCenter)
        desplazable = QScrollArea()
        desplazable.setWidgetResizable(True)
        desplazable.setWidget(self.imagen)
        self.visor.addWidget(desplazable)
        self.reproductor = self._hacer_reproductor()
        self.visor.addWidget(self.reproductor)
        ld.addWidget(self.visor, 1)
        self.texto_analisis = QLabel()
        self.texto_analisis.setWordWrap(True)
        self.texto_analisis.setTextFormat(Qt.RichText)
        self.texto_analisis.setTextInteractionFlags(Qt.TextSelectableByMouse)
        ld.addWidget(self.texto_analisis)
        fila = QHBoxLayout()
        self.boton_externo = QPushButton("Abrir con el programa del ordenador")
        self.boton_externo.setEnabled(False)
        self.boton_externo.clicked.connect(self.abrir_externo)
        fila.addStretch(1)
        fila.addWidget(self.boton_externo)
        ld.addLayout(fila)
        estudio.addWidget(derecha)
        estudio.setStretchFactor(1, 1)
        self.pestanas.addTab(estudio, "Vídeos y fotos")

        # ---------------------------------------------------------------- cuestionario
        self.texto_expediente = QTextBrowser()
        self.pestanas.addTab(self.texto_expediente, "Cuestionario y exploración")
        estilo.barra_titulo_oscura(self)
        self.cargar()

    # ---------------------------------------------------------------- web en segundo plano

    def _en_segundo_plano(self, trabajo, al_terminar, al_fallar=None):
        al_fallar = al_fallar or self._error

        def correr():
            try:
                r = trabajo()
            except ErrorWeb as e:
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

    def _error(self, mensaje: str):
        self.aviso.setText(f"<span style='color:{C['mal']}'>{html.escape(mensaje)}</span>")
        self.aviso.setVisible(True)

    def cargar(self):
        self._en_segundo_plano(lambda: self.web.pedido(self.id_), self._llegado)

    def _llegado(self, d: dict):
        self.detalle = d
        titulo = f"#{d.get('numero', '')} · {d.get('paciente', '')}"
        self.setWindowTitle(f"Expediente · {titulo}")
        self.cabecera.setText(f"<span style='font-size:14pt; font-weight:600'>{_p(titulo)}</span>"
                              f"<br><span style='color:{C['secundario']}'>{_p(d.get('clinica'))} · "
                              f"{_p(d.get('paso'))}</span>")
        if "receta" not in d:
            self._error("La web de Ortosend aún no envía el expediente (falta publicar su actualización). "
                        "Mientras, se puede ver en la web.")
        elif d.get("aviso"):
            self._error(d["aviso"])
        else:
            self.aviso.setVisible(False)
        self.texto_receta.setHtml(html_receta(d))
        self.boton_pdf.setEnabled(bool((d.get("receta") or {}).get("pdf")))
        self.texto_expediente.setHtml(html_expediente(d))
        self.lista.clear()
        estudio = d.get("estudio") or []
        if not estudio:
            item = QListWidgetItem("Sin vídeos ni fotos")
            item.setFlags(Qt.NoItemFlags)
            self.lista.addItem(item)
        for m in estudio:
            icono = self.style().standardIcon(QStyle.SP_MediaPlay if m.get("tipo") == "video" else QStyle.SP_FileIcon)
            seg = f" · {m['segundos']} s" if m.get("segundos") else ""
            item = QListWidgetItem(icono, f"{m.get('etiqueta', '')}{seg}")
            item.setData(Qt.UserRole, m)
            self.lista.addItem(item)
        # Las fotos se bajan ya (para las miniaturas); los vídeos, al elegirlos.
        for fila, m in enumerate(estudio):
            if m.get("tipo") == "foto":
                self._bajar(m["url"], lambda ruta, fila=fila: self._miniatura(fila, ruta), silencio=True)

    # ---------------------------------------------------------------- archivos

    def _bajar(self, url: str, despues, silencio: bool = False):
        if url in self.archivos:
            despues(self.archivos[url])
            return

        def trabajo():
            datos, tipo = self.web.bajar(url)
            ext = {"video/webm": ".webm", "video/mp4": ".mp4", "image/jpeg": ".jpg", "image/png": ".png",
                   "image/webp": ".webp", "application/pdf": ".pdf"}.get(tipo, "")
            ruta = self.carpeta / f"{url.rstrip('/').rsplit('/', 1)[-1]}{ext}"
            ruta.write_bytes(datos)
            return ruta

        def listo(ruta: Path):
            self.archivos[url] = ruta
            despues(ruta)

        self._en_segundo_plano(trabajo, listo, (lambda m: None) if silencio else self._error)

    def _miniatura(self, fila: int, ruta: Path):
        item = self.lista.item(fila)
        pm = QPixmap(str(ruta))
        if item is not None and not pm.isNull():
            item.setIcon(QIcon(pm.scaled(240, 180, Qt.KeepAspectRatio, Qt.SmoothTransformation)))
        if self.lista.currentRow() == fila:
            self._ver(fila)

    def elegido(self) -> dict | None:
        item = self.lista.currentItem()
        return item.data(Qt.UserRole) if item is not None else None

    def _ver(self, fila: int):
        m = self.elegido()
        self._parar_video()
        if not m:
            return
        self.texto_analisis.setText("<br>".join(_p(t) for t in m.get("resumen") or []))
        ruta = self.archivos.get(m["url"])
        self.boton_externo.setEnabled(ruta is not None)
        if m.get("tipo") == "foto":
            self.visor.setCurrentIndex(0)
            if ruta is None:
                self.imagen.setText("Cargando la foto…")
                self._bajar(m["url"], lambda r, fila=fila: self._ver(fila) if self.lista.currentRow() == fila else None)
                return
            pm = QPixmap(str(ruta))
            self.imagen.setPixmap(pm.scaled(900, 650, Qt.KeepAspectRatio, Qt.SmoothTransformation))
            return
        if ruta is None:
            self.visor.setCurrentIndex(0)
            self.imagen.setText("Bajando el vídeo…")
            self._bajar(m["url"], lambda r, fila=fila: self._ver(fila) if self.lista.currentRow() == fila else None)
            return
        if QMediaPlayer is None:
            self.visor.setCurrentIndex(0)
            self.imagen.setText("Este ordenador no puede reproducir el vídeo aquí: ábrelo con el programa del "
                                "ordenador.")
            return
        self.visor.setCurrentIndex(1)
        self.player.setSource(QUrl.fromLocalFile(str(ruta)))
        self.player.play()

    # ---------------------------------------------------------------- reproductor

    def _hacer_reproductor(self) -> QWidget:
        caja = QWidget()
        lay = QVBoxLayout(caja)
        lay.setContentsMargins(0, 0, 0, 0)
        if QMediaPlayer is None:
            self.player = None
            return caja
        self.video = QVideoWidget()
        lay.addWidget(self.video, 1)
        self.player = QMediaPlayer(self)
        self.salida_audio = QAudioOutput(self)
        self.player.setAudioOutput(self.salida_audio)
        self.player.setVideoOutput(self.video)
        fila = QHBoxLayout()
        self.boton_play = QPushButton("⏸ Pausa")
        self.boton_play.clicked.connect(self._play_pausa)
        fila.addWidget(self.boton_play)
        self.barra = QSlider(Qt.Horizontal)
        self.barra.sliderMoved.connect(self.player.setPosition)
        fila.addWidget(self.barra, 1)
        self.boton_lento = QPushButton("Cámara lenta")
        self.boton_lento.setCheckable(True)
        self.boton_lento.toggled.connect(lambda si: self.player.setPlaybackRate(0.25 if si else 1.0))
        fila.addWidget(self.boton_lento)
        lay.addLayout(fila)
        self.player.durationChanged.connect(lambda d: self.barra.setRange(0, int(d)))
        self.player.positionChanged.connect(lambda p: self.barra.setValue(int(p)) if not self.barra.isSliderDown() else None)
        self.player.playbackStateChanged.connect(
            lambda e: self.boton_play.setText("⏸ Pausa" if e == QMediaPlayer.PlayingState else "▶ Ver"))
        self.player.errorOccurred.connect(
            lambda *_: self.texto_analisis.setText(
                f"<span style='color:{C['mal']}'>No se puede reproducir aquí: usa «Abrir con el programa del "
                f"ordenador».</span>"))
        return caja

    def _play_pausa(self):
        if self.player is None:
            return
        if self.player.playbackState() == QMediaPlayer.PlayingState:
            self.player.pause()
        else:
            self.player.play()

    def _parar_video(self):
        if getattr(self, "player", None) is not None:
            self.player.stop()
            self.player.setSource(QUrl())

    # ---------------------------------------------------------------- abrir fuera

    def abrir_externo(self):
        m = self.elegido()
        ruta = self.archivos.get(m["url"]) if m else None
        if ruta is not None:
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(ruta)))

    def abrir_pdf(self):
        pdf = ((self.detalle or {}).get("receta") or {}).get("pdf")
        if pdf:
            self.boton_pdf.setText("Bajando la receta…")
            self._bajar(pdf, self._pdf_listo)

    def _pdf_listo(self, ruta: Path):
        self.boton_pdf.setText("Abrir la receta firmada (PDF)")
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(ruta)))

    # ---------------------------------------------------------------- cerrar

    def closeEvent(self, evento):
        self._parar_video()
        shutil.rmtree(self.carpeta, ignore_errors=True)
        _CARPETAS.discard(str(self.carpeta))
        super().closeEvent(evento)


def abrir(parent, web: ClienteWeb, id_: str, titulo: str = "") -> VentanaExpediente:
    """Abre (o trae delante, si ya está abierta) la ventana del expediente de ese pedido."""
    abiertas = parent.__dict__.setdefault("_expedientes", {})
    v = abiertas.get(id_)
    if v is not None:
        try:
            v.show()
            v.raise_()
            v.activateWindow()
            return v
        except RuntimeError:  # ya se cerró y Qt la borró
            pass
    v = VentanaExpediente(parent, web, id_, titulo)
    v.setAttribute(Qt.WA_DeleteOnClose)
    v.destroyed.connect(lambda *_: abiertas.pop(id_, None))
    abiertas[id_] = v
    v.show()
    return v
