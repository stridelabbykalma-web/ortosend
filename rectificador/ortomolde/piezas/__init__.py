"""Correcciones clínicas sobre el molde (las «piezas»).

Las alturas se dan pensando en la PLANTILLA, como se prescriben, y aquí se pasan al molde (al revés):

| Pieza                | En la plantilla              | En el molde                        |
|----------------------|------------------------------|------------------------------------|
| Relleno de arco      | rebaja el arco (o lo sube)   | se añade escayola (o se quita)     |
| Oliva retrocapital   | bulto                        | hueco                              |
| Barra metatarsal     | bulto transversal            | hueco                              |
| Descarga 1.er MTT    | hueco bajo la cabeza         | se añade escayola                  |
| Skive medial         | cuña en varo bajo el talón   | se quita escayola del talón medial |

Cada pieza se coloca sola a partir de las referencias del pie (eje talón → punto entre la 2.ª y la 3.ª
cabeza; `SistemaPie`), así que gira con el pie y vale igual para el izquierdo y el derecho. Se puede mover
a mano (`du` a lo largo del pie, `dv` hacia dentro). Los bordes son suaves (sin escalones) y nada sale
del pie.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace

import numpy as np
from scipy import ndimage

from ..referencias import Referencias, _borde

TIPOS = ("arco", "oliva", "barra", "descarga_1mtt", "skive")
NOMBRES = {
    "arco": "Relleno de arco",
    "oliva": "Oliva retrocapital",
    "barra": "Barra metatarsal",
    "descarga_1mtt": "Descarga 1.er MTT",
    "skive": "Skive medial",
}
COLORES = {"arco": "#20c997", "oliva": "#f783ac", "barra": "#da77f2", "descarga_1mtt": "#66d9e8",
           "skive": "#ff922b"}
SENTIDOS = ("rebajar", "subir")  # solo el relleno de arco


@dataclass
class Pieza:
    tipo: str
    activa: bool = False
    altura: float = 3.0  # mm (en la plantilla: altura del bulto o profundidad del hueco)
    largo: float = 20.0  # mm a lo largo del pie (o diámetro)
    ancho: float = 20.0  # mm de lado a lado
    retraso: float = 8.0  # mm por detrás de la línea metatarsal (oliva y barra)
    du: float = 0.0  # mm movida a mano a lo largo del pie (+ hacia los dedos)
    dv: float = 0.0  # mm movida a mano de lado (+ hacia dentro)
    sentido: str = "rebajar"  # relleno de arco: "rebajar" (clásico) o "subir" el arco de la plantilla

    @property
    def nombre(self) -> str:
        return NOMBRES[self.tipo]

    def copia(self) -> "Pieza":
        return replace(self)

    def a_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def de_dict(cls, d: dict) -> "Pieza":
        validos = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**validos)


def por_defecto(clinicos: dict) -> dict[str, Pieza]:
    """Las cinco piezas con los valores de `config/valores_clinicos.toml` (desactivadas)."""
    a = clinicos.get("relleno_arco", {})
    o = clinicos.get("oliva", {})
    b = clinicos.get("barra_metatarsal", {})
    d = clinicos.get("descarga_1mtt", {})
    s = clinicos.get("skive_medial", {})
    return {
        "arco": Pieza("arco", altura=a.get("altura", 3.0), largo=a.get("largo", 70.0), ancho=a.get("ancho", 35.0),
                      sentido=a.get("sentido", "rebajar")),
        "oliva": Pieza("oliva", altura=o.get("altura", 5.0), largo=o.get("largo", 25.0), ancho=o.get("ancho", 20.0),
                       retraso=o.get("retraso", 8.0)),
        "barra": Pieza("barra", altura=b.get("altura", 5.0), largo=b.get("ancho", 20.0),
                       ancho=b.get("margen_lateral", 6.0), retraso=b.get("retraso", 8.0)),
        "descarga_1mtt": Pieza("descarga_1mtt", altura=d.get("profundidad", 2.0), largo=d.get("diametro", 20.0),
                               ancho=d.get("diametro", 20.0)),
        "skive": Pieza("skive", altura=s.get("altura", 4.0), largo=s.get("largo", 45.0)),
    }


def copiar(piezas: dict[str, Pieza]) -> dict[str, Pieza]:
    return {k: p.copia() for k, p in piezas.items()}


# ---------------------------------------------------------------------------
# Formas
# ---------------------------------------------------------------------------

def _campana(t: np.ndarray) -> np.ndarray:
    """1 en el centro (t = 0) → 0 en el borde (t = 1), sin escalón ni arista (coseno)."""
    t = np.clip(t, 0.0, 1.0)
    return 0.5 * (1.0 + np.cos(np.pi * t))


def _rampa(t: np.ndarray) -> np.ndarray:
    """0 → 1 suave entre t = 0 y t = 1."""
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _cabeza_local(sis, refs: Referencias, k: str, m1, m5, fraccion: float):
    """(u, v) de una cabeza; si no está marcada, sobre la línea 1.ª-5.ª a la fracción típica."""
    p = refs.puntos.get(k)
    if p is None:
        p = (m1 + fraccion * (m5 - m1))
    u, v = sis.a_local(p[0], p[1])
    return float(u), float(v)


def centro(pieza: Pieza, refs: Referencias, mascara: np.ndarray, dx: float, dy: float,
           cfg_ref: dict) -> tuple[float, float] | None:
    """Dónde va el centro de la pieza, en (x, y) del molde (para dibujarla y cogerla con el ratón)."""
    g = _geometria_local(pieza, refs, mascara, dx, dy, cfg_ref)
    if g is None:
        return None
    sis, cu, cv = g["sis"], g["cu"], g["cv"]
    x, y = sis.a_global(cu + pieza.du, cv + pieza.dv)
    return float(x), float(y)


def _geometria_local(pieza: Pieza, refs: Referencias, mascara, dx, dy, cfg_ref) -> dict | None:
    if not refs.completas:
        return None
    try:
        sis = refs.sistema()
    except ValueError:
        return None
    m1, m5 = np.array(refs.puntos["mtt1"], float), np.array(refs.puntos["mtt5"], float)
    out = {"sis": sis}
    if pieza.tipo == "arco":
        u0, u1 = cfg_ref.get("arco_inicio", 0.25) * sis.largo, cfg_ref.get("arco_fin", 0.80) * sis.largo
        cu = (u0 + u1) / 2
        p = np.array(sis.a_global(cu, 0))
        cv = _borde(mascara, dx, dy, p, sis.medial) - pieza.ancho / 3
        out.update(cu=cu, cv=cv)
    elif pieza.tipo == "oliva":
        out.update(cu=sis.largo - pieza.retraso, cv=0.0)
    elif pieza.tipo == "barra":
        cabezas = [_cabeza_local(sis, refs, k, m1, m5, f) for k, f in (("mtt2", 0.25), ("mtt3", 0.5), ("mtt4", 0.75))]
        us = [c[0] for c in cabezas]
        vs = [c[1] for c in cabezas]
        out.update(cu=float(np.mean(us)) - pieza.retraso, cv=float(np.mean([max(vs), min(vs)])),
                   medio_ancho=(max(vs) - min(vs)) / 2 + pieza.ancho)
    elif pieza.tipo == "descarga_1mtt":
        u, v = sis.a_local(m1[0], m1[1])
        out.update(cu=float(u), cv=float(v))
    elif pieza.tipo == "skive":
        atras = _borde(mascara, dx, dy, sis.origen, -sis.eje)
        medial = _borde(mascara, dx, dy, sis.origen, sis.medial)
        out.update(cu=-atras + pieza.largo / 2, cv=medial / 2, atras=atras, medial=medial)
    else:
        raise ValueError(f"Pieza desconocida: {pieza.tipo}")
    return out


def cambio_altura(pieza: Pieza, refs: Referencias, mascara: np.ndarray, X: np.ndarray, Y: np.ndarray,
                  dx: float, dy: float, cfg_ref: dict, suavizado_borde: float = 8.0) -> np.ndarray | None:
    """Cuánto sube (+) o baja (−) el MOLDE en cada punto por esta pieza (mm). None si no se puede
    colocar todavía (faltan referencias)."""
    if not pieza.activa or pieza.altura == 0:
        return None
    g = _geometria_local(pieza, refs, mascara, dx, dy, cfg_ref)
    if g is None:
        return None
    sis = g["sis"]
    # Solo se calcula en el recuadro del pie (más rápido).
    jj, ii = np.nonzero(mascara)
    j0, j1, i0, i1 = jj.min(), jj.max() + 1, ii.min(), ii.max() + 1
    u, v = sis.a_local(X[j0:j1, i0:i1], Y[j0:j1, i0:i1])
    u = u - pieza.du
    v = v - pieza.dv
    cu, cv = g["cu"], g["cv"]
    h = pieza.altura
    if pieza.tipo == "arco":
        # Máximo junto al borde interno a mitad del arco; se desvanece hacia el eje y hacia los extremos.
        pu = _campana(np.abs(u - cu) / (pieza.largo / 2))
        pv = _campana(np.abs(v - cv) / (pieza.ancho / 2 + pieza.ancho / 3))
        forma = pu * pv
        signo = 1.0 if pieza.sentido == "rebajar" else -1.0
    elif pieza.tipo == "oliva":
        t = np.hypot((u - cu) / (pieza.largo / 2), (v - cv) / (pieza.ancho / 2))
        forma = _campana(t)
        signo = -1.0
    elif pieza.tipo == "barra":
        pu = _campana(np.abs(u - cu) / (pieza.largo / 2))
        borde = max(suavizado_borde, 1.0)
        pv = 1.0 - _rampa((np.abs(v - cv) - (g["medio_ancho"] - borde)) / borde)
        forma = pu * pv
        signo = -1.0
    elif pieza.tipo == "descarga_1mtt":
        forma = _campana(np.hypot(u - cu, v - cv) / (pieza.largo / 2))
        signo = 1.0
    else:  # skive: cuña, máxima en el borde medial y nada en el eje; se desvanece hacia delante
        medial = max(g["medial"], 1.0)
        pv = np.clip(v / medial, 0.0, None)
        fin = -g["atras"] + pieza.largo
        pu = 1.0 - _rampa((u - (fin - suavizado_borde)) / suavizado_borde)
        forma = pv * pu
        signo = -1.0
    dz = np.zeros(mascara.shape)
    # Bordes suaves en el contorno del pie: se desvanece en los 2 últimos mm hacia dentro (fuera no hay nada).
    #    (El skive no: es un corte en plano que llega hasta el borde medial; fuera del pie ya está la base.)
    if pieza.tipo == "skive":
        dentro = mascara[j0:j1, i0:i1].astype(float)
    else:
        distancia = ndimage.distance_transform_edt(np.pad(mascara[j0:j1, i0:i1], 1), sampling=dx)[1:-1, 1:-1]
        dentro = _rampa(distancia / 2.0)
    dz[j0:j1, i0:i1] = signo * h * forma * dentro
    return dz


def aplicar(z: np.ndarray, fondo: float, refs: Referencias, piezas: dict[str, Pieza], mascara: np.ndarray,
            X: np.ndarray, Y: np.ndarray, dx: float, dy: float, cfg_ref: dict,
            suavizado_borde: float = 8.0) -> np.ndarray:
    """El molde con todas las piezas activas de un pie (nunca por debajo de la base)."""
    total = None
    for p in piezas.values():
        dz = cambio_altura(p, refs, mascara, X, Y, dx, dy, cfg_ref, suavizado_borde)
        if dz is not None:
            total = dz if total is None else total + dz
    if total is None:
        return z
    return np.maximum(z + total, fondo)


def contorno(pieza: Pieza, refs: Referencias, mascara, dx, dy, cfg_ref, n: int = 48) -> list | None:
    """Contorno aproximado de la pieza en (x, y) del molde, para dibujarlo."""
    g = _geometria_local(pieza, refs, mascara, dx, dy, cfg_ref)
    if g is None:
        return None
    sis, cu, cv = g["sis"], g["cu"] + pieza.du, g["cv"] + pieza.dv
    t = np.linspace(0, 2 * np.pi, n)
    if pieza.tipo in ("oliva", "descarga_1mtt"):
        a, b = pieza.largo / 2, (pieza.ancho if pieza.tipo == "oliva" else pieza.largo) / 2
        uu, vv = cu + a * np.cos(t), cv + b * np.sin(t)
    elif pieza.tipo == "arco":
        uu, vv = cu + pieza.largo / 2 * np.cos(t), cv + (pieza.ancho / 2) * np.sin(t)
    elif pieza.tipo == "barra":
        a, b = pieza.largo / 2, g["medio_ancho"]
        uu = np.array([cu - a, cu + a, cu + a, cu - a, cu - a])
        vv = np.array([cv - b, cv - b, cv + b, cv + b, cv - b])
    else:  # skive
        u0, u1 = -g["atras"] + pieza.du, -g["atras"] + pieza.largo + pieza.du
        uu = np.array([u0, u1, u1, u0, u0])
        vv = np.array([0, 0, g["medial"], g["medial"], 0]) + pieza.dv
    x, y = sis.a_global(uu, vv)
    # Solo la parte dentro del pie.
    ny, nx = mascara.shape
    pts = []
    for px, py in zip(np.atleast_1d(x), np.atleast_1d(y)):
        i, j = int(round(px / dx)), int(round(py / dy))
        if 0 <= i < nx and 0 <= j < ny:
            pts.append((float(px), float(py)))
    return pts if len(pts) > 2 else None
