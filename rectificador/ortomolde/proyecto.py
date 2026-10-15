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
from .limpieza import limpiar

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
    tipo: str = "limpio"  # "bruto" (escaneo del Revopoint) o "limpio" (recuadro ya preparado)
    limpieza: dict | None = None  # informe de la limpieza (solo si tipo == "bruto")

    @classmethod
    def abrir(cls, ruta_stl: str | Path, taller: dict | None = None, tipo: str = "auto",
              lados: dict[int, str] | None = None) -> "Proyecto":
        """Abre un escaneo en bruto (lo limpia) o un recuadro ya limpio.

        tipo = "auto" decide solo: si la malla es cerrada y mide lo que el recuadro, es un
        molde limpio; si no, se trata como escaneo en bruto.
        """
        taller = taller or config.taller()
        ruta = Path(ruta_stl)
        malla = trimesh.load(ruta, force="mesh")
        rec = taller["recuadro"]
        if tipo == "auto":
            tam = malla.bounds[1] - malla.bounds[0]
            encaja = abs(tam[0] - rec["ancho_x"]) < 2 and abs(tam[1] - rec["largo_y"]) < 2
            tipo = "limpio" if (malla.is_watertight and encaja) else "bruto"
        if tipo == "bruto":
            campo, informe = limpiar(malla, taller, lados)
            return cls(ruta, campo, taller["limpieza"]["base"], taller, huella(ruta), "bruto", informe.a_dict())
        campo = malla_a_campo(malla, taller["calculo"]["rejilla"], (rec["ancho_x"], rec["largo_y"]))
        return cls(ruta, campo, detectar_fondo(campo.z), taller, huella(ruta), "limpio")

    @property
    def avisos(self) -> list[str]:
        return list(self.limpieza["avisos"]) if self.limpieza else []

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
            "escaneo": {"archivo": self.ruta_stl.name, "sha256": self.huella_stl, "tipo": self.tipo},
            "limpieza": self.limpieza,
            "rejilla": self.original.rejilla.a_dict(),
            "desplazamiento_stl": [float(v) for v in self.original.desplazamiento],
            "fondo_mm": self.fondo,
            "taller": self.taller,
        }
