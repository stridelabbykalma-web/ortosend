"""Estado completo de un molde y recálculo no destructivo.

Estado = escaneo original (nunca se modifica) + parámetros. El resultado se
recalcula siempre desde el original, así que cualquier cambio se puede deshacer
o editar en cualquier orden. La receta JSON guarda todo lo necesario para
regenerar exactamente el mismo resultado.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import trimesh

from . import __version__, config
from .campo import Campo, detectar_fondo, malla_a_campo

VERSION_RECETA = 1


def huella(ruta: str | Path) -> str:
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


@dataclass
class Proyecto:
    ruta_stl: Path
    original: Campo
    fondo: float
    taller: dict = field(default_factory=config.taller)
    huella_stl: str = ""

    @classmethod
    def abrir(cls, ruta_stl: str | Path, taller: dict | None = None) -> "Proyecto":
        taller = taller or config.taller()
        ruta = Path(ruta_stl)
        malla = trimesh.load(ruta, force="mesh")
        rec = taller["recuadro"]
        campo = malla_a_campo(malla, taller["calculo"]["rejilla"], (rec["ancho_x"], rec["largo_y"]))
        return cls(ruta, campo, detectar_fondo(campo.z), taller, huella(ruta))

    def calcular(self) -> Campo:
        """Resultado = original + correcciones (de momento ninguna), dentro de los límites del bloque."""
        z = self.original.z.copy()
        z = np.clip(z, 0.0, self.taller["recuadro"]["alto_z"])
        return self.original.copia(z)

    def receta(self) -> dict:
        return {
            "programa": "Rectificador de moldes Ortosend",
            "version_programa": __version__,
            "version_receta": VERSION_RECETA,
            "escaneo": {"archivo": self.ruta_stl.name, "sha256": self.huella_stl},
            "rejilla": self.original.rejilla.a_dict(),
            "desplazamiento_stl": [float(v) for v in self.original.desplazamiento],
            "fondo_mm": self.fondo,
            "taller": self.taller,
        }
