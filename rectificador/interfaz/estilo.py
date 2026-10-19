"""Aspecto del programa: tema oscuro moderno (como los programas de diseño 3D/CAD).

`aplicar(app)` se llama una vez al arrancar; todas las ventanas toman el mismo aspecto.
Los colores están aquí reunidos (`C`) para usarlos también en textos con formato.
"""

from __future__ import annotations

import sys

from PySide6.QtCore import QByteArray, QRectF, QSize, Qt
from PySide6.QtGui import QColor, QFont, QIcon, QPainter, QPalette, QPixmap
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import QApplication, QFrame, QLabel, QStyleFactory, QVBoxLayout, QWidget

C = {
    "fondo": "#1b1c1f",       # ventana
    "tarjeta": "#25272b",     # paneles
    "campo": "#1f2124",       # cajas de texto, listas
    "borde": "#34373d",
    "borde_suave": "#2d3035",
    "hover": "#2f3237",
    "texto": "#e8e9eb",
    "secundario": "#9aa0a8",
    "apagado": "#6b7078",
    "acento": "#3d8bfd",
    "acento_hover": "#5a9dff",
    "acento_oscuro": "#1f4f99",
    "bien": "#2ecc71",
    "aviso": "#f0a33a",
    "mal": "#ff6b5f",
    "visor_abajo": "#1b1c1f",
    "visor_arriba": "#30333a",
}

QSS = """
* {{ outline: none; }}
QWidget {{ color: {texto}; font-size: 10pt; }}
QMainWindow, QDialog {{ background: {fondo}; }}
QToolTip {{ background: {tarjeta}; color: {texto}; border: 1px solid {borde}; padding: 6px 8px;
            border-radius: 6px; }}

/* Tarjetas del panel */
QFrame#tarjeta {{ background: {tarjeta}; border: 1px solid {borde_suave}; border-radius: 10px; }}
QLabel#titulo_tarjeta {{ color: {secundario}; font-size: 8.5pt; font-weight: 600; letter-spacing: 1px; }}
QLabel#paso {{ background: {acento}; color: white; border-radius: 10px; font-weight: 700;
               min-width: 20px; max-width: 20px; min-height: 20px; max-height: 20px; }}
QLabel#secundario {{ color: {secundario}; }}
QLabel#nota {{ color: {secundario}; font-size: 9pt; }}
QLabel#aviso {{ color: {aviso}; }}
QLabel#cifras {{ background: {campo}; border: 1px solid {borde_suave}; border-radius: 8px; padding: 8px;
                 color: {secundario}; }}
QLabel#titulo_app {{ font-size: 12pt; font-weight: 700; color: {texto}; padding-right: 12px; }}

/* Botones */
QPushButton, QToolButton {{ background: {hover}; border: 1px solid {borde}; border-radius: 7px;
    padding: 6px 12px; color: {texto}; }}
QPushButton:hover, QToolButton:hover {{ background: #383c43; border-color: #474b53; }}
QPushButton:pressed, QToolButton:pressed {{ background: #24262a; }}
QPushButton:checked {{ background: {acento_oscuro}; border-color: {acento}; color: white; }}
QPushButton:disabled, QToolButton:disabled {{ color: {apagado}; background: #222428; border-color: {borde_suave}; }}
QPushButton[primario="true"] {{ background: {acento}; border-color: {acento}; color: white; font-weight: 600;
    padding: 8px 14px; }}
QPushButton[primario="true"]:hover {{ background: {acento_hover}; border-color: {acento_hover}; }}
QPushButton[primario="true"]:disabled {{ background: #2a3a52; border-color: #2a3a52; color: #7d8ba0; }}
QPushButton[plano="true"] {{ background: transparent; border-color: transparent; color: {secundario}; }}
QPushButton[plano="true"]:hover {{ background: {hover}; color: {texto}; }}
QPushButton[pequeno="true"] {{ padding: 3px 10px; font-size: 9pt; }}

/* Botón segmentado (dos opciones juntas) */
QPushButton[segmento="izq"] {{ border-top-right-radius: 0; border-bottom-right-radius: 0; }}
QPushButton[segmento="der"] {{ border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: -1px; }}

/* Barra de herramientas */
QToolBar {{ background: {tarjeta}; border: none; border-bottom: 1px solid {borde_suave}; padding: 6px 10px;
    spacing: 4px; }}
QToolBar QToolButton {{ background: transparent; border: 1px solid transparent; padding: 6px 10px;
    border-radius: 7px; }}
QToolBar QToolButton:hover {{ background: {hover}; border-color: {borde}; }}
QToolBar QToolButton:checked {{ background: {acento_oscuro}; border-color: {acento}; }}
QToolBar QToolButton:disabled {{ background: transparent; border-color: transparent; color: {apagado}; }}
QToolBar::separator {{ background: {borde}; width: 1px; margin: 6px 8px; }}

/* Campos */
QDoubleSpinBox, QSpinBox, QLineEdit {{ background: {campo}; border: 1px solid {borde}; border-radius: 7px;
    padding: 4px 8px; selection-background-color: {acento}; min-height: 20px; }}
QDoubleSpinBox:focus, QSpinBox:focus, QLineEdit:focus {{ border-color: {acento}; }}
QDoubleSpinBox::up-button, QDoubleSpinBox::down-button, QSpinBox::up-button, QSpinBox::down-button {{
    width: 18px; border: none; background: transparent; }}
QDoubleSpinBox::up-arrow, QSpinBox::up-arrow {{ image: url({img_arriba}); width: 10px; height: 10px; }}
QDoubleSpinBox::down-arrow, QSpinBox::down-arrow {{ image: url({img_abajo}); width: 10px; height: 10px; }}
QDoubleSpinBox::up-button:hover, QDoubleSpinBox::down-button:hover {{ background: {hover}; border-radius: 4px; }}
QDoubleSpinBox:disabled {{ color: {apagado}; }}
QCheckBox {{ spacing: 8px; }}
QCheckBox::indicator {{ width: 16px; height: 16px; border-radius: 4px; border: 1px solid #4a4e56;
    background: {campo}; }}
QCheckBox::indicator:checked {{ background: {acento}; border-color: {acento}; image: url({img_check}); }}
QCheckBox:disabled {{ color: {apagado}; }}
QRadioButton::indicator {{ width: 14px; height: 14px; border-radius: 8px; border: 1px solid #4a4e56;
    background: {campo}; }}
QRadioButton::indicator:checked {{ background: {acento}; border: 3px solid {campo}; }}

/* Listas */
QListWidget {{ background: {campo}; border: 1px solid {borde}; border-radius: 8px; padding: 4px; }}
QListWidget::item {{ padding: 6px 8px; border-radius: 6px; }}
QListWidget::item:hover {{ background: {hover}; }}
QListWidget::item:selected {{ background: {acento_oscuro}; color: white; }}

/* Menús */
QMenuBar {{ background: {fondo}; border-bottom: 1px solid {borde_suave}; padding: 2px 6px; }}
QMenuBar::item {{ padding: 5px 10px; border-radius: 6px; background: transparent; }}
QMenuBar::item:selected {{ background: {hover}; }}
QMenu {{ background: {tarjeta}; border: 1px solid {borde}; border-radius: 8px; padding: 6px; }}
QMenu::item {{ padding: 6px 28px 6px 12px; border-radius: 6px; }}
QMenu::item:selected {{ background: {acento_oscuro}; color: white; }}
QMenu::separator {{ height: 1px; background: {borde}; margin: 4px 8px; }}

/* Barra de estado, divisores y desplazamiento */
QStatusBar {{ background: {tarjeta}; border-top: 1px solid {borde_suave}; color: {secundario}; }}
QStatusBar QLabel {{ color: {secundario}; padding: 0 8px; }}
QSplitter::handle {{ background: {fondo}; width: 6px; }}
QScrollArea {{ border: none; background: transparent; }}
QScrollArea > QWidget > QWidget {{ background: transparent; }}
QScrollBar:vertical {{ background: transparent; width: 10px; margin: 2px; }}
QScrollBar::handle:vertical {{ background: #3a3e45; border-radius: 4px; min-height: 30px; }}
QScrollBar::handle:vertical:hover {{ background: #4a4f57; }}
QScrollBar:horizontal {{ background: transparent; height: 10px; margin: 2px; }}
QScrollBar::handle:horizontal {{ background: #3a3e45; border-radius: 4px; min-width: 30px; }}
QScrollBar::add-line, QScrollBar::sub-line {{ width: 0; height: 0; }}
QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}
QProgressBar {{ background: {campo}; border: none; border-radius: 3px; }}
QProgressBar::chunk {{ background: {acento}; border-radius: 3px; }}
QMessageBox {{ background: {tarjeta}; }}
QGraphicsView {{ border: 1px solid {borde_suave}; border-radius: 10px; }}
"""

# Iconos de trazo fino (24 × 24), dibujados para este programa.
_ICONOS = {
    "abrir": '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    "exportar": '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    "anadir": '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>',
    "cnc": '<rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M12 3v8"/><path d="M9 6h6"/>'
           '<circle cx="12" cy="12" r="1.6"/>',
    "vista": '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    "planta": '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16M4 9h16"/>',
    "medir": '<path d="M3 17l14-14 4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    "girar": '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    "lados": '<path d="M7 7h13l-4-4"/><path d="M17 17H4l4 4"/>',
    "ayuda": '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14"/>'
             '<circle cx="12" cy="17.2" r=".6"/>',
    "calcular": '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    "guardar": '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v6h8V3"/>'
               '<rect x="7" y="13" width="10" height="6" rx="1"/>',
    "mapa": '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
    "auto": '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/>'
            '<rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    "quitar": '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    "deshacer": '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    "rehacer": '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    "reciente": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "teclado": '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    "info": '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".6"/>',
    "pie": '<path d="M11 4c3.5 0 5.5 3.5 5.5 8 0 3-1 4.5-1 6.5 0 2.5-1.5 4-3.8 4S8 21 8 18c0-2 1-3 1-5.5C9 8 9 4 11 4z"/>'
           '<circle cx="18" cy="5" r="1.4"/><circle cx="19.6" cy="8.6" r="1.1"/>',
}


def icono(nombre: str, color: str | None = None, tam: int = 20) -> QIcon:
    """Icono dibujado en el color del texto (o el indicado)."""
    color = color or C["texto"]
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{color}" '
           f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{_ICONOS[nombre]}</svg>')
    ic = QIcon()
    for escala in (1, 2):
        pm = QPixmap(tam * escala, tam * escala)
        pm.fill(Qt.transparent)
        p = QPainter(pm)
        QSvgRenderer(QByteArray(svg.encode())).render(p, QRectF(0, 0, tam * escala, tam * escala))
        p.end()
        pm.setDevicePixelRatio(escala)
        ic.addPixmap(pm)
        gris = QPixmap(pm)
        q = QPainter(gris)
        q.setCompositionMode(QPainter.CompositionMode_SourceIn)
        q.fillRect(gris.rect(), QColor(C["apagado"]))
        q.end()
        ic.addPixmap(gris, QIcon.Disabled)
    return ic


def icono_app() -> QIcon:
    """Icono de la ventana: una huella estilizada sobre fondo de acento."""
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
           f'<rect width="64" height="64" rx="14" fill="{C["acento"]}"/>'
           '<path d="M30 14c7 0 11 7 11 16 0 6-2 9-2 13 0 5-3 9-8 9s-8-4-8-10c0-4 2-6 2-11 0-9 0-17 5-17z" '
           'fill="white"/>'
           '<circle cx="44" cy="15" r="3.2" fill="white"/><circle cx="47.5" cy="22" r="2.4" fill="white"/></svg>')
    ic = QIcon()
    for t in (16, 32, 64, 128):
        pm = QPixmap(t, t)
        pm.fill(Qt.transparent)
        p = QPainter(pm)
        QSvgRenderer(QByteArray(svg.encode())).render(p, QRectF(0, 0, t, t))
        p.end()
        ic.addPixmap(pm)
    return ic


def _imagenes() -> dict[str, str]:
    """Pequeñas imágenes que la hoja de estilos necesita como archivo (marca de casilla, flechas)."""
    import tempfile
    from pathlib import Path

    carpeta = Path(tempfile.gettempdir()) / "rectificador_ortosend_estilo"
    carpeta.mkdir(exist_ok=True)
    trazo = 'fill="none" stroke-linecap="round" stroke-linejoin="round"'
    dibujos = {
        "img_check": f'<path d="M5 12.5l4.5 4.5L19 7.5" stroke="white" stroke-width="3" {trazo}/>',
        "img_arriba": f'<path d="M6 15l6-6 6 6" stroke="{C["secundario"]}" stroke-width="3" {trazo}/>',
        "img_abajo": f'<path d="M6 9l6 6 6-6" stroke="{C["secundario"]}" stroke-width="3" {trazo}/>',
    }
    rutas = {}
    for nombre, cuerpo in dibujos.items():
        ruta = carpeta / f"{nombre}.svg"
        ruta.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">{cuerpo}</svg>',
                        encoding="utf-8")
        rutas[nombre] = ruta.as_posix()
    return rutas


def aplicar(app: QApplication) -> None:
    """Tema oscuro para toda la aplicación."""
    app.setStyle(QStyleFactory.create("Fusion"))
    try:  # Qt 6.8 o más nuevo: Windows pone oscuras las barras de título de todas las ventanas
        app.styleHints().setColorScheme(Qt.ColorScheme.Dark)
    except AttributeError:
        pass
    pal = QPalette()
    for rol, color in ((QPalette.Window, C["fondo"]), (QPalette.WindowText, C["texto"]),
                       (QPalette.Base, C["campo"]), (QPalette.AlternateBase, C["tarjeta"]),
                       (QPalette.Text, C["texto"]), (QPalette.Button, C["hover"]),
                       (QPalette.ButtonText, C["texto"]), (QPalette.Highlight, C["acento"]),
                       (QPalette.HighlightedText, "#ffffff"), (QPalette.ToolTipBase, C["tarjeta"]),
                       (QPalette.ToolTipText, C["texto"]), (QPalette.PlaceholderText, C["apagado"]),
                       (QPalette.Link, C["acento_hover"])):
        pal.setColor(rol, QColor(color))
    for rol in (QPalette.WindowText, QPalette.Text, QPalette.ButtonText):
        pal.setColor(QPalette.Disabled, rol, QColor(C["apagado"]))
    app.setPalette(pal)
    familia = "Segoe UI" if sys.platform.startswith("win") else "Inter"
    f = QFont(familia, 10)
    f.setStyleStrategy(QFont.PreferAntialias)
    app.setFont(f)
    app.setStyleSheet(QSS.format(**C, **_imagenes()))
    app.setWindowIcon(icono_app())


def repulir(w: QWidget) -> None:
    """Vuelve a aplicar el estilo tras cambiar una propiedad (p. ej. `primario`)."""
    w.style().unpolish(w)
    w.style().polish(w)


def primario(boton) -> None:
    boton.setProperty("primario", True)
    repulir(boton)


def tarjeta(titulo: str, paso: str | None = None) -> tuple[QFrame, QVBoxLayout, QLabel]:
    """Panel con título (en mayúsculas pequeñas) y, si se da, el número de paso en un círculo.
    Devuelve (marco, layout para el contenido, etiqueta del título)."""
    marco = QFrame()
    marco.setObjectName("tarjeta")
    lay = QVBoxLayout(marco)
    lay.setContentsMargins(14, 12, 14, 14)
    lay.setSpacing(8)
    from PySide6.QtWidgets import QHBoxLayout
    cab = QHBoxLayout()
    cab.setSpacing(8)
    if paso:
        n = QLabel(paso)
        n.setObjectName("paso")
        n.setAlignment(Qt.AlignCenter)
        cab.addWidget(n)
    t = QLabel(titulo.upper())
    t.setObjectName("titulo_tarjeta")
    cab.addWidget(t, 1)
    lay.addLayout(cab)
    return marco, lay, t


def etiqueta(texto: str = "", nombre: str | None = None, envolver: bool = True) -> QLabel:
    e = QLabel(texto)
    if nombre:
        e.setObjectName(nombre)
    e.setWordWrap(envolver)
    return e


def html(texto: str, tipo: str) -> str:
    """Texto coloreado con los colores del tema (para etiquetas con formato)."""
    return f"<span style='color:{C[tipo]}'>{texto}</span>"


TAM_ICONO = QSize(20, 20)


def barra_titulo_oscura(ventana: QWidget) -> None:
    """Barra de título oscura en Windows 10/11 (si Qt no lo ha hecho ya)."""
    if not sys.platform.startswith("win"):
        return
    try:
        import ctypes

        valor = ctypes.c_int(1)
        for atributo in (20, 19):  # DWMWA_USE_IMMERSIVE_DARK_MODE (Windows 11 / 10 antiguo)
            if ctypes.windll.dwmapi.DwmSetWindowAttribute(int(ventana.winId()), atributo, ctypes.byref(valor),
                                                           ctypes.sizeof(valor)) == 0:
                break
    except Exception:  # noqa: BLE001 - es solo estética
        pass


class Aviso(QLabel):
    """Aviso flotante que aparece abajo, en el centro de la ventana, y se va solo."""

    def __init__(self, padre: QWidget):
        super().__init__(padre)
        from PySide6.QtCore import QPropertyAnimation, QTimer
        from PySide6.QtWidgets import QGraphicsOpacityEffect

        self.setObjectName("aviso_flotante")
        self.setAlignment(Qt.AlignCenter)
        self.setWordWrap(True)
        self.setAttribute(Qt.WA_TransparentForMouseEvents)
        self._opacidad = QGraphicsOpacityEffect(self)
        self.setGraphicsEffect(self._opacidad)
        self._anim = QPropertyAnimation(self._opacidad, b"opacity", self)
        self._anim.setDuration(250)
        self._anim.finished.connect(lambda: self._opacidad.opacity() < 0.05 and self.hide())
        self._reloj = QTimer(self)
        self._reloj.setSingleShot(True)
        self._reloj.timeout.connect(self._desvanecer)
        self.hide()

    def mostrar(self, texto: str, tipo: str = "info", ms: int = 2600):
        color = {"info": C["acento"], "bien": C["bien"], "aviso": C["aviso"], "mal": C["mal"]}[tipo]
        self.setStyleSheet(f"QLabel#aviso_flotante {{ background: {C['tarjeta']}; color: {C['texto']}; "
                           f"border: 1px solid {C['borde']}; border-left: 4px solid {color}; border-radius: 8px; "
                           f"padding: 10px 16px; font-size: 10pt; }}")
        self.setText(texto)
        padre = self.parentWidget()
        self.setMaximumWidth(min(620, padre.width() - 40))
        self.adjustSize()
        self.move((padre.width() - self.width()) // 2, padre.height() - self.height() - 48)
        self.raise_()
        self.show()
        self._anim.stop()
        self._anim.setStartValue(self._opacidad.opacity() if self.isVisible() else 0.0)
        self._anim.setEndValue(1.0)
        self._anim.start()
        self._reloj.start(ms)

    def _desvanecer(self):
        self._anim.stop()
        self._anim.setStartValue(1.0)
        self._anim.setEndValue(0.0)
        self._anim.start()
