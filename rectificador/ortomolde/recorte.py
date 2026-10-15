"""Recorte en arco por delante de las cabezas metatarsales.

El molde termina en un arco que sigue la parábola metatarsal, `adelanto` mm por delante
de las cabezas. Por delante del arco no queda nada: se vacía hasta la base plana
(desaparecen los dedos).

La parábola pasa por la 1.ª y la 5.ª cabeza y sobresale `flecha × curvatura` mm por
delante de la línea que las une, con el punto más adelantado en `posicion_vertice`
(0 = 1.er MTT, 1 = 5.º MTT). "Delante" se mide en la dirección del eje del pie.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from scipy import ndimage

from .referencias import Referencias


@dataclass
class Recorte:
    activo: bool = True
    adelanto: float = 3.0  # mm por delante de las cabezas (negativo = por detrás)
    curvatura: float = 1.0  # 0 = recto, 1 = parábola metatarsal, >1 más curvado
    flecha: float = 10.0  # mm, con curvatura 1
    posicion_vertice: float = 0.35

    @classmethod
    def por_defecto(cls, clinicos: dict) -> "Recorte":
        c = clinicos["recorte_arco"]
        return cls(True, c["adelanto"], c["curvatura"], c.get("flecha", 10.0), c.get("posicion_vertice", 0.35))

    def a_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def de_dict(cls, d: dict) -> "Recorte":
        return cls(**d)


CAIDA_MAXIMA = 0.5  # mm hacia atrás por mm de lado, más allá de la 1.ª y la 5.ª cabeza


def _avance(t: np.ndarray, r: Recorte, cuerda: float = 60.0) -> np.ndarray:
    """Cuánto sobresale el arco por delante de la línea 1.º-5.º MTT en la posición t
    (t = 0 en el 1.er MTT, t = 1 en el 5.º; `cuerda` = distancia entre ellos en mm).

    Entre las cabezas es la parábola metatarsal. Fuera de ellas sigue en la misma dirección,
    pero solo se echa hacia atrás suavemente (como mucho CAIDA_MAXIMA mm por mm)."""
    t = np.asarray(t, float)
    t0 = float(np.clip(r.posicion_vertice, 0.05, 0.95))
    f = r.flecha * r.curvatura
    a = np.where(t <= t0, (t - t0) / t0, (t - t0) / (1 - t0))
    dentro = f * (1 - a * a)
    # Pendientes en los extremos (mm por unidad de t), limitadas.
    limite = CAIDA_MAXIMA * cuerda
    pend0 = min(2 * f / t0, limite)
    pend1 = min(2 * f / (1 - t0), limite)
    return np.where(t < 0, pend0 * t, np.where(t > 1, -pend1 * (t - 1), dentro))


def _cuerda(refs: Referencias) -> float:
    return float(np.hypot(*(np.array(refs.puntos["mtt5"]) - np.array(refs.puntos["mtt1"]))))


def coordenadas_arco(refs: Referencias, X: np.ndarray, Y: np.ndarray):
    """(t, s) de cada punto: t a lo largo de la línea 1.º->5.º MTT, s hacia delante (mm)
    medido en la dirección del eje del pie desde esa línea."""
    sis = refs.sistema()
    m1 = np.array(refs.puntos["mtt1"], float)
    m5 = np.array(refs.puntos["mtt5"], float)
    c = m5 - m1
    e = sis.eje
    det = c[0] * e[1] - c[1] * e[0]
    px, py = X - m1[0], Y - m1[1]
    t = (px * e[1] - py * e[0]) / det
    s = (c[0] * py - c[1] * px) / det
    return t, s


def zona_recortada(refs: Referencias, r: Recorte, X: np.ndarray, Y: np.ndarray) -> np.ndarray:
    """True por delante del arco."""
    t, s = coordenadas_arco(refs, X, Y)
    return s > _avance(t, r, _cuerda(refs)) + r.adelanto


def linea_del_arco(refs: Referencias, r: Recorte, mascara: np.ndarray, dx: float, dy: float,
                   n: int = 120, atras: float = 0.0) -> list[tuple[float, float]]:
    """Puntos (x, y) del arco dentro del pie, para dibujarlo."""
    m1 = np.array(refs.puntos["mtt1"], float)
    m5 = np.array(refs.puntos["mtt5"], float)
    e = refs.sistema().eje
    puntos = []
    for t in np.linspace(-0.8, 1.8, n):
        p = m1 + t * (m5 - m1) + e * (_avance(np.array(t), r, _cuerda(refs)) + r.adelanto - atras)
        i, j = int(round(p[0] / dx)), int(round(p[1] / dy))
        if 0 <= j < mascara.shape[0] and 0 <= i < mascara.shape[1] and mascara[j, i]:
            puntos.append((float(p[0]), float(p[1])))
    return puntos


def aplicar(z: np.ndarray, fondo: float, refs: Referencias, r: Recorte, mascara: np.ndarray,
            X: np.ndarray, Y: np.ndarray, paso: float) -> np.ndarray:
    """Vacía hasta la base todo lo que está por delante del arco en la zona de este pie."""
    if not r.activo or not refs.completas:
        return z
    zona_pie = ndimage.binary_dilation(mascara, iterations=int(round(10 / paso)))
    t, s = coordenadas_arco(refs, X, Y)
    limite = _avance(t, r, _cuerda(refs)) + r.adelanto
    # Fracción de material que queda: 1 detrás del arco, 0 delante, y una transición de una
    # celda justo en el arco para que el borde siga la curva exacta (sin escalera).
    queda = np.clip((limite - s) / paso + 0.5, 0.0, 1.0)
    queda = np.where(zona_pie, queda, 1.0)
    return fondo + (z - fondo) * queda
