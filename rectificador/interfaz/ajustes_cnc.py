"""«Ajustes de la CNC»: revoluciones, velocidades y pasadas del fresado, cambiables desde la app.

Se guardan en un archivo del usuario (ver `config.ruta_ajustes`), así la actualización automática no los
borra. Los de `config/taller.toml` son «los de fábrica»."""

from __future__ import annotations

import math

from PySide6.QtWidgets import (QDialog, QDialogButtonBox, QDoubleSpinBox, QFormLayout, QHBoxLayout, QLabel,
                               QMessageBox, QPushButton, QVBoxLayout)

from ortomolde import config

from . import estilo

#: (clave, texto, unidad, decimales) por grupo.
GRUPOS = (
    ("Cabezal", "1", (("revoluciones", "Revoluciones", " rpm", 0),)),
    ("Velocidades", "2", (
        ("avance_desbaste", "Desbaste y contorno", " mm/min", 0),
        ("avance_entrada", "Entrando en el material", " mm/min", 0),
        ("avance_bajada", "Bajando en vertical", " mm/min", 0),
        ("avance_acabado", "Acabado", " mm/min", 0),
    )),
    ("Pasadas", "3", (
        ("bajada_por_pasada", "Bajada por capa (desbaste)", " mm", 1),
        ("bajada_contorno", "Bajada por vuelta (contorno)", " mm", 1),
        ("paso_desbaste", "Separación de líneas (desbaste)", " mm", 2),
        ("sobrante_desbaste", "Lo que deja para el acabado", " mm", 2),
        ("rebaje_superior", "Rebaje de la cara de arriba", " mm", 1),
        ("radio_helice", "Entrada en hélice: radio (0 = vertical)", " mm", 1),
        ("rampa_grados", "Entrada en hélice: inclinación", " °", 1),
        ("paso_acabado", "Separación de líneas (acabado)", " mm", 2),
        ("altura_seguridad", "Altura para ir de un pie a otro", " mm", 1),
    )),
)


def cresta(radio: float, paso: float) -> float:
    """Altura del escalón que deja la fresa de bola entre dos líneas separadas `paso` mm."""
    medio = min(paso / 2, radio)
    return radio - math.sqrt(radio * radio - medio * medio)


class DialogoAjustesCNC(QDialog):
    def __init__(self, parent, taller: dict):
        super().__init__(parent)
        self.setWindowTitle("Ajustes de la CNC")
        self.setMinimumWidth(480)
        self.taller = taller
        self.radio = taller["fresa"]["diametro"] / 2
        self.fabrica = config.cnc_de_fabrica()
        cnc = taller["cnc"]
        lay = QVBoxLayout(self)
        lay.addWidget(estilo.etiqueta(
            f"Velocidades y pasadas del fresado ({cnc.get('material', 'escayola')}, fresa de bola "
            f"Ø{2 * self.radio:g} mm). Los de fábrica son los del ejemplo de Fusion del taller. Lo que cambies "
            "aquí se usa en las tiradas que calcules desde ahora y se conserva al actualizar el programa.",
            "nota"))
        self.cajas: dict[str, QDoubleSpinBox] = {}
        for titulo, paso, campos in GRUPOS:
            marco, lay_g, _ = estilo.tarjeta(titulo, paso)
            form = QFormLayout()
            form.setHorizontalSpacing(12)
            for clave, texto, unidad, decimales in campos:
                c = QDoubleSpinBox()
                c.setRange(*config.CNC_EDITABLE[clave])
                c.setDecimals(decimales)
                c.setSingleStep(100 if unidad.strip().startswith(("rpm", "mm/min")) else 0.25)
                c.setSuffix(unidad)
                c.setValue(float(cnc.get(clave, self.fabrica[clave])))
                c.valueChanged.connect(self._refrescar)
                self.cajas[clave] = c
                form.addRow(estilo.etiqueta(texto, "secundario", envolver=False), c)
            lay_g.addLayout(form)
            if titulo == "Pasadas":
                self.info_crestas = estilo.etiqueta("", "secundario")
                lay_g.addWidget(self.info_crestas)
            lay.addWidget(marco)
        self.avisos = QLabel()
        self.avisos.setWordWrap(True)
        lay.addWidget(self.avisos)
        fila = QHBoxLayout()
        self.boton_fabrica = QPushButton("Volver a los de fábrica")
        self.boton_fabrica.clicked.connect(self.de_fabrica)
        fila.addWidget(self.boton_fabrica)
        fila.addStretch(1)
        botones = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        botones.button(QDialogButtonBox.Save).setText("Guardar")
        botones.button(QDialogButtonBox.Cancel).setText("Cancelar")
        estilo.primario(botones.button(QDialogButtonBox.Save))
        botones.accepted.connect(self.guardar)
        botones.rejected.connect(self.reject)
        fila.addWidget(botones)
        lay.addLayout(fila)
        self._refrescar()
        estilo.barra_titulo_oscura(self)

    def valores(self) -> dict:
        return {k: c.value() for k, c in self.cajas.items()}

    def cambios(self) -> dict:
        """Solo lo que es distinto de fábrica."""
        return {k: v for k, v in self.valores().items() if abs(v - float(self.fabrica[k])) > 1e-9}

    def _refrescar(self, *_):
        v = self.valores()
        for k, c in self.cajas.items():
            distinto = abs(v[k] - float(self.fabrica[k])) > 1e-9
            c.setStyleSheet(f"color: {estilo.C['aviso']};" if distinto else "")
            c.setToolTip(f"De fábrica: {float(self.fabrica[k]):g}{c.suffix()}" if distinto else "")
        self.info_crestas.setText(
            f"Con la bola de Ø{2 * self.radio:g} mm: el desbaste deja escalones de "
            f"{cresta(self.radio, v['paso_desbaste']):.2f} mm y el acabado de "
            f"{cresta(self.radio, v['paso_acabado']):.2f} mm (más separación = más rápido, menos liso).")
        avisos = []
        if v["bajada_por_pasada"] > self.radio or v["bajada_contorno"] > self.radio:
            avisos.append(f"Bajar más de {self.radio:g} mm de una vez (el radio de la fresa) puede romper la escayola.")
        if v["paso_desbaste"] > self.radio:
            avisos.append(f"Separar el desbaste más de {self.radio:g} mm deja demasiado material para el acabado.")
        if v["avance_bajada"] > v["avance_entrada"]:
            avisos.append("La bajada en vertical suele ir más despacio que la entrada: si va rápido el yeso se desconcha.")
        if v["radio_helice"] == 0:
            avisos.append("Sin hélice, el desbaste clava la fresa en vertical al entrar en el yeso.")
        elif v["rampa_grados"] > 5:
            avisos.append("Con la hélice muy inclinada la fresa entra casi como en vertical (Fusion usa 2°).")
        if v["rebaje_superior"] < 1:
            avisos.append("Con menos de 1 mm de rebaje, si la plancha no está del todo plana partes del pie "
                          "pueden quedar sin fresar.")
        if v["sobrante_desbaste"] == 0:
            avisos.append("Sin sobrante, el acabado no quita las marcas del desbaste.")
        self.avisos.setText("<br>".join(estilo.html("⚠ " + a, "aviso") for a in avisos))
        self.avisos.setVisible(bool(avisos))
        self.boton_fabrica.setEnabled(bool(self.cambios()) or bool(config.ajustes_cnc()))

    def de_fabrica(self):
        for k, c in self.cajas.items():
            c.setValue(float(self.fabrica[k]))

    def guardar(self):
        cambios = self.cambios()
        try:
            config.guardar_ajustes_cnc(cambios)
        except OSError as e:
            QMessageBox.warning(self, "Ajustes de la CNC", f"No se han podido guardar:\n{e}")
            return
        config.aplicar_ajustes_cnc(self.taller["cnc"], cambios)
        self.accept()
