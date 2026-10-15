"""Los pies dentro del molde limpio: máscara, lado y referencias de cada uno."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

from .campo import Campo
from .recorte import Recorte
from .referencias import Referencias


@dataclass
class Pie:
    lado: str  # "izquierdo" o "derecho"
    mascara: np.ndarray  # (ny, nx) True dentro del pie
    referencias: Referencias = field(default_factory=Referencias)
    recorte: Recorte = field(default_factory=Recorte)

    @property
    def nombre(self) -> str:
        return f"Pie {self.lado}"

    def contiene(self, campo: Campo, x: float, y: float) -> bool:
        i, j = int(round(x / campo.rejilla.dx)), int(round(y / campo.rejilla.dy))
        ny, nx = self.mascara.shape
        return 0 <= i < nx and 0 <= j < ny and bool(self.mascara[j, i])


def detectar_pies(campo: Campo, fondo: float, izq_en: str = "izquierda", umbral: float = 1.5,
                  area_minima: float = 3000.0, margen: float = 3.0) -> list[Pie]:
    """Separa los pies del molde (lo que sobresale de la base). Ordenados de -X a +X.

    El lado se propone por la mitad del recuadro en la que está cada pie (así los coloca
    la limpieza); el usuario lo puede cambiar.
    """
    r = campo.rejilla
    relieve = campo.z - fondo > umbral
    etiquetas, n = ndimage.label(relieve)
    if n == 0:
        return []
    areas = ndimage.sum(relieve, etiquetas, index=np.arange(1, n + 1)) * r.dx * r.dy
    grandes = [k + 1 for k in np.argsort(-areas)[:2] if areas[k] >= area_minima]
    iteraciones = max(1, int(round(margen / r.dx)))
    pies = []
    for k in grandes:
        m = ndimage.binary_dilation(etiquetas == k, iterations=iteraciones)
        x_medio = np.nonzero(m)[1].mean() * r.dx
        en_izquierda = x_medio < r.ancho / 2
        lado = "izquierdo" if en_izquierda == (izq_en == "izquierda") else "derecho"
        pies.append(Pie(lado, m))
    pies.sort(key=lambda p: np.nonzero(p.mascara)[1].mean())
    if len(pies) == 2 and pies[0].lado == pies[1].lado:
        pies[0].lado, pies[1].lado = ("izquierdo", "derecho") if izq_en == "izquierda" else ("derecho", "izquierdo")
    return pies
