"""«Ajustes de la CNC»: el material del molde (espuma XPS, escayola…) y sus revoluciones, velocidades y
pasadas, cambiables desde la app.

Se guardan en un archivo del usuario (ver `config.ruta_ajustes`), así la actualización automática no los
borra. Los de `config/taller.toml` son «los de fábrica» de cada material."""

from __future__ import annotations

import math

from PySide6.QtWidgets import (QComboBox, QDialog, QDialogButtonBox, QDoubleSpinBox, QFormLayout, QHBoxLayout,
                               QLabel, QMessageBox, QPushButton, QVBoxLayout)

from ortomolde import config

from . import estilo

#: (clave, texto, unidad, decimales) por grupo.
GRUPOS = (
    ("Cabezal", "1", (("revoluciones", "Revoluciones", " rpm", 0),)),
    ("Velocidades", "2", (
        ("avance_desbaste", "Desbaste", " mm/min", 0),
        ("avance_contorno", "Contorno (la ranura alrededor del pie)", " mm/min", 0),
        ("avance_entrada", "Entrando en el material", " mm/min", 0),
        ("avance_bajada", "Bajando en vertical", " mm/min", 0),
        ("avance_acabado", "Acabado", " mm/min", 0),
    )),
    ("Pasadas", "3", (
        ("bajada_por_pasada", "Bajada por capa (desbaste)", " mm", 1),
        ("bajada_contorno", "Bajada por vuelta (contorno)", " mm", 1),
        ("paso_desbaste", "Separación de vueltas (desbaste)", " mm", 2),
        ("sobrante_desbaste", "Lo que deja para el acabado", " mm", 2),
        ("rebaje_superior", "Rebaje de la cara de arriba", " mm", 1),
        ("radio_helice", "Entrada en hélice: radio (0 = vertical)", " mm", 1),
        ("rampa_grados", "Entrada en hélice: inclinación", " °", 1),
        ("paso_acabado", "Separación de líneas (acabado)", " mm", 2),
        ("altura_seguridad", "Altura para ir de un pie a otro", " mm", 1),
    )),
)


#: Altura que corta la broca de bola (desde la punta).
FILO = 15.0


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
        self.materiales = config.materiales()
        self.material = taller["cnc"].get("material_clave") or config.material_actual()
        self.fabrica = config.cnc_de_fabrica(self.material)
        cnc = taller["cnc"]
        lay = QVBoxLayout(self)
        fila = QHBoxLayout()
        fila.addWidget(estilo.etiqueta("Material del molde", "secundario", envolver=False))
        self.combo_material = QComboBox()
        for clave, m in self.materiales.items():
            self.combo_material.addItem(f"{m['nombre']} (placa de {m['plancha_alto']:g} mm)", clave)
        self.combo_material.setCurrentIndex(max(0, self.combo_material.findData(self.material)))
        self.combo_material.currentIndexChanged.connect(
            lambda i: self.cambiar_material(self.combo_material.itemData(i)))
        fila.addWidget(self.combo_material, 1)
        lay.addLayout(fila)
        self.nota = estilo.etiqueta("", "nota")
        lay.addWidget(self.nota)
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
        self._poner_nota()
        self._refrescar()
        estilo.barra_titulo_oscura(self)

    def _poner_nota(self):
        m = self.materiales[self.material]
        self.nota.setText(
            f"Velocidades y pasadas para <b>{m['nombre']}</b> (fresa de bola Ø{2 * self.radio:g} mm, placa de "
            f"{m['plancha_alto']:g} mm). Al cambiar de material se ponen sus valores de fábrica. Lo que cambies "
            "aquí se usa en las tiradas que calcules desde ahora y se conserva al actualizar el programa.")

    def cambiar_material(self, clave: str):
        """Otro material: sus valores de fábrica en todos los campos."""
        self.material = clave
        self.fabrica = config.cnc_de_fabrica(clave)
        self._poner_nota()
        self.de_fabrica()
        self._refrescar()

    def es_escayola(self) -> bool:
        return "escayola" in self.material

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
        if self.es_escayola():
            if v["bajada_por_pasada"] > self.radio or v["bajada_contorno"] > self.radio:
                avisos.append(f"Bajar más de {self.radio:g} mm de una vez (el radio de la fresa) puede romper la escayola.")
            if v["avance_bajada"] > v["avance_entrada"]:
                avisos.append("La bajada en vertical suele ir más despacio que la entrada: si va rápido el yeso se desconcha.")
            if v["radio_helice"] == 0:
                avisos.append("Sin hélice, el desbaste clava la fresa en vertical al entrar en el yeso.")
            elif v["rampa_grados"] > 5:
                avisos.append("Con la hélice muy inclinada la fresa entra casi como en vertical (Fusion usa 2°).")
        elif v["bajada_por_pasada"] > FILO or v["bajada_contorno"] > FILO:
            avisos.append(f"La broca corta {FILO:g} mm de altura: bajar más en una pasada hace que roce sin filo.")
        if v["paso_desbaste"] > self.radio:
            avisos.append(f"Separar el desbaste más de {self.radio:g} mm deja demasiado material para el acabado.")
        if v["rebaje_superior"] < 1:
            avisos.append("Con menos de 1 mm de rebaje, si la plancha no está del todo plana partes del pie "
                          "pueden quedar sin fresar.")
        if v["sobrante_desbaste"] == 0:
            avisos.append("Sin sobrante, el acabado no quita las marcas del desbaste.")
        self.avisos.setText("<br>".join(estilo.html("⚠ " + a, "aviso") for a in avisos))
        self.avisos.setVisible(bool(avisos))
        self.boton_fabrica.setEnabled(bool(self.cambios()))

    def de_fabrica(self):
        for k, c in self.cajas.items():
            c.setValue(float(self.fabrica[k]))

    def guardar(self):
        cambios = self.cambios()
        try:
            config.guardar_ajustes_cnc(cambios, self.material)
        except OSError as e:
            QMessageBox.warning(self, "Ajustes de la CNC", f"No se han podido guardar:\n{e}")
            return
        alto_antes = self.taller["plancha"]["alto_z"]
        config.aplicar_ajustes_cnc(self.taller["cnc"], cambios, self.material)
        self.taller["plancha"]["alto_z"] = float(self.materiales[self.material]["plancha_alto"])
        if abs(alto_antes - self.taller["plancha"]["alto_z"]) > 0.5 and self.AVISAR_PLACA:
            QMessageBox.information(
                self, "Ajustes de la CNC",
                f"Las placas de {self.materiales[self.material]['nombre']} son de "
                f"{self.taller['plancha']['alto_z']:g} mm: al ponerla en la CNC, pulsa <b>Placa nueva</b> en la "
                "ventana Tirada (y pon ese alto).")
        self.accept()

    AVISAR_PLACA = True  # en las pruebas, sin ventanas de aviso
