"""Ventana principal del rectificador de moldes.

Arrancar (desde la carpeta rectificador):  python -m interfaz.principal [ESCANEO.stl]
"""

from __future__ import annotations

import html
import os
import sys
import traceback
from pathlib import Path

import numpy as np
import dataclasses

from PySide6.QtCore import QElapsedTimer, QObject, QSettings, QThread, QTimer, Qt, Signal
from PySide6.QtGui import QAction, QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QApplication, QButtonGroup, QCheckBox, QDialog, QDoubleSpinBox, QFileDialog, QFrame, QHBoxLayout,
    QLabel, QMainWindow, QMenu, QMessageBox, QProgressBar, QPushButton, QScrollArea, QSizePolicy, QSplitter,
    QStackedWidget, QToolBar, QToolButton, QVBoxLayout, QWidget,
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from interfaz import actualizar, escanear as escaneo, estilo  # noqa: E402
from interfaz.estilo import C  # noqa: E402
from interfaz.visor import COLORES, Visor  # noqa: E402
from ortomolde.exportar import exportar, medidas_stl  # noqa: E402
from ortomolde import config  # noqa: E402
from ortomolde.limpieza import NOMBRE_MODO  # noqa: E402
from ortomolde.proyecto import Proyecto  # noqa: E402
from ortomolde import piezas as piezas_mod  # noqa: E402
from ortomolde import trabajo as trabajo_mod  # noqa: E402
from ortomolde.referencias import NOMBRES, OPCIONALES, ORDEN  # noqa: E402

AYUDA = (
    "<b>Proponer referencias</b> coloca las 5 cabezas metatarsales y el talón para empezar.<br>"
    "<b>Ajustar un punto:</b> cógelo con el botón izquierdo y arrástralo sobre el molde.<br>"
    "<b>Marcar a mano:</b> clic <b>derecho</b> sobre el pie (orden: 1.er MTT, 5.º MTT, talón y, si quieres, "
    "2.º, 3.º y 4.º). Para corregir una, pulsa su botón «Marcar» y haz clic derecho donde va.<br>"
    "<b>Vista 3D:</b> girar = arrastrar · desplazar = Mayús + arrastrar · zoom = rueda."
)


def abrir_proyecto(ruta: str, modo: str) -> Proyecto:
    """Un escaneo (se limpia) o un trabajo guardado (.molde, se abre tal cual)."""
    if str(ruta).lower().endswith(trabajo_mod.EXTENSION):
        p = trabajo_mod.abrir(ruta)
        p.ruta_trabajo = Path(ruta)
        return p
    p = Proyecto.abrir(ruta, modo=modo)
    p.ruta_trabajo = None
    return p


def nombre_para_archivos(proyecto: Proyecto) -> str:
    """Nombre del paciente (o del escaneo) apto para un nombre de archivo."""
    nombre = (proyecto.paciente or {}).get("nombre", "").strip() or proyecto.ruta_stl.with_suffix("").name
    limpio = "".join(c if c.isalnum() or c in " -_" else "_" for c in nombre).strip()
    return (limpio or "MOLDE").upper()


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
            proyecto = abrir_proyecto(self.ruta, self.modo)
            proyecto.calcular()  # el lijado se calcula aquí, sin congelar la ventana
            self.terminado.emit(self.peticion, proyecto)
        except Exception as e:  # noqa: BLE001 - se muestra al usuario
            traceback.print_exc()
            self.fallo.emit(self.peticion, str(e))
        finally:
            # El hilo se acaba desde aquí mismo: si la ventana está esperándolo (al cerrar el
            # programa), no puede recibir la orden de acabar y se quedaría colgada.
            QThread.currentThread().quit()


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

        separador = QFrame()
        separador.setFrameShape(QFrame.HLine)
        separador.setStyleSheet(f"color: {C['borde']};")
        lay.addWidget(separador)
        lay.addWidget(estilo.etiqueta("CORRECCIONES", "titulo_tarjeta", envolver=False))
        self.filas_piezas: dict[str, dict] = {}
        for tipo in piezas_mod.TIPOS:
            lay.addWidget(self._fila_pieza(tipo))
        # Solo se ven las correcciones puestas; las demás se añaden desde este menú.
        self.boton_anadir = QToolButton()
        self.boton_anadir.setText("＋ Añadir corrección")
        self.boton_anadir.setPopupMode(QToolButton.InstantPopup)
        self.boton_anadir.setToolButtonStyle(Qt.ToolButtonTextOnly)
        self.menu_anadir = QMenu(self.boton_anadir)
        self.acciones_anadir = {}
        for zona, tipos in piezas_mod.ZONAS.items():
            self.menu_anadir.addSection(zona)
            for tipo in tipos:
                a = self.menu_anadir.addAction(piezas_mod.NOMBRES[tipo])
                a.setToolTip(self.AYUDAS[tipo])
                a.triggered.connect(lambda _=False, t=tipo: self.ventana.cambiar_pieza(self.clave, t, activa=True))
                self.acciones_anadir[tipo] = a
        self.menu_anadir.setToolTipsVisible(True)
        self.boton_anadir.setMenu(self.menu_anadir)
        lay.addWidget(self.boton_anadir)

        self.medidas = QLabel()
        self.medidas.setObjectName("cifras")
        self.medidas.setWordWrap(True)
        self.medidas.setToolTip("Medidas reales del molde en mm, para comprobar la escala.")
        lay.addWidget(self.medidas)

    # Qué se puede ajustar de cada pieza: (atributo, texto, mínimo, máximo[, unidad]).
    AJUSTES = {
        "arco": (("largo", "Largo", 20, 140), ("ancho", "Ancho", 10, 70)),
        "oliva": (("largo", "Largo", 10, 50), ("ancho", "Ancho", 8, 40), ("retraso", "Detrás de las cabezas", -10, 40)),
        "barra": (("largo", "Ancho (a lo largo del pie)", 8, 50), ("retraso", "Detrás de las cabezas", -10, 40)),
        "descarga_1mtt": (("largo", "Diámetro", 8, 45),),
        "descarga_5mtt": (("largo", "Diámetro", 8, 45),),
        "descarga_sesamoideos": (("largo", "Largo", 8, 45), ("ancho", "Ancho", 8, 40)),
        "espolon": (("largo", "Diámetro", 10, 50),),
        "navicular": (("largo", "Largo", 10, 60), ("ancho", "Ancho", 8, 40)),
        "cuboides": (("largo", "Largo", 10, 60), ("ancho", "Ancho", 8, 40)),
        "canal_fascia": (("ancho", "Ancho", 6, 30),),
        "cuna_ant": (("largo", "Desde detrás de las cabezas", 10, 90),),
        "skive": (("largo", "Largo desde atrás", 25, 100), ("angulo", "Inclinación del corte", 5, 45, "°")),
        "cuna_post": (("largo", "Largo desde atrás", 25, 120),),
        "alza": (("largo", "Largo desde atrás (con la rampa)", 40, 220),),
        "expansion_talon": (("largo", "Largo desde atrás", 25, 100),),
    }
    AYUDAS = {
        "arco": "Relleno del arco interno. «Rebajar» añade escayola al arco del molde (la plantilla queda con "
                "menos arco, relleno clásico); «Subir» la quita (más arco).",
        "oliva": "Oliva retrocapital: bulto en la plantilla (hueco en el molde) entre 2.º y 3.er MTT, por detrás "
                 "de las cabezas.",
        "barra": "Barra metatarsal: bulto transversal en la plantilla (hueco en el molde) bajo todas las cabezas "
                 "(1.ª a 5.ª), de borde a borde del pie, curvada como el recorte y por detrás de las cabezas.",
        "descarga_1mtt": "Descarga bajo la cabeza del 1.er MTT: hueco en la plantilla (escayola añadida al molde).",
        "descarga_5mtt": "Descarga bajo la cabeza del 5.º MTT: hueco en la plantilla (escayola añadida al molde).",
        "descarga_sesamoideos": "Descarga de sesamoideos, bajo la 1.ª cabeza un poco por detrás: hueco en la "
                                "plantilla (escayola añadida al molde).",
        "espolon": "Descarga del espolón (tubérculo medial del calcáneo): hueco en la plantilla.",
        "navicular": "Soporte bajo el escafoides: bulto en la plantilla (hueco en el molde).",
        "cuboides": "Soporte bajo el cuboides (columna lateral): bulto en la plantilla (hueco en el molde).",
        "canal_fascia": "Canal para la fascia plantar, del talón a ~10 mm por detrás de la 1.ª cabeza: surco en la "
                        "plantilla (tira de escayola añadida al molde).",
        "cuna_ant": "Cuña intrínseca de antepié en grados: varo sube el lado interno de la plantilla, valgo el "
                    "externo (se quita escayola de ese lado del molde).",
        "skive": "Skive de Kirby: corte en plano inclinado (15°) en la cazoleta del talón. La profundidad "
                 "(2, 4 o 6 mm) es la de la línea a 1/3 del ancho del talón: con 2 mm solo toca ese lado, con "
                 "6 mm cruza toda la cazoleta. Varo = medial; valgo = lateral.",
        "cuna_post": "Cuña intrínseca de retropié en grados: supinadora (varo) o pronadora (valgo).",
        "alza": "Alza de talón: igual bajo el talón y rampa suave hacia delante (se quita escayola del molde).",
        "expansion_talon": "Expansión de talón: el talón se ensancha este % para que quepa al apoyar "
                           "(se añade escayola en la periferia del molde).",
    }

    def _fila_pieza(self, tipo: str) -> QWidget:
        caja = QWidget()
        lay = QVBoxLayout(caja)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(4)
        fila = QHBoxLayout()
        punto = QLabel("●")
        punto.setStyleSheet(f"color: {piezas_mod.COLORES[tipo]}; font-size: 12pt;")
        punto.setFixedWidth(16)
        fila.addWidget(punto)
        activa = QCheckBox(piezas_mod.NOMBRES[tipo])
        activa.setToolTip(self.AYUDAS[tipo])
        activa.toggled.connect(lambda v, t=tipo: self.ventana.cambiar_pieza(self.clave, t, activa=v))
        fila.addWidget(activa, 1)
        altura = QDoubleSpinBox()
        unidad, minimo, maximo, paso = piezas_mod.UNIDAD_ALTURA.get(tipo, ("mm", 0.0, 15.0, 0.5))
        altura.setRange(minimo, maximo)
        altura.setSingleStep(paso)
        altura.setDecimals(1 if unidad == "mm" else 0)
        altura.setSuffix(f" {unidad}")
        altura.setToolTip("Profundidad a 1/3 del ancho del talón" if tipo == "skive" else
                          "Grados de la cuña" if unidad == "°" else
                          "Cuánto se ensancha el talón" if unidad == "%" else
                          "Profundidad del hueco en la plantilla" if tipo.startswith("descarga") or tipo in (
                              "espolon", "canal_fascia") else "Altura en la plantilla")
        altura.valueChanged.connect(lambda v, t=tipo: self.ventana.cambiar_pieza(self.clave, t, altura=v))
        fila.addWidget(altura)
        mas = QPushButton("···")
        mas.setProperty("pequeno", True)
        mas.setCheckable(True)
        mas.setToolTip("Tamaño y posición")
        mas.setFixedWidth(40)
        fila.addWidget(mas)
        lay.addLayout(fila)
        detalle = QWidget()
        ld = QVBoxLayout(detalle)
        ld.setContentsMargins(24, 0, 0, 4)
        ld.setSpacing(4)
        widgets = {"activa": activa, "altura": altura, "detalle": detalle, "mas": mas, "ajustes": {},
                   "caja": caja, "sentidos": []}
        if tipo in piezas_mod.SENTIDOS:
            f = QHBoxLayout()
            f.setSpacing(0)
            grupo = QButtonGroup(caja)
            for (sentido, texto), lado in zip(piezas_mod.SENTIDOS[tipo], ("izq", "der")):
                b = QPushButton(texto)
                b.setCheckable(True)
                b.setProperty("segmento", lado)
                b.setProperty("pequeno", True)
                b.toggled.connect(lambda v, s=sentido, t=tipo: v and self.ventana.cambiar_pieza(self.clave, t, sentido=s))
                grupo.addButton(b)
                f.addWidget(b, 1)
                widgets[f"sentido_{sentido}"] = b
                widgets["sentidos"].append((sentido, b))
            f.setContentsMargins(24, 0, 0, 0)
            lay.addLayout(f)
        adaptar = QCheckBox("Adaptar a la medida del pie")
        adaptar.setToolTip("Más pequeña en un pie pequeño y más grande en uno grande (la altura no cambia).")
        adaptar.toggled.connect(lambda v, t=tipo: self._cambiar_adaptar(t, v))
        ld.addWidget(adaptar)
        widgets["adaptar"] = adaptar
        widgets["escala"] = estilo.etiqueta("", "nota")
        ld.addWidget(widgets["escala"])
        for atributo, texto, minimo, maximo, *unidad in self.AJUSTES[tipo]:
            f = QHBoxLayout()
            f.addWidget(estilo.etiqueta(texto, "secundario", envolver=False), 1)
            c = QDoubleSpinBox()
            c.setRange(minimo, maximo)
            c.setDecimals(0)
            c.setSuffix(f" {unidad[0] if unidad else 'mm'}")
            c.valueChanged.connect(lambda v, t=tipo, a=atributo: self._cambiar_medida(t, a, v))
            f.addWidget(c)
            ld.addLayout(f)
            widgets["ajustes"][atributo] = c
        f = QHBoxLayout()
        f.addWidget(estilo.etiqueta("Movida a mano", "secundario", envolver=False), 1)
        widgets["movida"] = estilo.etiqueta("", "secundario", envolver=False)
        f.addWidget(widgets["movida"])
        volver = QPushButton("A su sitio")
        volver.setProperty("pequeno", True)
        volver.setToolTip("Vuelve a colocarla donde la pone el programa")
        volver.clicked.connect(lambda _=False, t=tipo: self.ventana.cambiar_pieza(self.clave, t, du=0.0, dv=0.0))
        f.addWidget(volver)
        widgets["volver"] = volver
        ld.addLayout(f)
        ld.addWidget(estilo.etiqueta("Para moverla, arrastra su cuadradito en el 3D.", "nota"))
        detalle.setVisible(False)
        mas.toggled.connect(detalle.setVisible)
        lay.addWidget(detalle)
        self.filas_piezas[tipo] = widgets
        return caja

    def _pieza(self, tipo: str):
        p = self.ventana.proyecto
        return p.pies[int(self.clave[1])].piezas[tipo] if p else None

    def _escala_pie(self) -> float:
        p = self.ventana.proyecto
        if not p:
            return 1.0
        return piezas_mod.escala(p.pies[int(self.clave[1])].referencias, p.clinicos["referencias"])

    def _cambiar_medida(self, tipo: str, atributo: str, valor: float):
        """En la ventana se ven los mm de ESTE pie; si se adapta, se guarda la medida para un pie medio."""
        pieza = self._pieza(tipo)
        if pieza is not None and pieza.adaptar and atributo in ("largo", "ancho"):
            valor = valor / self._escala_pie()
        self.ventana.cambiar_pieza(self.clave, tipo, **{atributo: valor})

    def _cambiar_adaptar(self, tipo: str, adaptar: bool):
        """Al activar o quitar «Adaptar», la pieza se queda del mismo tamaño en este pie."""
        pieza = self._pieza(tipo)
        if pieza is None:
            return
        f = self._escala_pie()
        largo, ancho = pieza.medidas(f)
        if adaptar:
            largo, ancho = largo / f, ancho / f
        self.ventana.cambiar_pieza(self.clave, tipo, adaptar=adaptar, largo=largo, ancho=ancho)

    def _actualizar_piezas(self, pie, listo: bool):
        f = self._escala_pie()
        for tipo, w in self.filas_piezas.items():
            pieza = pie.piezas.get(tipo)
            if pieza is None:
                continue
            controles = [w["activa"], w["altura"], w["adaptar"], *w["ajustes"].values()]
            controles += [b for _, b in w["sentidos"]]
            for c in controles:
                c.blockSignals(True)
            w["activa"].setChecked(pieza.activa)
            w["altura"].setValue(pieza.altura)
            w["adaptar"].setChecked(pieza.adaptar)
            medidas = dict(zip(("largo", "ancho"), pieza.medidas(f)))
            for atributo, c in w["ajustes"].items():
                c.setValue(medidas.get(atributo, getattr(pieza, atributo)))
            w["escala"].setText(f"Este pie es un {f * 100:.0f} % de un pie medio: medidas para este pie."
                                if pieza.adaptar else "Medidas fijas en mm.")
            for sentido, b in w["sentidos"]:
                b.setChecked(pieza.sentido == sentido)
            for c in controles:
                c.blockSignals(False)
            for c in controles + [w["mas"]]:
                c.setEnabled(listo)
            w["activa"].setToolTip(self.AYUDAS[tipo] if listo else "Marca antes las 3 referencias de este pie.")
            movida = abs(pieza.du) > 0.05 or abs(pieza.dv) > 0.05
            w["movida"].setText(f"{pieza.du:+.0f} mm a lo largo · {pieza.dv:+.0f} mm de lado" if movida else "no")
            w["volver"].setEnabled(listo and movida)
            w["caja"].setVisible(pieza.activa)  # solo se ven las puestas
            self.acciones_anadir[tipo].setVisible(not pieza.activa)
        self.boton_anadir.setEnabled(listo and any(a.isVisible() for a in self.acciones_anadir.values()))
        self.boton_anadir.setToolTip("Pon una corrección más" if listo else "Marca antes las 3 referencias de este pie.")

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
        self._actualizar_piezas(pie, listo)
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
    _aviso_version = Signal(str, str, bool)  # (versión publicada o "", novedades, en silencio)

    def __init__(self):
        super().__init__()
        self._aviso_version.connect(self._resultado_version)
        self.setWindowTitle("Ortosend Taller")
        self.resize(1400, 850)
        self.ajustes = QSettings("Ortosend", "Rectificador")
        self.ruta_trabajo: Path | None = None  # .molde donde se guarda el trabajo (Ctrl+S)
        self.cambios_sin_guardar = False
        self.proyecto: Proyecto | None = None
        self.taller = config.taller()
        self.tirada = None  # ventana «Tirada de CNC» (se crea al abrirla)
        self._peticion = 0  # cada apertura lleva un número; solo vale el resultado de la última
        self._hilos: list = []
        self.activa: tuple[str, str] | None = None  # (pie, referencia) que se va a marcar
        self._hilo = None
        self.vigilante: escaneo.Vigilante | None = None  # carpeta de escaneos (botón «Escanear»)

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
        self.lay_panel.addWidget(self._grupo_paciente())
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
        self.pila = QStackedWidget()  # 0 = bienvenida / cargando, 1 = visor 3D
        self.pila.addWidget(self._bienvenida())
        self.pila.addWidget(self.visor)
        lv.addWidget(self.pila)
        division = QSplitter(Qt.Horizontal)
        division.addWidget(marco_visor)
        division.addWidget(desplazable)
        division.setStretchFactor(0, 1)
        division.setSizes([1000, 440])
        self.division = division
        contenedor = QWidget()
        lc = QVBoxLayout(contenedor)
        lc.setContentsMargins(10, 10, 6, 6)
        lc.addWidget(division)
        # Dos apartados: Fresado (rectificar el molde y la CNC) y Confección (pedidos de la web).
        from interfaz.confeccion import PanelConfeccion
        self.confeccion = PanelConfeccion(self)
        self.apartados = QStackedWidget()
        self.apartados.addWidget(contenedor)
        self.apartados.addWidget(self.confeccion)
        self.setCentralWidget(self.apartados)
        self.setAcceptDrops(True)
        self.aviso = estilo.Aviso(self)
        self._deshacer: list = []  # estados anteriores (para Ctrl+Z)
        self._rehacer: list = []
        self._estado_arrastre = None
        self._menus()
        self._barra()
        self._reloj_cnc = QTimer(self)
        self._reloj_cnc.setInterval(30_000)
        self._reloj_cnc.timeout.connect(self._cnc_tic)
        self._reloj_cnc.start()
        self._cnc_tic()
        apartado = self.ajustes.value("apartado", "fresado")
        self.botones_apartado["confeccion" if apartado == "confeccion" else "fresado"].setChecked(True)
        self._refrescar_panel()
        self._refrescar_recientes()
        geometria = self.ajustes.value("geometria")
        if geometria is not None:
            self.restoreGeometry(geometria)
        division = self.ajustes.value("division")
        if division is not None:
            self.division.restoreState(division)

    def showEvent(self, evento):
        super().showEvent(evento)
        estilo.barra_titulo_oscura(self)

    def notificar(self, texto: str, tipo: str = "info"):
        """Aviso flotante que se va solo (y queda también en la barra de abajo)."""
        self.aviso.mostrar(texto, tipo)
        self.statusBar().showMessage(texto, 6000)

    # ---------------------------------------------------------------- bienvenida

    def _bienvenida(self) -> QWidget:
        """Lo que se ve antes de abrir un escaneo (y mientras se abre)."""
        hoja = QWidget()
        hoja.setObjectName("bienvenida")
        hoja.setStyleSheet(f"QWidget#bienvenida {{ background: qlineargradient(x1:0, y1:0, x2:0, y2:1, "
                           f"stop:0 {C['visor_arriba']}, stop:1 {C['visor_abajo']}); border-radius: 9px; }}")
        lay = QVBoxLayout(hoja)
        lay.addStretch(1)
        icono = QLabel()
        icono.setPixmap(estilo.icono_app().pixmap(72, 72))
        icono.setAlignment(Qt.AlignCenter)
        lay.addWidget(icono)
        self.texto_bienvenida = QLabel()
        self.texto_bienvenida.setAlignment(Qt.AlignCenter)
        self.texto_bienvenida.setWordWrap(True)
        lay.addWidget(self.texto_bienvenida)
        self.barra_carga = QProgressBar()
        self.barra_carga.setRange(0, 0)  # sin fin: no se sabe cuánto falta
        self.barra_carga.setFixedWidth(320)
        self.barra_carga.setTextVisible(False)
        self.barra_carga.setFixedHeight(6)
        fila = QHBoxLayout()
        fila.addStretch(1)
        fila.addWidget(self.barra_carga)
        fila.addStretch(1)
        lay.addLayout(fila)
        self.boton_abrir_grande = QPushButton("  Abrir escaneo…")
        self.boton_abrir_grande.setIcon(estilo.icono("abrir", "white"))
        estilo.primario(self.boton_abrir_grande)
        self.boton_abrir_grande.setMinimumWidth(240)
        self.boton_abrir_grande.clicked.connect(self.abrir_dialogo)
        self.boton_escanear_grande = QPushButton("  Escanear…")
        self.boton_escanear_grande.setIcon(estilo.icono("escanear"))
        self.boton_escanear_grande.setToolTip("Abre Revo Scan; al exportar el escaneo, se abre aquí solo")
        self.boton_escanear_grande.clicked.connect(self.escanear)
        fila = QHBoxLayout()
        fila.addStretch(1)
        fila.addWidget(self.boton_abrir_grande)
        fila.addWidget(self.boton_escanear_grande)
        fila.addStretch(1)
        lay.addLayout(fila)
        self.caja_recientes = QVBoxLayout()
        self.caja_recientes.setSpacing(4)
        fila = QHBoxLayout()
        fila.addStretch(1)
        fila.addLayout(self.caja_recientes)
        fila.addStretch(1)
        lay.addSpacing(10)
        lay.addLayout(fila)
        lay.addStretch(2)
        self._reloj_carga = QTimer(self)
        self._reloj_carga.setInterval(500)
        self._reloj_carga.timeout.connect(self._texto_carga)
        self._cronometro = QElapsedTimer()
        self._modo_bienvenida(cargando=False)
        return hoja

    def _modo_bienvenida(self, cargando: bool, ruta: str | None = None):
        self._cargando = cargando
        self._ruta_cargando = ruta
        self.barra_carga.setVisible(cargando)
        self.boton_abrir_grande.setVisible(not cargando)
        self.boton_escanear_grande.setVisible(not cargando)
        for i in range(self.caja_recientes.count()):
            w = self.caja_recientes.itemAt(i).widget()
            if w is not None:
                w.setVisible(not cargando)
        if cargando:
            self._cronometro.start()
            self._reloj_carga.start()
            self._texto_carga()
        else:
            self._reloj_carga.stop()
            self.texto_bienvenida.setText(
                f"<p style='font-size:16pt; font-weight:600'>Fresado · rectificar el molde</p>"
                f"<p style='color:{C['secundario']}'>Abre un escaneo del Revopoint (.revox, .stl, .ply, .obj o .zip)"
                f"<br>o <b>arrástralo aquí</b> desde una carpeta.</p>")

    def _texto_carga(self):
        nombre = Path(self._ruta_cargando).name if self._ruta_cargando else ""
        seg = self._cronometro.elapsed() / 1000 if self._cronometro.isValid() else 0
        self.texto_bienvenida.setText(
            f"<p style='font-size:14pt; font-weight:600'>Leyendo y limpiando el escaneo…</p>"
            f"<p style='color:{C['secundario']}'>{nombre}<br>Suele tardar unos 15 segundos · {seg:.0f} s</p>")

    # ---------------------------------------------------------------- recientes

    def _recientes(self) -> list[str]:
        v = self.ajustes.value("recientes", [])
        lista = [v] if isinstance(v, str) else list(v or [])
        return [r for r in lista if Path(r).exists()][:8]

    def _anotar_reciente(self, ruta: str):
        lista = [r for r in self._recientes() if Path(r) != Path(ruta)]
        self.ajustes.setValue("recientes", [str(ruta)] + lista[:7])
        self.ajustes.setValue("carpeta", str(Path(ruta).parent))
        self._refrescar_recientes()

    def _refrescar_recientes(self):
        recientes = self._recientes()
        self.menu_recientes.clear()
        for r in recientes:
            self.menu_recientes.addAction(estilo.icono("reciente"), Path(r).name, lambda r=r: self.abrir(r))
        self.menu_recientes.setEnabled(bool(recientes))
        while self.caja_recientes.count():
            w = self.caja_recientes.takeAt(0).widget()
            if w is not None:
                w.deleteLater()
        if recientes:
            t = estilo.etiqueta("RECIENTES", "titulo_tarjeta", envolver=False)
            t.setAlignment(Qt.AlignCenter)
            self.caja_recientes.addWidget(t)
        for r in recientes[:5]:
            b = QPushButton(Path(r).name)
            b.setIcon(estilo.icono("reciente", C["secundario"]))
            b.setProperty("plano", True)
            b.setToolTip(r)
            b.setMinimumWidth(240)
            b.clicked.connect(lambda _=False, r=r: self.abrir(r))
            self.caja_recientes.addWidget(b)

    # ---------------------------------------------------------------- deshacer

    def _estado(self):
        p = self.proyecto
        return ("estado", p.lijado, [(dict(pie.referencias.puntos), dataclasses.replace(pie.recorte),
                                       piezas_mod.copiar(pie.piezas)) for pie in p.pies])

    def _guardar_estado(self, estado=None, agrupar: str | None = None):
        """Apunta cómo estaba todo antes de un cambio (para poder deshacerlo).

        `agrupar`: cambios seguidos del mismo control (p. ej. pulsar varias veces la flecha de una
        casilla de números) cuentan como uno solo para deshacer."""
        if self.proyecto is None:
            return
        import time

        ahora = time.monotonic()
        if agrupar is not None and agrupar == getattr(self, "_ultimo_grupo", None) and ahora - self._t_grupo < 2.0:
            self._t_grupo = ahora
            return
        self._ultimo_grupo, self._t_grupo = agrupar, ahora
        self._marcar_cambio()
        self._deshacer.append(estado or self._estado())
        del self._deshacer[:-100]
        self._rehacer.clear()
        self._activar_acciones()

    def _poner_estado(self, estado):
        _, lijado, pies = estado
        p = self.proyecto
        p.lijado = lijado
        for pie, (puntos, recorte, piezas) in zip(p.pies, pies):
            pie.referencias.puntos = dict(puntos)
            pie.recorte = dataclasses.replace(recorte)
            pie.piezas = piezas_mod.copiar(piezas)
        self.caja_lijado.blockSignals(True)
        self.caja_lijado.setValue(lijado)
        self.caja_lijado.blockSignals(False)

    def _volver(self, desde: list, hacia: list, texto: str):
        if self.proyecto is None or not desde:
            return
        paso = desde.pop()
        if paso == "lados":
            self.proyecto.intercambiar_lados()
            hacia.append("lados")
        else:
            hacia.append(self._estado())
            self._poner_estado(paso)
        self.activa = None
        self._marcar_cambio()
        self._actualizar_todo()
        self._activar_acciones()
        self.notificar(texto)

    def deshacer(self):
        self._volver(self._deshacer, self._rehacer, "Deshecho el último cambio.")

    def rehacer(self):
        self._volver(self._rehacer, self._deshacer, "Rehecho.")

    # ---------------------------------------------------------------- paciente y guardar

    def _grupo_paciente(self) -> QFrame:
        """Datos del paciente: salen en el trabajo guardado, al exportar, en el mapa y en el .nc."""
        from PySide6.QtCore import QDate
        from PySide6.QtWidgets import QDateEdit, QLineEdit, QPlainTextEdit

        marco, lay, _ = estilo.tarjeta("Paciente")
        self.caja_nombre = QLineEdit()
        self.caja_nombre.setPlaceholderText("Nombre del paciente")
        self.caja_nombre.textEdited.connect(lambda t: self._cambiar_paciente(nombre=t))
        fila = QHBoxLayout()
        fila.addWidget(self.caja_nombre, 1)
        self.caja_fecha = QDateEdit(QDate.currentDate())
        self.caja_fecha.setCalendarPopup(True)
        self.caja_fecha.setDisplayFormat("dd/MM/yyyy")
        self.caja_fecha.dateChanged.connect(lambda d: self._cambiar_paciente(fecha=d.toString("yyyy-MM-dd")))
        fila.addWidget(self.caja_fecha)
        lay.addLayout(fila)
        fila = QHBoxLayout()
        fila.addWidget(estilo.etiqueta("Pedido nº", "secundario", envolver=False))
        self.caja_pedido = QLineEdit()
        self.caja_pedido.setPlaceholderText("nº de caso")
        self.caja_pedido.setToolTip("El nº de caso del pedido en la web de Ortosend. Se lee solo del nombre del\n"
                                    "escaneo («… caso 123»). Sirve para que, al acabar la CNC, sus pedidos pasen a\n"
                                    "confección.")
        from PySide6.QtGui import QIntValidator
        self.caja_pedido.setValidator(QIntValidator(1, 99999999, self.caja_pedido))
        self.caja_pedido.setMaximumWidth(150)
        self.caja_pedido.textEdited.connect(lambda t: self._cambiar_paciente(pedido=int(t) if t.isdigit() else None))
        fila.addWidget(self.caja_pedido)
        self.boton_ver_pedido = QPushButton("📋 Ver pedido")
        self.boton_ver_pedido.setToolTip("La receta (qué hay que hacer), los vídeos y fotos del estudio y el\n"
                                         "cuestionario de este pedido, desde la web de Ortosend")
        self.boton_ver_pedido.clicked.connect(self.ver_pedido)
        self.boton_ver_pedido.setEnabled(False)
        self.caja_pedido.textChanged.connect(
            lambda t: self.boton_ver_pedido.setEnabled(t.isdigit() and self.caja_pedido.isEnabled()))
        fila.addWidget(self.boton_ver_pedido)
        fila.addStretch(1)
        lay.addLayout(fila)
        self.caja_notas = QPlainTextEdit()
        self.caja_notas.setPlaceholderText("Notas (diagnóstico, observaciones…)")
        self.caja_notas.setFixedHeight(54)
        self.caja_notas.textChanged.connect(lambda: self._cambiar_paciente(notas=self.caja_notas.toPlainText()))
        lay.addWidget(self.caja_notas)
        self._cajas_paciente = (self.caja_nombre, self.caja_fecha, self.caja_pedido, self.caja_notas)
        for c in self._cajas_paciente:
            c.setEnabled(False)
        return marco

    def _poner_paciente(self):
        from PySide6.QtCore import QDate

        pac = self.proyecto.paciente
        for c in self._cajas_paciente:
            c.blockSignals(True)
            c.setEnabled(True)
        self.caja_nombre.setText(pac.get("nombre", ""))
        self.caja_nombre.setPlaceholderText(f"Nombre del paciente (si no: {self.proyecto.ruta_stl.stem})")
        fecha = QDate.fromString(pac.get("fecha", ""), "yyyy-MM-dd")
        self.caja_fecha.setDate(fecha if fecha.isValid() else QDate.currentDate())
        self.caja_notas.setPlainText(pac.get("notas", ""))
        self.caja_pedido.setText(str(pac["pedido"]) if pac.get("pedido") else "")
        for c in self._cajas_paciente:
            c.blockSignals(False)
        self.boton_ver_pedido.setEnabled(self.caja_pedido.text().isdigit())

    def _cambiar_paciente(self, **cambios):
        if self.proyecto is None:
            return
        self.proyecto.paciente.update(cambios)
        self._marcar_cambio()

    def _marcar_cambio(self, hay: bool = True):
        self.cambios_sin_guardar = hay
        nombre = ""
        if self.proyecto is not None:
            nombre = (self.proyecto.paciente or {}).get("nombre") or (
                self.ruta_trabajo.stem if self.ruta_trabajo else self.proyecto.ruta_stl.name)
        self.setWindowTitle(f"{nombre} [*] – Ortosend Taller" if nombre else "Ortosend Taller")
        self.setWindowModified(hay)

    def _puede_descartar(self) -> bool:
        """Si hay cambios sin guardar, pregunta qué hacer. True = se puede seguir."""
        import os

        if self.proyecto is None or not self.cambios_sin_guardar or os.environ.get("RECTIFICADOR_SIN_PREGUNTAR"):
            return True
        caja = QMessageBox(self)
        caja.setIcon(QMessageBox.Question)
        caja.setWindowTitle("Cambios sin guardar")
        caja.setText("<b>Hay cambios sin guardar en este molde.</b>")
        caja.setInformativeText("¿Quieres guardar el trabajo antes de seguir?")
        guardar = caja.addButton("Guardar", QMessageBox.AcceptRole)
        caja.addButton("No guardar", QMessageBox.DestructiveRole)
        cancelar = caja.addButton("Cancelar", QMessageBox.RejectRole)
        caja.setDefaultButton(guardar)
        caja.exec()
        if caja.clickedButton() is cancelar:
            return False
        if caja.clickedButton() is guardar:
            return self.guardar()
        return True

    def guardar(self) -> bool:
        if self.proyecto is None:
            return False
        if self.ruta_trabajo is None:
            return self.guardar_como()
        return self._guardar_en(self.ruta_trabajo)

    def guardar_como(self) -> bool:
        if self.proyecto is None:
            return False
        carpeta = Path(str(self.ajustes.value("carpeta_trabajos", self.ajustes.value("carpeta", ""))))
        ruta, _ = QFileDialog.getSaveFileName(self, "Guardar trabajo", str(carpeta / (nombre_para_archivos(self.proyecto)
                                                                                    + trabajo_mod.EXTENSION)),
                                              "Trabajo del rectificador (*.molde)")
        if not ruta:
            return False
        return self._guardar_en(Path(ruta))

    def _guardar_en(self, ruta: Path) -> bool:
        try:
            ruta = trabajo_mod.guardar(self.proyecto, ruta)
        except OSError as e:
            QMessageBox.critical(self, "No se ha podido guardar", str(e))
            return False
        self.ruta_trabajo = ruta
        self.ajustes.setValue("carpeta_trabajos", str(ruta.parent))
        self._anotar_reciente(str(ruta))
        self._marcar_cambio(False)
        self.notificar(f"Trabajo guardado: {ruta.name}", "bien")
        return True

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
            if not self.proyecto.ruta_stl.exists():
                self.notificar("No encuentro el escaneo original de este trabajo: el tipo se usará en el próximo.",
                               "aviso")
                return
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
        self.ver_fresa = QCheckBox(f"Ver dónde no llega la fresa (bola Ø{self.taller['fresa']['diametro']:g})")
        self.ver_fresa.setToolTip("Pinta en rojo la escayola que la fresa de bola no podrá quitar\n"
                                  "(huecos más estrechos que la bola). Espuma = 0 · rojo = 2 mm o más.")
        self.ver_fresa.toggled.connect(lambda _: self._actualizar_todo() if self.proyecto else None)
        lay.addWidget(self.ver_fresa)
        self.texto_fresa = estilo.etiqueta("", "nota")
        self.texto_fresa.hide()
        lay.addWidget(self.texto_fresa)
        self.ver_cambios = QCheckBox("Ver las correcciones en color")
        self.ver_cambios.setChecked(self.ajustes.value("ver_cambios", True) in (True, "true"))
        self.ver_cambios.setToolTip("Pinta el molde según lo que cambian las correcciones.")
        self.ver_cambios.toggled.connect(lambda v: (self.ajustes.setValue("ver_cambios", v),
                                                    self._mostrar_molde(reiniciar_camara=False) if self.proyecto
                                                    else None))
        lay.addWidget(self.ver_cambios)
        self.leyenda_cambios = estilo.etiqueta(
            "<span style='color:#4dabf7'>■</span> se quita escayola (bulto en la plantilla) · "
            "<span style='color:#ff6b6b'>■</span> se añade (hueco en la plantilla). Más intenso = más mm.", "nota")
        self.leyenda_cambios.hide()
        lay.addWidget(self.leyenda_cambios)
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
        self._guardar_estado()
        QApplication.setOverrideCursor(Qt.WaitCursor)
        self.proyecto.lijado = float(valor)
        self.ver_original.setChecked(False)
        try:
            self._actualizar_todo()
        finally:
            QApplication.restoreOverrideCursor()

    def _mostrar_molde(self, reiniciar_camara: bool):
        p = self.proyecto
        campo = p.original if self.ver_original.isChecked() else p.calcular()
        colores = None
        if self.ver_fresa.isChecked():
            from ortomolde import cnc

            colores, r = cnc.no_llega_en_molde(campo.z, p.fondo_molde, [q.mascara for q in p.pies],
                                               self.taller["fresa"]["diametro"] / 2, campo.rejilla.dx)
            if r["planta_max"] < 0.3:
                texto = "En la planta la fresa llega a todo. "
            else:
                texto = (f"<b>En la planta quedan hasta {r['planta_max']:.1f} mm</b> sin quitar "
                         f"({r['planta_mm2'] / 100:.1f} cm²). ")
            texto += (f"En el borde del pie, hasta {r['borde_max']:.1f} mm (donde la planta se junta con la base)."
                      if r["borde_max"] >= 0.3 else "En el borde, nada importante.")
            self.texto_fresa.setText(texto)
        self.texto_fresa.setVisible(colores is not None)
        pintura = "no_llega"
        cambio = getattr(p, "cambio_correcciones", None)
        if (colores is None and self.ver_cambios.isChecked() and not self.ver_original.isChecked()
                and cambio is not None and np.abs(cambio).max() > 0.05):
            colores, pintura = cambio, "correcciones"
        self.leyenda_cambios.setVisible(pintura == "correcciones")
        self.visor.mostrar_molde(campo, reiniciar_camara=reiniciar_camara, colores=colores, pintura=pintura)

    def _menus(self):
        self.acciones = {}

        def accion(clave, texto, funcion, atajo=None, ic=None, menu=None):
            a = QAction(texto, self)
            if atajo is not None:
                a.setShortcuts(atajo if isinstance(atajo, list) else [atajo])
            a.triggered.connect(funcion)
            if ic:
                a.setIcon(estilo.icono(ic))
            if menu is not None:
                menu.addAction(a)
            self.acciones[clave] = a
            return a

        archivo = self.menuBar().addMenu("&Archivo")
        accion("abrir", "Abrir escaneo…", self.abrir_dialogo, QKeySequence.Open, "abrir", archivo)
        accion("escanear", "Escanear con Revo Scan…", self.escanear, None, "escanear", archivo)
        accion("carpeta_escaneos", "Carpeta de escaneos…", self.elegir_carpeta_escaneos, None, None, archivo)
        self.menu_recientes = archivo.addMenu(estilo.icono("reciente"), "Abrir reciente")
        archivo.addSeparator()
        accion("guardar", "Guardar trabajo", self.guardar, QKeySequence.Save, "guardar", archivo)
        accion("guardar_como", "Guardar trabajo como…", self.guardar_como, QKeySequence("Ctrl+Shift+S"), None, archivo)
        archivo.addSeparator()
        accion("exportar", "Exportar molde (STL para Fusion)…", self.exportar, QKeySequence("Ctrl+E"), "exportar",
               archivo)
        archivo.addSeparator()
        accion("anadir", "Añadir este molde a la tirada de CNC", self.anadir_a_tirada, QKeySequence("Ctrl+T"),
               "anadir", archivo)
        accion("tirada", "Tirada de CNC (varios moldes en una plancha)…", self.abrir_tirada,
               QKeySequence("Ctrl+Shift+T"), "cnc", archivo)
        accion("ajustes_cnc", "Ajustes de la CNC (velocidades y pasadas)…", self.ajustes_cnc, None, None, archivo)
        accion("ir_fresado", "Ir a Fresado", lambda: self.ir_a("fresado"), QKeySequence("Ctrl+Shift+F"), "cnc", archivo)
        accion("confeccion", "Ir a Confección (pedidos del taller)", self.abrir_confeccion,
               QKeySequence("Ctrl+Shift+C"), "confeccion", archivo)
        archivo.addSeparator()
        accion("salir", "Salir", self.close, QKeySequence.Quit, None, archivo)

        edicion = self.menuBar().addMenu("&Edición")
        accion("deshacer", "Deshacer", self.deshacer, QKeySequence.Undo, "deshacer", edicion)
        accion("rehacer", "Rehacer", self.rehacer, [QKeySequence("Ctrl+Y"), QKeySequence("Ctrl+Shift+Z")],
               "rehacer", edicion)
        edicion.addSeparator()
        accion("lados", "Intercambiar pie izquierdo ↔ derecho", self.intercambiar_lados, None, "lados", edicion)
        accion("medir_menu", "Medir distancia", lambda: self.boton_medir.toggle(), None, "medir", edicion)

        ver = self.menuBar().addMenu("&Ver")
        accion("inicial", "Vista inicial", lambda: self.visor.vista_inicial(), QKeySequence("Ctrl+1"), "vista", ver)
        accion("planta", "Vista de planta (desde arriba)", lambda: self.visor.vista_planta(), QKeySequence("Ctrl+2"),
               "planta", ver)
        ver.addSeparator()
        reglas = QAction("Mostrar reglas en mm", self)
        reglas.setCheckable(True)
        reglas.setChecked(True)
        reglas.toggled.connect(self.visor.mostrar_reglas)
        ver.addAction(reglas)
        original = QAction("Ver el escaneo sin lijar", self)
        original.setCheckable(True)
        original.toggled.connect(self.ver_original.setChecked)
        self.ver_original.toggled.connect(original.setChecked)
        ver.addAction(original)
        self.accion_nombres = QAction("Nombres de las referencias", self)
        self.accion_nombres.setCheckable(True)
        self.accion_nombres.setShortcut(QKeySequence("N"))
        self.accion_nombres.setToolTip("Si no, los nombres solo salen mientras se marcan las referencias")
        self.accion_nombres.setChecked(self.ajustes.value("ver_nombres", False) in (True, "true"))
        self.accion_nombres.toggled.connect(lambda v: (self.ajustes.setValue("ver_nombres", v),
                                                       self._redibujar_pies() if self.proyecto else None))
        ver.addAction(self.accion_nombres)
        cambios = QAction("Correcciones en color", self)
        cambios.setCheckable(True)
        cambios.setChecked(self.ver_cambios.isChecked())
        cambios.toggled.connect(self.ver_cambios.setChecked)
        self.ver_cambios.toggled.connect(cambios.setChecked)
        ver.addAction(cambios)

        ayuda = self.menuBar().addMenu("A&yuda")
        accion("guia", "Guía rápida", self.guia_rapida, QKeySequence.HelpContents, "ayuda", ayuda)
        accion("atajos", "Atajos de teclado y ratón", self.ver_atajos, None, "teclado", ayuda)
        ayuda.addSeparator()
        accion("novedades", "Novedades", self.ver_novedades, None, "info", ayuda)
        accion("actualizar", "Buscar actualizaciones…", lambda: self.buscar_actualizaciones(), None, "reciente", ayuda)
        ayuda.addSeparator()
        accion("acerca", "Acerca del rectificador", self.acerca_de, None, "info", ayuda)

    # ---------------------------------------------------------------- ayuda

    def _dialogo_texto(self, titulo: str, html: str):
        d = QDialog(self)
        d.setWindowTitle(titulo)
        d.resize(620, 560)
        lay = QVBoxLayout(d)
        lay.setContentsMargins(20, 18, 20, 16)
        texto = QLabel(html)
        texto.setWordWrap(True)
        texto.setTextFormat(Qt.RichText)
        texto.setAlignment(Qt.AlignTop | Qt.AlignLeft)
        desplazable = QScrollArea()
        desplazable.setWidget(texto)
        desplazable.setWidgetResizable(True)
        lay.addWidget(desplazable, 1)
        cerrar = QPushButton("Cerrar")
        estilo.primario(cerrar)
        cerrar.clicked.connect(d.accept)
        fila = QHBoxLayout()
        fila.addStretch(1)
        fila.addWidget(cerrar)
        lay.addLayout(fila)
        estilo.barra_titulo_oscura(d)
        d.exec()

    def guia_rapida(self):
        s = C["secundario"]
        self._dialogo_texto("Guía rápida", f"""
<h2>Guía rápida</h2>
<h3>1 · Abrir el escaneo</h3>
<p>Botón <b>Abrir</b> (o arrastra el archivo a la ventana). Vale el proyecto de Revo Scan (<b>.revox</b>),
un <b>.stl/.ply/.obj</b> o un <b>.zip</b>. Elige antes qué se ha escaneado: <b>Huellas en espuma</b> o
<b>Molde ya hecho</b>. Comprueba que cada pie tiene bien su nombre; si no, <b>Intercambiar izquierdo ↔ derecho</b>.</p>
<h3>2 · Molde</h3>
<p><b>Lijado</b>: quita imperfecciones conservando la forma (más grande = lija ondulaciones más anchas).
<b>Medir</b> (tecla M): dos clics derechos sobre el molde y te dice la distancia en mm.</p>
<h3>3 · Referencias de cada pie</h3>
<p><b>Proponer referencias</b> coloca las 5 cabezas metatarsales y el talón. Si alguna no está bien,
<b>cógela con el botón izquierdo y arrástrala</b>. El molde se recorta en arco por delante de las cabezas
(línea roja); cambia <b>Adelanto</b> y <b>Curvatura</b> si hace falta.</p>
<h3>4 · Exportar o fresar</h3>
<p><b>Exportar</b> guarda el molde. <b>Añadir a la tirada</b> lo manda a la ventana de la CNC, donde colocas
varios moldes en una plancha (arrastrándolos), calculas y guardas el <b>.nc</b> con su mapa para imprimir.</p>
<p style='color:{s}'>¿Te has equivocado? <b>Ctrl+Z</b> deshace el último cambio (y Ctrl+Y lo rehace).</p>
""")

    def ver_atajos(self):
        filas = [("Ctrl+O", "Abrir escaneo"), ("Ctrl+E", "Exportar molde"), ("Ctrl+T", "Añadir a la tirada de CNC"),
                 ("Ctrl+Shift+T", "Abrir la tirada de CNC"), ("Ctrl+Z / Ctrl+Y", "Deshacer / rehacer"),
                 ("M", "Medir distancia (Esc para quitarla)"), ("Ctrl+1 / Ctrl+2", "Vista inicial / desde arriba"),
                 ("F1", "Guía rápida"),
                 ("Arrastrar (botón izq.)", "Girar la vista · o mover un punto si lo coges"),
                 ("Mayús + arrastrar", "Desplazar la vista"), ("Rueda", "Zoom"),
                 ("Clic derecho", "Marcar una referencia o un punto de medida")]
        tabla = "".join(f"<tr><td style='padding:5px 14px 5px 0'><b>{a}</b></td><td>{b}</td></tr>" for a, b in filas)
        self._dialogo_texto("Atajos", f"<h2>Atajos de teclado y ratón</h2><table>{tabla}</table>")

    def buscar_actualizaciones(self, silencio: bool = False):
        """Mira si hay una versión nueva publicada. Con `silencio` (al abrir el programa) va en segundo plano
        y solo dice algo si la hay (y no se ha dejado para «más tarde» hoy)."""
        import threading

        def preguntar():
            base = actualizar.base_publicada()
            nueva = actualizar.version_publicada(base=base) or ""
            notas = actualizar.novedades_publicadas(base=base) if nueva else ""
            self._aviso_version.emit(nueva, notas, silencio)  # la respuesta llega a la ventana (hilo principal)

        # Siempre en segundo plano: la ventana no se queda «pensando» mientras se mira en internet.
        if not silencio:
            self.acciones["actualizar"].setEnabled(False)
            self.statusBar().showMessage("Buscando actualizaciones…")
        threading.Thread(target=preguntar, daemon=True).start()

    def _resultado_version(self, nueva: str, notas: str, silencio: bool):
        from datetime import date

        from ortomolde import __version__

        if not silencio:
            self.acciones["actualizar"].setEnabled(True)
            self.statusBar().clearMessage()
        if not nueva:
            if not silencio:
                QMessageBox.information(self, "Actualizaciones", "No he podido comprobarlo (¿hay internet?).")
            return
        if actualizar.version(nueva) <= actualizar.version(__version__):
            if not silencio:
                QMessageBox.information(self, "Actualizaciones", f"Tienes la última versión ({__version__}).")
            return
        if silencio and self.ajustes.value("actualizacion_pospuesta", "") == f"{date.today().isoformat()}:{nueva}":
            return
        self._dialogo_actualizar(nueva, actualizar.novedades(notas, __version__))

    def _dialogo_actualizar(self, nueva: str, notas: str):
        """«Hay una versión nueva»: novedades y, con un clic, descargar, instalar y reiniciar."""
        from datetime import date

        from PySide6.QtCore import QUrl
        from PySide6.QtGui import QDesktopServices

        from ortomolde import __version__

        base = actualizar.base_instalada()
        d = QDialog(self)
        d.setWindowTitle("Hay una versión nueva")
        d.resize(560, 480)
        lay = QVBoxLayout(d)
        lay.setContentsMargins(20, 18, 20, 16)
        lay.addWidget(estilo.etiqueta(f"<span style='font-size:14pt; font-weight:600'>Versión {nueva}</span>"
                                      f"<br><span style='color:{C['secundario']}'>Tienes la {__version__}. "
                                      "Tus trabajos guardados no se tocan.</span>"))
        texto = QLabel(notas or "Mejoras y correcciones.")
        texto.setTextFormat(Qt.MarkdownText)
        texto.setWordWrap(True)
        texto.setAlignment(Qt.AlignTop | Qt.AlignLeft)
        desplazable = QScrollArea()
        desplazable.setWidget(texto)
        desplazable.setWidgetResizable(True)
        lay.addWidget(desplazable, 1)
        barra = QProgressBar()
        barra.setTextVisible(False)
        barra.setFixedHeight(6)
        barra.hide()
        lay.addWidget(barra)
        estado = estilo.etiqueta("", "nota")
        lay.addWidget(estado)
        fila = QHBoxLayout()
        fila.addStretch(1)
        luego = QPushButton("Más tarde")
        fila.addWidget(luego)
        ahora = QPushButton("Actualizar ahora" if base else "Descargar…")
        ahora.setIcon(estilo.icono("exportar", "white"))
        estilo.primario(ahora)
        fila.addWidget(ahora)
        lay.addLayout(fila)

        def mas_tarde():
            self.ajustes.setValue("actualizacion_pospuesta", f"{date.today().isoformat()}:{nueva}")
            d.reject()

        luego.clicked.connect(mas_tarde)

        if base is None:
            # No está instalado con instalar.bat: descarga manual, como antes.
            estado.setText("Al terminar la descarga: descomprime el ZIP, entra en la carpeta «rectificador» y haz "
                           "doble clic en «instalar.bat». Desde entonces se actualizará solo.")

            def descargar_zip():
                QDesktopServices.openUrl(QUrl(actualizar.URL_DESCARGA))
                d.accept()

            ahora.clicked.connect(descargar_zip)
            estilo.barra_titulo_oscura(d)
            d.exec()
            return

        puente = _Puente()

        def empezar():
            if not self._puede_descartar():
                return
            ahora.setEnabled(False)
            luego.setEnabled(False)
            barra.show()
            barra.setRange(0, 0)
            estado.setText("Descargando la versión nueva…")
            import threading

            def trabajo():
                try:
                    actualizar.obtener(base, nueva, lambda b, t: puente.progreso.emit(b, t))
                    puente.terminado.emit("")
                except Exception as e:  # noqa: BLE001 - se le dice al usuario
                    traceback.print_exc()
                    puente.terminado.emit(actualizar.explicar(e))

            threading.Thread(target=trabajo, daemon=True).start()

        def progreso(bajado, total):
            if total:
                barra.setRange(0, total)
                barra.setValue(bajado)
            estado.setText(f"Descargando la versión nueva… {bajado / 1e6:.1f} MB")

        def terminado(error: str):
            if error:
                barra.hide()
                ahora.setEnabled(True)
                luego.setEnabled(True)
                estado.setText(f"<span style='color:{C['mal']}'>No se ha podido actualizar: {html.escape(error)}. "
                               "Sigue funcionando la versión que tienes. Puedes volver a probar.</span>")
                return
            estado.setText("Listo. El programa se cierra y se vuelve a abrir solo con la versión nueva…")
            QApplication.processEvents()
            try:
                actualizar.lanzar_cambio(base, nueva)
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                terminado(actualizar.explicar(e))
                return
            self.cambios_sin_guardar = False  # ya se ha preguntado
            d.accept()
            QTimer.singleShot(300, QApplication.quit)

        puente.progreso.connect(progreso)
        puente.estado.connect(estado.setText)
        puente.terminado.connect(terminado)
        ahora.clicked.connect(empezar)
        self._puente_actualizacion = puente  # que no se borre mientras dura
        estilo.barra_titulo_oscura(d)
        d.exec()

    def ver_novedades(self):
        """Lo que ha cambiado en cada versión (NOVEDADES.md)."""
        ruta = Path(__file__).resolve().parent.parent / "NOVEDADES.md"
        texto = ruta.read_text(encoding="utf-8") if ruta.exists() else "Sin novedades."
        d = QDialog(self)
        d.setWindowTitle("Novedades")
        d.resize(620, 560)
        lay = QVBoxLayout(d)
        lay.setContentsMargins(20, 18, 20, 16)
        etiqueta = QLabel(texto)
        etiqueta.setTextFormat(Qt.MarkdownText)
        etiqueta.setWordWrap(True)
        etiqueta.setAlignment(Qt.AlignTop | Qt.AlignLeft)
        desplazable = QScrollArea()
        desplazable.setWidget(etiqueta)
        desplazable.setWidgetResizable(True)
        lay.addWidget(desplazable, 1)
        cerrar = QPushButton("Cerrar")
        estilo.primario(cerrar)
        cerrar.clicked.connect(d.accept)
        fila = QHBoxLayout()
        fila.addStretch(1)
        fila.addWidget(cerrar)
        lay.addLayout(fila)
        estilo.barra_titulo_oscura(d)
        d.exec()

    def acerca_de(self):
        self._dialogo_texto("Acerca de", f"""
<h2>Ortosend Taller</h2>
<p style='color:{C["secundario"]}'>Versión {__import__("ortomolde").__version__}</p>
<p>Limpia el escaneo del Revopoint, lija el molde, marca las referencias del pie, recorta en arco por
delante de las cabezas metatarsales y genera el archivo para la CNC.</p>
<p style='color:{C["secundario"]}'>Datos del taller: <code>config/taller.toml</code> ·
valores clínicos: <code>config/valores_clinicos.toml</code></p>""")

    def _barra(self):
        """Barra de herramientas de arriba: lo que más se usa, con icono y texto."""
        barra = QToolBar("Herramientas")
        barra.setMovable(False)
        barra.setIconSize(estilo.TAM_ICONO)
        barra.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        # Barra de arriba de todo: nombre, apartados (Fresado | Confección) y el reloj de la CNC.
        cabecera = QToolBar("Apartados")
        cabecera.setMovable(False)
        titulo = QLabel("  Ortosend Taller  ")
        titulo.setObjectName("titulo_app")
        cabecera.addWidget(titulo)
        grupo = QButtonGroup(self)
        self.botones_apartado = {}
        for clave, texto, ic, lado in (("fresado", "Fresado", "cnc", "izq"), ("confeccion", "Confección", "confeccion", "der")):
            b = QPushButton(f" {texto}")
            b.setIcon(estilo.icono(ic))
            b.setCheckable(True)
            b.setProperty("segmento", lado)
            b.setMinimumWidth(130)
            b.setToolTip("Rectificar el molde, tirada y CNC" if clave == "fresado" else "Pedidos del taller y hoja de confección")
            b.toggled.connect(lambda v, c=clave: v and self.ir_a(c))
            grupo.addButton(b)
            cabecera.addWidget(b)
            self.botones_apartado[clave] = b
        relleno = QWidget()
        relleno.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        cabecera.addWidget(relleno)
        self.boton_cnc = QToolButton()
        self.boton_cnc.setPopupMode(QToolButton.InstantPopup)
        self.boton_cnc.setToolButtonStyle(Qt.ToolButtonTextOnly)
        menu = QMenu(self.boton_cnc)
        menu.addAction("Quitar el aviso de la CNC", self.cnc_parar)
        self.boton_cnc.setMenu(menu)
        # (Un botón dentro de una barra se enseña y se esconde con su acción, no con show/hide.)
        self.accion_cnc = cabecera.addWidget(self.boton_cnc)
        self.accion_cnc.setVisible(False)
        self.addToolBar(Qt.TopToolBarArea, cabecera)
        self.addToolBarBreak(Qt.TopToolBarArea)
        self.cabecera = cabecera
        cortos = {"abrir": "Abrir", "escanear": "Escanear", "guardar": "Guardar", "exportar": "Exportar", "anadir": "Añadir a la tirada",
                  "tirada": "Tirada CNC",
                  "inicial": "Vista inicial", "planta": "Desde arriba"}
        cortos.update({"deshacer": "", "rehacer": ""})
        for clave in ("abrir", "escanear", "guardar", "exportar", "anadir", "tirada", None, "deshacer", "rehacer", None, "inicial",
                      "planta"):
            if clave is None:
                barra.addSeparator()
                continue
            a = self.acciones[clave]
            if cortos[clave]:
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
        acciones = getattr(self, "acciones", {})
        for clave in ("guardar", "guardar_como", "exportar", "anadir", "inicial", "planta", "lados", "medir_menu"):
            if clave in acciones:
                acciones[clave].setEnabled(hay)
        if "deshacer" in acciones:
            acciones["deshacer"].setEnabled(hay and bool(self._deshacer))
            acciones["rehacer"].setEnabled(hay and bool(self._rehacer))

    # ---------------------------------------------------------------- abrir

    def abrir_dialogo(self):
        ruta, _ = QFileDialog.getOpenFileName(
            self, "Abrir escaneo o trabajo guardado", str(self.ajustes.value("carpeta", "")),
            "Escaneos y trabajos (*.stl *.ply *.obj *.revox *.zip *.molde);;Trabajos guardados (*.molde);;"
            "Proyecto de Revo Scan (*.revox);;Mallas (*.stl *.ply *.obj);;ZIP (*.zip);;Todos los archivos (*.*)")
        if ruta:
            self.abrir(ruta)

    # ---------------------------------------------------------------- escanear con Revo Scan

    def carpeta_escaneos(self) -> Path:
        return Path(self.ajustes.value("carpeta_escaneos", "") or escaneo.carpeta_por_defecto())

    def vigilar_escaneos(self):
        """Empieza a mirar la carpeta de escaneos (desde que se usa «Escanear» por primera vez)."""
        carpeta = self.carpeta_escaneos()
        if self.vigilante is not None and self.vigilante.carpeta == carpeta:
            return
        if self.vigilante is not None:
            self.vigilante.deleteLater()  # se ha cambiado de carpeta
        try:
            self.vigilante = escaneo.Vigilante(carpeta, self)
        except OSError:
            self.vigilante = None
            return
        self.vigilante.nuevo.connect(self._escaneo_nuevo)
        self.ajustes.setValue("vigilar_escaneos", True)

    def elegir_carpeta_escaneos(self):
        carpeta = QFileDialog.getExistingDirectory(self, "Carpeta donde se exportan los escaneos de Revo Scan",
                                                   str(self.carpeta_escaneos()))
        if carpeta:
            self.ajustes.setValue("carpeta_escaneos", carpeta)
            self.vigilar_escaneos()
            self.notificar(f"Los escaneos que se exporten en {carpeta} se abrirán aquí solos.", "bien")

    def escanear(self):
        """Abre Revo Scan y explica dónde exportar: el escaneo exportado se abre aquí solo."""
        self.vigilar_escaneos()
        carpeta = self.carpeta_escaneos()
        exe = Path(self.ajustes.value("revo_scan", "") or "")
        if not exe.is_file():
            exe = escaneo.buscar_revo_scan()
        if exe is None or not exe.is_file():
            elegido, _ = QFileDialog.getOpenFileName(
                self, "¿Dónde está Revo Scan? (el programa del escáner, Revo Scan.exe)",
                os.environ.get("ProgramFiles", ""), "Programas (*.exe)")
            if not elegido:
                return
            exe = Path(elegido)
        try:
            escaneo.abrir_revo_scan(exe)
        except OSError as e:
            self.ajustes.remove("revo_scan")
            QMessageBox.warning(self, "No se ha podido abrir Revo Scan", f"{exe}\n\n{e}")
            return
        self.ajustes.setValue("revo_scan", str(exe))
        QApplication.clipboard().setText(str(carpeta))
        QMessageBox.information(
            self, "Escanear",
            "Se está abriendo Revo Scan. Escanea el molde y, al terminar, <b>exporta el STL</b> (o PLY) en esta "
            f"carpeta:<br><br><b>{html.escape(str(carpeta))}</b><br><br>(La ruta ya está copiada: en la ventana de "
            "guardar de Revo Scan pégala con Ctrl+V.) En cuanto termine de guardarse, el escaneo se abre aquí."
            "<br><br>Para usar otra carpeta: <i>Archivo → Carpeta de escaneos…</i>")

    def _escaneo_nuevo(self, ruta: str):
        self.raise_()
        self.activateWindow()
        r = QMessageBox.question(self, "Escaneo nuevo", f"Ha llegado un escaneo nuevo:\n{Path(ruta).name}\n\n¿Abrirlo?",
                                 QMessageBox.Yes | QMessageBox.No, QMessageBox.Yes)
        if r == QMessageBox.Yes:
            self.abrir(ruta)

    def abrir(self, ruta: str, esperar: bool = False, preguntar: bool = True):
        """Abre el escaneo (o un trabajo .molde) en segundo plano. Con `esperar` (pruebas) lo hace en este hilo."""
        if preguntar and not self._puede_descartar():
            return
        self._peticion += 1
        if esperar:
            self._cargado(self._peticion, abrir_proyecto(ruta, self.modo))
            return
        self._modo_bienvenida(cargando=True, ruta=ruta)
        self.pila.setCurrentIndex(0)
        hilo = QThread(self)
        cargador = Cargador(ruta, self.modo, self._peticion)
        cargador.moveToThread(hilo)
        hilo.started.connect(cargador.trabajar)
        cargador.terminado.connect(self._cargado)
        cargador.fallo.connect(self._fallo)
        hilo.finished.connect(lambda h=hilo, c=cargador: self._hilos.remove((h, c)) if (h, c) in self._hilos else None)
        self._hilos.append((hilo, cargador))
        self._hilo = hilo
        hilo.start()

    def _cargado(self, peticion: int, proyecto: Proyecto):
        if peticion != self._peticion:
            return  # resultado de una apertura anterior que ha llegado tarde
        self._modo_bienvenida(cargando=False)
        self.pila.setCurrentIndex(1)
        self.proyecto = proyecto
        self.activa = None
        self._deshacer.clear()
        self._rehacer.clear()
        self.ruta_trabajo = getattr(proyecto, "ruta_trabajo", None)
        if not proyecto.paciente:
            proyecto.paciente = trabajo_mod.paciente_vacio()
        if not proyecto.paciente.get("pedido"):
            pedido = trabajo_mod.pedido_de_ruta(proyecto.ruta_stl)
            if pedido:
                proyecto.paciente["pedido"] = pedido
        self._anotar_reciente(str(self.ruta_trabajo or proyecto.ruta_stl))
        self._poner_paciente()
        self._marcar_cambio(False)
        self.caja_lijado.blockSignals(True)
        self.caja_lijado.setValue(proyecto.lijado)
        self.caja_lijado.blockSignals(False)
        with self.visor.lote():
            self._mostrar_molde(reiniciar_camara=True)
            self._redibujar_pies()
        self._refrescar_panel()

    def _fallo(self, peticion: int, mensaje: str):
        if peticion != self._peticion:
            return
        self._modo_bienvenida(cargando=False)
        if self.proyecto is not None:
            self.pila.setCurrentIndex(1)
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
            self.notificar("Ese punto no está sobre ningún pie.", "aviso")
            return
        nombre = None
        if self.activa and self.activa[0] == self._clave(pie):
            nombre = self.activa[1]
        antes = self._estado()
        hecho = self.proyecto.poner_referencia(x, y, nombre)
        if hecho:
            self._guardar_estado(antes)
            _, nombre = hecho
            self.notificar(f"{pie.nombre}: marcada {NOMBRES[nombre]}.", "bien")
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
        if not self.proyecto:
            return
        if self._estado_arrastre is None:
            self._estado_arrastre = self._estado()  # cómo estaba antes de empezar a arrastrar
        if nombre.startswith("pieza:"):
            tipo = nombre.split(":", 1)[1]
            if self._mover_pieza(clave, tipo, x, y):
                pie = self.proyecto.pies[int(clave[1])]
                r = self.proyecto.original.rejilla
                contorno = piezas_mod.contorno(pie.piezas[tipo], pie.referencias, pie.mascara, r.dx, r.dy,
                                               self.proyecto.clinicos["referencias"], recorte=pie.recorte)
                with self.visor.lote():
                    self.visor.mover_punto(clave, nombre, x, y)
                    self.visor.dibujar_contorno_pieza(clave, tipo, piezas_mod.COLORES[tipo], contorno)
            return
        if not self._mover_referencia(clave, nombre, x, y):
            return
        pie = self.proyecto.pies[int(clave[1])]
        try:
            geom = self.proyecto.geometria(pie)
            recorte = self.proyecto.linea_recorte(pie)
        except ValueError:
            geom, recorte = None, None
        if geom and pie.piezas.get("arco") is not None and pie.piezas["arco"].activa:
            geom = {**geom, "zona_arco": None}
        with self.visor.lote():
            self.visor.mover_punto(clave, nombre, x, y)
            self.visor.dibujar_lineas(clave, geom, recorte)

    def soltar_referencia(self, clave: str, nombre: str, x: float, y: float):
        if not self.proyecto:
            return
        self._guardar_estado(self._estado_arrastre)
        self._estado_arrastre = None
        pie = self.proyecto.pies[int(clave[1])]
        if nombre.startswith("pieza:"):
            tipo = nombre.split(":", 1)[1]
            self._mover_pieza(clave, tipo, x, y)
            self._actualizar_todo()
            self.notificar(f"{pie.nombre}: {piezas_mod.NOMBRES[tipo]} movida (Ctrl+Z para deshacer).")
            return
        self._mover_referencia(clave, nombre, x, y)
        self.notificar(f"{pie.nombre}: {NOMBRES[nombre]} movida (Ctrl+Z para deshacer).")
        self._actualizar_todo()

    def proponer_referencias(self, clave: str):
        if not self.proyecto:
            return
        self._guardar_estado()
        self.proyecto.proponer_referencias(self.proyecto.pies[int(clave[1])])
        self._actualizar_todo()

    def cambiar_recorte(self, clave: str, **cambios):
        if not self.proyecto:
            return
        r = self.proyecto.pies[int(clave[1])].recorte
        self._guardar_estado(agrupar=f"recorte:{clave}:{','.join(cambios)}")
        for k, v in cambios.items():
            setattr(r, k, v)
        self._actualizar_todo()

    def cambiar_pieza(self, clave: str, tipo: str, **cambios):
        """Activa, desactiva o ajusta una corrección (relleno de arco, oliva...) de un pie."""
        if not self.proyecto:
            return
        pieza = self.proyecto.pies[int(clave[1])].piezas[tipo]
        if all(getattr(pieza, k) == v for k, v in cambios.items()):
            return
        self._guardar_estado(agrupar=f"pieza:{clave}:{tipo}:{','.join(cambios)}")
        for k, v in cambios.items():
            setattr(pieza, k, v)
        self._actualizar_todo()
        if cambios.get("activa"):
            self.notificar(f"{pieza.nombre} puesta. Arrastra su cuadradito en el 3D para moverla.", "bien")

    def _actualizar_todo(self):
        """Recalcula el molde y redibuja todo (tras cualquier cambio), con un solo redibujo."""
        with self.visor.lote():
            self._mostrar_molde(reiniciar_camara=False)
            self._redibujar_pies()
        self._refrescar_panel()

    def borrar_referencias(self, clave: str):
        if not self.proyecto:
            return
        pie = self.proyecto.pies[int(clave[1])]
        self._guardar_estado()
        pie.referencias.puntos.clear()
        self._actualizar_todo()

    def intercambiar_lados(self):
        if not self.proyecto:
            return
        self._guardar_estado("lados")
        self.proyecto.intercambiar_lados()
        self._actualizar_todo()

    def _redibujar_pies(self):
        for clave in ("p0", "p1"):
            self.visor.borrar_pie(clave)
        for pie in self.proyecto.pies:
            try:
                geom = self.proyecto.geometria(pie)
            except ValueError as e:
                geom = None
                self.statusBar().showMessage(str(e), 6000)
            if geom and pie.piezas.get("arco") is not None and pie.piezas["arco"].activa:
                geom = {**geom, "zona_arco": None}  # ya se ve el contorno del relleno de arco
            # Los nombres solo hacen falta mientras se marcan las referencias (o si se piden en Ver).
            nombres = (self.accion_nombres.isChecked() or not pie.referencias.completas
                       or (self.activa is not None and self.activa[0] == self._clave(pie)))
            self.visor.dibujar_pie(self._clave(pie), pie, geom, self.proyecto.linea_recorte(pie),
                                   self._piezas_a_dibujar(pie), nombres_visibles=nombres)

    def _piezas_a_dibujar(self, pie) -> list:
        """(tipo, color, contorno, centro) de las correcciones activas de un pie."""
        r = self.proyecto.original.rejilla
        cfg = self.proyecto.clinicos["referencias"]
        out = []
        for tipo, pieza in pie.piezas.items():
            if pieza.activa and pie.referencias.completas:
                out.append((tipo, piezas_mod.COLORES[tipo],
                            piezas_mod.contorno(pieza, pie.referencias, pie.mascara, r.dx, r.dy, cfg,
                                                recorte=pie.recorte),
                            piezas_mod.centro(pieza, pie.referencias, pie.mascara, r.dx, r.dy, cfg, pie.recorte)))
        return out

    def _mover_pieza(self, clave: str, tipo: str, x: float, y: float) -> bool:
        """Lleva el centro de una pieza a (x, y) (cambia su desplazamiento a mano)."""
        pie = self.proyecto.pies[int(clave[1])]
        if self.proyecto.pie_en(x, y) is not pie:
            return False
        pieza = pie.piezas[tipo]
        r = self.proyecto.original.rejilla
        ahora = piezas_mod.centro(pieza, pie.referencias, pie.mascara, r.dx, r.dy, self.proyecto.clinicos["referencias"],
                                  pie.recorte)
        if ahora is None:
            return False
        sis = pie.referencias.sistema()
        u0, v0 = sis.a_local(*ahora)
        u1, v1 = sis.a_local(x, y)
        pieza.du += float(u1 - u0)
        pieza.dv += float(v1 - v0)
        return True

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
        if not self._puede_descartar():
            evento.ignore()
            return
        self.ajustes.setValue("geometria", self.saveGeometry())
        self.ajustes.setValue("division", self.division.saveState())
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

    def ver_pedido(self):
        """Abre el expediente (receta, vídeos y fotos, cuestionario) del pedido del molde abierto."""
        texto = self.caja_pedido.text()
        if not texto.isdigit():
            return
        numero = int(texto)
        web = self.confeccion.web
        if not web.token:
            QMessageBox.information(self, "Ver pedido", "Para ver el pedido, entra primero en <b>Confección</b> "
                                    "con tu usuario de taller de la web.")
            return
        from interfaz import expediente

        def listo(id_):
            if id_ is None:
                QMessageBox.information(self, "Ver pedido", f"El pedido nº {numero} no está en el taller "
                                        "(o el número no es correcto).")
                return
            nombre = (self.proyecto.paciente.get("nombre") if self.proyecto else "") or ""
            expediente.abrir(self, web, id_, f"#{numero}" + (f" · {nombre}" if nombre else ""))

        self.confeccion._en_segundo_plano(lambda: web.buscar_pedido(numero), listo,
                                          lambda m: QMessageBox.warning(self, "Ver pedido", m))

    def ajustes_cnc(self) -> bool:
        """Abre «Ajustes de la CNC». Si se guardan, la tirada abierta tiene que volver a calcularse."""
        from interfaz.ajustes_cnc import DialogoAjustesCNC
        d = DialogoAjustesCNC(self.tirada if self.tirada is not None and self.tirada.isVisible() else self,
                              self.taller)
        guardado = d.exec() == QDialog.Accepted
        if guardado:
            if self.tirada is not None:
                self.tirada._invalidar()
            self.statusBar().showMessage("Ajustes de la CNC guardados: se usan en la próxima tirada que calcules.",
                                         6000)
        return guardado

    # ---------------------------------------------------------------- apartados

    def ir_a(self, apartado: str):
        """Cambia entre los apartados Fresado y Confección."""
        confeccion = apartado == "confeccion"
        if self.botones_apartado[apartado].isChecked() is False:
            self.botones_apartado[apartado].setChecked(True)  # vuelve a entrar aquí por la señal
            return
        self.apartados.setCurrentIndex(1 if confeccion else 0)
        self.barra.setVisible(not confeccion)
        self.ajustes.setValue("apartado", apartado)
        if confeccion:
            self.confeccion.al_entrar()
        else:
            self.confeccion.al_salir()

    def abrir_confeccion(self):
        self.ir_a("confeccion")
        return self.confeccion

    # ---------------------------------------------------------------- reloj de la CNC

    def cnc_estado(self) -> dict | None:
        """La tirada que está fresando la CNC (o ha terminado y no se ha quitado el aviso)."""
        import json

        try:
            estado = json.loads(self.ajustes.value("cnc_en_marcha", "") or "null")
        except ValueError:
            return None
        return estado if isinstance(estado, dict) and estado.get("inicio") else None

    def cnc_iniciar(self, minutos: float, lote: str, pedidos: list[int], moldes: list[str], inicio=None):
        """«Inicio» de la tirada: con el tiempo estimado avisa en Confección cuando la CNC acabe."""
        import json
        from datetime import datetime

        estado = {"inicio": (inicio or datetime.now()).isoformat(timespec="seconds"), "minutos": float(minutos),
                  "lote": lote, "pedidos": sorted(set(int(n) for n in pedidos)), "moldes": list(moldes),
                  "avisado": False}
        self.ajustes.setValue("cnc_en_marcha", json.dumps(estado))
        self._cnc_tic()
        if not (self.cnc_estado() or {}).get("avisado"):  # (si ya ha acabado, el aviso ya ha salido)
            self.notificar(f"CNC en marcha: te aviso en Confección en unos {minutos:.0f} min.", "bien")

    def cnc_parar(self):
        self.ajustes.remove("cnc_en_marcha")
        self.confeccion.mostrar_aviso_cnc(None)
        self._cnc_tic()

    def _cnc_tic(self):
        """Cada medio minuto: cuánto le queda a la CNC y, si ha acabado, el aviso."""
        import json
        from datetime import datetime, timedelta

        estado = self.cnc_estado()
        if not estado:
            self.accion_cnc.setVisible(False)
            return
        fin = datetime.fromisoformat(estado["inicio"]) + timedelta(minutes=estado["minutos"])
        quedan = (fin - datetime.now()).total_seconds() / 60
        self.accion_cnc.setVisible(True)
        if quedan > 0:
            self.boton_cnc.setText(f"⏱ CNC: quedan {max(1, round(quedan))} min · acaba a las {fin:%H:%M}"
                                   + (f" · {estado['lote']}" if estado.get("lote") else ""))
            return
        self.boton_cnc.setText(f"✔ CNC terminada ({fin:%H:%M})" + (f" · {estado['lote']}" if estado.get("lote") else ""))
        self.confeccion.mostrar_aviso_cnc(estado)
        if not estado.get("avisado"):
            estado["avisado"] = True
            self.ajustes.setValue("cnc_en_marcha", json.dumps(estado))
            self.notificar("La CNC ha terminado la tirada: mira el aviso en Confección.", "bien")
            QApplication.beep()
            QApplication.alert(self, 0)

    def anadir_a_tirada(self):
        if not self.proyecto:
            return
        t = self.abrir_tirada()
        t.anadir_abierto()
        self.notificar(f"{nombre_para_archivos(self.proyecto)} añadido a la tirada de CNC.", "bien")

    # ---------------------------------------------------------------- exportar

    def exportar(self):
        if not self.proyecto:
            return
        sugerido = nombre_para_archivos(self.proyecto)
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


CARPETA_DATOS = Path.home() / "AppData" / "Local" / "RectificadorOrtosend"


class _Puente(QObject):
    """Para que el trabajo en segundo plano de la actualización hable con la ventana."""
    progreso = Signal(int, int)
    estado = Signal(str)
    terminado = Signal(str)


def _registro_de_errores():
    """Sin ventana negra (pythonw) no hay dónde escribir los errores: van a un archivo, y si el programa
    falla se avisa con un mensaje."""
    from datetime import datetime

    CARPETA_DATOS.mkdir(parents=True, exist_ok=True)
    ruta = CARPETA_DATOS / "errores.log"
    if sys.stdout is None or sys.stderr is None:
        archivo = open(ruta, "a", encoding="utf-8", buffering=1)  # noqa: SIM115 - abierto mientras dure
        sys.stdout = sys.stdout or archivo
        sys.stderr = sys.stderr or archivo

    def al_fallar(tipo, valor, pila):
        texto = "".join(traceback.format_exception(tipo, valor, pila))
        with open(ruta, "a", encoding="utf-8") as f:
            f.write(f"\n--- {datetime.now():%Y-%m-%d %H:%M:%S} ---\n{texto}")
        try:
            QMessageBox.critical(None, "Error inesperado",
                                 f"Ha ocurrido un error:\n\n{valor}\n\nSe ha apuntado en:\n{ruta}\n"
                                 "Si se repite, manda ese archivo.")
        except Exception:  # noqa: BLE001
            pass

    sys.excepthook = al_fallar


def _renombrar_accesos_directos():
    """El programa se llamaba «Rectificador Ortosend»: al actualizar, el acceso directo pasa a «Ortosend Taller»
    (Escritorio y menú Inicio). Solo en Windows y solo si aún tiene el nombre viejo."""
    if not sys.platform.startswith("win"):
        return
    try:
        import ctypes

        carpetas = []
        for csidl in (0x10, 0x02):  # Escritorio y Programas del menú Inicio (aunque estén en OneDrive)
            buf = ctypes.create_unicode_buffer(260)
            if ctypes.windll.shell32.SHGetFolderPathW(None, csidl, None, 0, buf) == 0:
                carpetas.append(Path(buf.value))
        for c in carpetas:
            viejo, nuevo = c / "Rectificador Ortosend.lnk", c / "Ortosend Taller.lnk"
            if viejo.exists() and not nuevo.exists():
                viejo.rename(nuevo)
    except Exception:  # noqa: BLE001 - no es importante: el acceso viejo sigue funcionando
        traceback.print_exc()


def main():
    _registro_de_errores()
    _renombrar_accesos_directos()
    app = QApplication(sys.argv)
    app.setApplicationName("Ortosend Taller")
    estilo.aplicar(app)
    ventana = VentanaPrincipal()
    ventana.show()
    banderas = {a for a in sys.argv[1:] if a.startswith("--")}
    archivos = [a for a in sys.argv[1:] if not a.startswith("--")]
    if archivos:
        ventana.abrir(archivos[0])
    if "--actualizado" in banderas:
        from ortomolde import __version__
        QTimer.singleShot(800, lambda: ventana.notificar(f"Actualizado a la versión {__version__}. "
                                                         "Las novedades están en Ayuda → Novedades.", "bien"))
    elif "--fallo-actualizacion" in banderas:
        QTimer.singleShot(800, lambda: QMessageBox.warning(
            ventana, "Actualización", "No se ha podido terminar la actualización y se ha dejado la versión que "
            f"tenías, que funciona igual que antes.\n\nEl detalle está en:\n{CARPETA_DATOS / 'instalacion.log'}"))
    ventana.buscar_actualizaciones(silencio=True)
    if ventana.ajustes.value("vigilar_escaneos", False) in (True, "true"):
        ventana.vigilar_escaneos()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
