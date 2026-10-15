"""Suavizado del molde: quita impurezas (hoyitos, bultitos, marcas del escáner o de la
espuma) sin cambiar la forma del pie, porque cualquier bulto del molde se nota en la plantilla.

Tres pasos, todos con el mismo tamaño `radio` (mm):
 1. Rellenar hoyos más estrechos que 2·radio (cierre morfológico).
 2. Rebajar bultos más estrechos que 2·radio (apertura morfológica).
 3. Alisar lo que queda (filtro gaussiano de radio/2).
Las formas grandes (talón, arco, cabezas metatarsales) no cambian: sobre una superficie
curva amplia los pasos 1 y 2 no hacen nada y el 3 apenas la toca.
Fuera de los pies la base sigue plana.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage


def disco(radio_celdas: int) -> np.ndarray:
    r = max(1, int(radio_celdas))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    return xx * xx + yy * yy <= r * r


def suavizar(z: np.ndarray, fondo: float, mascara: np.ndarray, paso: float, radio: float) -> np.ndarray:
    """Devuelve una copia suavizada de z. `mascara` = zona de los pies; radio en mm (0 = nada)."""
    if radio <= 0:
        return z.copy()
    h = z - fondo
    huella = disco(round(radio / paso))
    h2 = ndimage.grey_closing(h, footprint=huella)
    h2 = ndimage.grey_opening(h2, footprint=huella)
    h2 = ndimage.gaussian_filter(h2, sigma=radio / 2 / paso)
    # Solo se toca la zona de los pies (con margen para que la transición sea continua).
    zona = ndimage.binary_dilation(mascara, iterations=max(1, int(round(2 * radio / paso))))
    h2 = np.where(zona, np.maximum(h2, 0.0), h)
    return fondo + h2
