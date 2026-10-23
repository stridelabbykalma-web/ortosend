"""Recorte en arco por delante de las cabezas metatarsales.

El molde termina en un arco que sigue la parábola metatarsal, `adelanto` mm por delante
de las cabezas. Por delante del arco no queda nada: se vacía hasta la base plana
(desaparecen los dedos). El arco es la línea por donde se recortará la plantilla; por
delante de él el molde sigue `pendiente` mm más, bajando en un bisel recto y suave
(`caida` mm en total), y ahí termina en pared vertical. Así, al termoformar en la máquina
de vacío, la lámina se apoya en el bisel y la fuerza se reparte en el borde del recorte.

Si están marcadas las cabezas del 2.º, 3.º y 4.º MTT, el arco pasa por delante de TODAS
(curva suave por las 5 cabezas, sin pasarse entre ellas). Si no, se supone una parábola
que pasa por la 1.ª y la 5.ª y sobresale `flecha` mm por delante de la línea que las une,
con el punto más adelantado en `posicion_vertice` (0 = 1.er MTT, 1 = 5.º MTT).
`curvatura` escala lo que sobresale la curva (1 = tal cual, 0 = recto).
"Delante" se mide en la dirección del eje del pie.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from scipy import ndimage

from .referencias import Referencias


@dataclass
class Recorte:
    activo: bool = True
    adelanto: float = 15.0  # mm por delante de las cabezas (negativo = por detrás)
    curvatura: float = 1.0  # 0 = recto, 1 = parábola metatarsal, >1 más curvado
    flecha: float = 10.0  # mm, con curvatura 1
    posicion_vertice: float = 0.35
    pendiente: float = 10.0  # mm que sigue el molde por delante del arco, en bisel (0 = pared en el arco)
    caida: float = 4.0  # mm que baja el bisel en esos `pendiente` mm

    @classmethod
    def por_defecto(cls, clinicos: dict) -> "Recorte":
        c = clinicos["recorte_arco"]
        return cls(True, c["adelanto"], c["curvatura"], c.get("flecha", 10.0), c.get("posicion_vertice", 0.35),
                   c.get("pendiente", 10.0), c.get("caida", 4.0))

    def a_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def de_dict(cls, d: dict) -> "Recorte":
        return cls(**d)


CAIDA_MAXIMA = 0.5  # mm hacia atrás por mm de lado, más allá de la 1.ª y la 5.ª cabeza


def _perfil(refs: Referencias, r: Recorte):
    """Función t -> cuánto sobresale el arco (mm) por delante de la línea 1.º-5.º MTT,
    sin contar el adelanto. t = 0 en el 1.er MTT y t = 1 en el 5.º."""
    from scipy.interpolate import PchipInterpolator

    cuerda = _cuerda(refs)
    medias = [k for k in ("mtt2", "mtt3", "mtt4") if k in refs.puntos]
    if medias:
        X = np.array([refs.puntos[k][0] for k in medias])
        Y = np.array([refs.puntos[k][1] for k in medias])
        tm, sm = coordenadas_arco(refs, X, Y)
        t = np.concatenate([[0.0], tm, [1.0]])
        sv = np.concatenate([[0.0], sm, [0.0]]) * r.curvatura
        orden = np.argsort(t)
        t, sv = t[orden], sv[orden]
        t, idx = np.unique(t, return_index=True)
        sv = sv[idx]
        if len(t) >= 2 and t[0] <= 0.0 and t[-1] >= 1.0:
            curva = PchipInterpolator(t, sv)
            d0, d1 = float(curva(0.0, 1)), float(curva(1.0, 1))

            def dentro(tt):
                return curva(np.clip(tt, 0.0, 1.0))
        else:
            medias = []
    if not medias:
        t0 = float(np.clip(r.posicion_vertice, 0.05, 0.95))
        f = r.flecha * r.curvatura
        d0, d1 = 2 * f / t0, -2 * f / (1 - t0)

        def dentro(tt):
            a = np.where(tt <= t0, (tt - t0) / t0, (tt - t0) / (1 - t0))
            return f * (1 - a * a)

    # Fuera de las cabezas: sigue en la misma dirección, pero solo se echa hacia atrás
    # suavemente (nunca hacia delante ni más de CAIDA_MAXIMA mm por mm).
    limite = CAIDA_MAXIMA * cuerda
    pend0 = float(np.clip(d0, 0.0, limite))
    pend1 = float(np.clip(-d1, 0.0, limite))
    s0, s1 = float(dentro(0.0)), float(dentro(1.0))

    def avance(tt):
        tt = np.asarray(tt, float)
        return np.where(tt < 0, s0 + pend0 * tt, np.where(tt > 1, s1 - pend1 * (tt - 1), dentro(tt)))

    return avance


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
    return s > _perfil(refs, r)(t) + r.adelanto


def linea_del_arco(refs: Referencias, r: Recorte, mascara: np.ndarray, dx: float, dy: float,
                   n: int = 120, atras: float = 0.0) -> list[tuple[float, float]]:
    """Puntos (x, y) del arco dentro del pie, para dibujarlo."""
    m1 = np.array(refs.puntos["mtt1"], float)
    m5 = np.array(refs.puntos["mtt5"], float)
    e = refs.sistema().eje
    avance = _perfil(refs, r)
    puntos = []
    for t in np.linspace(-0.8, 1.8, n):
        p = m1 + t * (m5 - m1) + e * (float(avance(t)) + r.adelanto - atras)
        i, j = int(round(p[0] / dx)), int(round(p[1] / dy))
        if 0 <= j < mascara.shape[0] and 0 <= i < mascara.shape[1] and mascara[j, i]:
            puntos.append((float(p[0]), float(p[1])))
    return puntos


def aplicar(z: np.ndarray, fondo: float, refs: Referencias, r: Recorte, mascara: np.ndarray,
            X: np.ndarray, Y: np.ndarray, paso: float) -> np.ndarray:
    """Vacía hasta la base lo que está por delante del arco en la zona de este pie, dejando
    delante del arco un bisel de `r.pendiente` mm que baja `r.caida` mm."""
    if not r.activo or not refs.completas:
        return z
    zona_pie = ndimage.binary_dilation(mascara, iterations=int(round(10 / paso)))
    t, s = coordenadas_arco(refs, X, Y)
    limite = _perfil(refs, r)(t) + r.adelanto
    # Fracción de material que queda: 1 detrás del arco, 0 delante, y una transición de una
    # celda justo en el arco para que el borde siga la curva exacta (sin escalera).
    queda = np.clip((limite - s) / paso + 0.5, 0.0, 1.0)
    queda = np.where(zona_pie, queda, 1.0)
    cortado = fondo + (z - fondo) * queda
    if r.pendiente <= 0:
        return cortado
    # Bisel: para cada punto por delante del arco, la altura del molde en el arco a su misma
    # altura t (medida medio mm por detrás), bajando en línea recta `caida` mm hasta `pendiente`
    # mm; allí pared vertical (con la misma transición de una celda). Empieza una celda por
    # detrás del arco para tapar su transición (sin muesca en la línea).
    fin = limite + r.pendiente
    banda = zona_pie & (s > limite - paso) & (s < fin + paso)
    if not banda.any():
        return cortado
    m1 = np.array(refs.puntos["mtt1"], float)
    m5 = np.array(refs.puntos["mtt5"], float)
    e = refs.sistema().eje
    tb, lb = t[banda], limite[banda] - 0.5
    px = m1[0] + tb * (m5[0] - m1[0]) + e[0] * lb
    py = m1[1] + tb * (m5[1] - m1[1]) + e[1] * lb
    filas = (py - Y[0, 0]) / (Y[1, 0] - Y[0, 0])
    cols = (px - X[0, 0]) / (X[0, 1] - X[0, 0])
    borde = ndimage.map_coordinates(z, [filas, cols], order=1, mode="nearest")
    u = np.clip((s[banda] - limite[banda]) / r.pendiente, 0.0, 1.0)
    alto = np.maximum(borde - r.caida * u - fondo, 0.0)
    pared = np.clip((fin[banda] - s[banda]) / paso + 0.5, 0.0, 1.0)
    cortado[banda] = np.maximum(cortado[banda], fondo + alto * pared)
    return cortado
