"""Molde sintético de prueba: recuadro con dos pies en bulto, mientras no hay un STL real.

La forma imita un molde positivo (planta hacia arriba): talón y antepié altos,
arco interno más bajo. No pretende ser anatómicamente exacto.
"""

from __future__ import annotations

import numpy as np

from .campo import Campo, Rejilla, campo_a_malla

# Perfil a lo largo del pie (t = 0 talón, t = 1 punta de los dedos).
_T = np.array([0.0, 0.05, 0.15, 0.30, 0.45, 0.60, 0.72, 0.80, 0.90, 1.0])
_LATERAL = np.array([8, 24, 30, 30, 30, 34, 40, 38, 30, 10])  # semiancho lado externo
_MEDIAL = np.array([8, 24, 30, 24, 20, 30, 48, 46, 40, 14])  # semiancho lado interno
_ALTURA = np.array([12, 21, 24, 21, 18, 18, 20, 15, 11, 7])  # altura del relieve


def _suave(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def altura_pie(X, Y, centro_x, talon_y, largo, medial_signo):
    """Relieve de un pie. medial_signo = +1 si el lado interno queda hacia +X."""
    t = (Y - talon_y) / largo
    u = (X - centro_x) * medial_signo
    tc = np.clip(t, 0, 1)
    lat = np.interp(tc, _T, _LATERAL)
    med = np.interp(tc, _T, _MEDIAL)
    h = np.interp(tc, _T, _ALTURA)
    # Arco interno: zona media, lado medial más baja.
    arco = 9.0 * np.exp(-((tc - 0.42) / 0.12) ** 2) * _suave(u / np.maximum(med, 1))
    # Pequeñas cabezas metatarsales.
    h = h - arco
    distancia_borde = np.minimum(u + lat, med - u)
    distancia_borde = np.minimum(distancia_borde, np.minimum(t * largo, (1 - t) * largo) + 4)
    return np.where(distancia_borde > 0, h * _suave(distancia_borde / 10.0), 0.0)


def campo_sintetico(ancho=288.0, largo=330.0, paso=0.5, fondo=2.0, alto=38.0) -> Campo:
    rejilla = Rejilla.para_recuadro(ancho, largo, paso)
    X, Y = rejilla.malla()
    z = np.full(X.shape, fondo)
    # Pie izquierdo en la mitad izquierda (interno hacia +X), derecho en la derecha.
    z += altura_pie(X, Y, ancho * 0.25, 30.0, 255.0, +1)
    z += altura_pie(X, Y, ancho * 0.75, 34.0, 250.0, -1)
    z = np.minimum(z, alto)
    return Campo(rejilla, z, np.zeros(3))


def malla_sintetica(**kw):
    return campo_a_malla(campo_sintetico(**kw))
