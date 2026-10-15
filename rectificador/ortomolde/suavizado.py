"""Lijado del molde: quita impurezas (hoyitos, bultitos, ondulaciones, marcas del escáner o
de la espuma) conservando la forma del pie, como si se hubiera lijado a mano. Cualquier
bulto del molde se nota en la plantilla.

Pasos (todos dependen de un solo valor, `lijado` en mm = tamaño del "taco de lija"):
 1. Rellenar hoyos y rebajar bultos estrechos (cierre y apertura morfológicos).
 2. Lijar la planta: en cada punto se ajusta la superficie curva (de 2.º grado) que mejor
    encaja con lo que hay alrededor (a una distancia del orden de `lijado`) y se toma esa.
    Una superficie curva amplia (talón, arco, cabezas) se reproduce EXACTA: no se aplana ni
    se rebaja; solo desaparece lo que es más pequeño que el taco.
 3. En las paredes del pie (muy inclinadas) no se lija la forma, solo se quitan las
    impurezas del paso 1 y un alisado fino: así el contorno del pie no cambia. El paso de
    planta lijada a pared es gradual para no dejar líneas.
Fuera de los pies la base sigue plana. Nunca se modifica el escaneo original.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage
from scipy.signal import fftconvolve

PENDIENTE_PARED = (35.0, 55.0)  # grados: por debajo se lija entero, por encima es pared


def disco(radio_celdas: int) -> np.ndarray:
    r = max(1, int(radio_celdas))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    return xx * xx + yy * yy <= r * r


def _suave(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def ajuste_cuadratico_local(z: np.ndarray, peso: np.ndarray, sigma: float) -> np.ndarray:
    """Valor en cada punto del polinomio de 2.º grado ajustado por mínimos cuadrados a su
    entorno (pesos gaussianos de anchura `sigma` celdas × `peso`). Reproduce exactamente
    cualquier superficie de 2.º grado."""
    r = int(np.ceil(3 * sigma))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1].astype(float)
    g = np.exp(-(xx ** 2 + yy ** 2) / (2 * sigma ** 2))
    xx, yy = xx / sigma, yy / sigma  # escala para que el sistema esté bien condicionado
    # Monomios: 1, x, y, x², xy, y². Con convolución, el desplazamiento es (centro - vecino).
    exps = [(0, 0), (1, 0), (0, 1), (2, 0), (1, 1), (0, 2)]

    def conv(img, a, b):
        k = g * (-xx) ** a * (-yy) ** b
        return fftconvolve(img, k, mode="same")

    momentos = {}
    for a in range(5):
        for b in range(5 - a):
            momentos[(a, b)] = conv(peso, a, b)
    A = np.empty(z.shape + (6, 6))
    for i, (a1, b1) in enumerate(exps):
        for j, (a2, b2) in enumerate(exps):
            A[..., i, j] = momentos[(a1 + a2, b1 + b2)]
    rhs = np.stack([conv(peso * z, a, b) for a, b in exps], axis=-1)
    A += np.eye(6) * 1e-9 * (A[..., 0, 0][..., None, None] + 1e-12)
    valido = momentos[(0, 0)] > 1e-6 * g.sum()
    out = z.copy()
    sol = np.linalg.solve(A[valido], rhs[valido][..., None])[..., 0]
    out[valido] = sol[:, 0]
    return out


def suavizar(z: np.ndarray, fondo: float, mascara: np.ndarray, paso: float, lijado: float) -> np.ndarray:
    """Devuelve una copia lijada de z. `mascara` = zona de los pies; `lijado` en mm (0 = nada)."""
    if lijado <= 0:
        return z.copy()
    h = z - fondo
    # 1. Impurezas pequeñas.
    radio = min(2.0, lijado / 2)
    huella = disco(round(radio / paso))
    h1 = ndimage.grey_closing(h, footprint=huella)
    h1 = ndimage.grey_opening(h1, footprint=huella)
    h1 = ndimage.gaussian_filter(h1, sigma=1.0 / paso)

    # 2. Lijado de la planta (solo con puntos de la planta, no de las paredes).
    # La pendiente se mira sobre una versión muy suave para que el límite planta/pared sea limpio.
    gy, gx = np.gradient(ndimage.gaussian_filter(h1, lijado / 2 / paso), paso)
    pendiente = np.degrees(np.arctan(np.hypot(gx, gy)))
    planta = mascara & (pendiente < PENDIENTE_PARED[0])
    planta = ndimage.binary_opening(ndimage.binary_closing(planta, disco(3)), disco(3))
    lijada = ajuste_cuadratico_local(h1, planta.astype(float), lijado / paso)
    # 3. La corrección del lijado se aplica entera en la planta y se desvanece poco a poco
    #    hacia las paredes (en 1,5 tacos): sin escalones ni líneas, y el contorno no cambia.
    distancia = ndimage.distance_transform_edt(planta) * paso
    w = ndimage.gaussian_filter(_suave(distancia / (1.5 * lijado)), lijado / 2 / paso)
    h2 = h1 + w * (lijada - h1)

    # Solo se toca la zona de los pies (con margen para que la transición sea continua).
    zona = ndimage.binary_dilation(mascara, iterations=max(1, int(round(2 * radio / paso)) + 2))
    h2 = np.where(zona, np.maximum(h2, 0.0), h)
    return fondo + h2
