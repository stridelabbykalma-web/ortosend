"""Referencias anatómicas de un pie y el sistema de coordenadas que se deriva de ellas.

El usuario marca 3 puntos sobre el molde: cabeza del 1.er MTT, cabeza del 5.º MTT y talón.
De ahí salen:
  - eje del pie: del talón al punto medio de las dos cabezas;
  - lado interno (medial): el lado del 1.er MTT;
  - línea metatarsal: de la 1.ª a la 5.ª cabeza;
  - zona del arco: lado interno, entre dos fracciones del eje (config);
  - talón interno y externo: bordes del pie a la altura del punto del talón.

Coordenadas locales del pie (u, v) en mm: u a lo largo del eje desde el talón (hacia los
dedos), v hacia el lado interno. Así una pieza definida en (u, v) vale igual para el pie
izquierdo y el derecho (espejo automático).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

NOMBRES = {"mtt1": "Cabeza 1.er MTT", "mtt5": "Cabeza 5.º MTT", "talon": "Talón"}
ORDEN = ("mtt1", "mtt5", "talon")


@dataclass
class Referencias:
    puntos: dict[str, tuple[float, float]] = field(default_factory=dict)  # nombre -> (x, y) en mm

    @property
    def completas(self) -> bool:
        return all(k in self.puntos for k in ORDEN)

    def siguiente(self) -> str | None:
        """La próxima referencia que falta por marcar."""
        return next((k for k in ORDEN if k not in self.puntos), None)

    def a_dict(self) -> dict:
        return {k: [round(float(v[0]), 3), round(float(v[1]), 3)] for k, v in self.puntos.items()}

    @classmethod
    def de_dict(cls, d: dict) -> "Referencias":
        return cls({k: (float(v[0]), float(v[1])) for k, v in d.items()})

    def sistema(self) -> "SistemaPie":
        if not self.completas:
            raise ValueError("Faltan referencias por marcar.")
        return SistemaPie.desde(self)


@dataclass(frozen=True)
class SistemaPie:
    origen: np.ndarray  # talón
    eje: np.ndarray  # unitario, hacia los dedos
    medial: np.ndarray  # unitario, hacia el lado interno
    largo: float  # talón -> punto medio de las cabezas

    @classmethod
    def desde(cls, r: Referencias) -> "SistemaPie":
        t = np.array(r.puntos["talon"], float)
        m1, m5 = np.array(r.puntos["mtt1"], float), np.array(r.puntos["mtt5"], float)
        medio = (m1 + m5) / 2
        eje = medio - t
        largo = float(np.linalg.norm(eje))
        if largo < 50:
            raise ValueError("El talón está demasiado cerca de las cabezas metatarsales: revisa las referencias.")
        eje /= largo
        perp = np.array([-eje[1], eje[0]])
        medial = perp if (m1 - t) @ perp >= 0 else -perp
        return cls(t, eje, medial, largo)

    def a_local(self, x, y):
        dx, dy = np.asarray(x) - self.origen[0], np.asarray(y) - self.origen[1]
        return dx * self.eje[0] + dy * self.eje[1], dx * self.medial[0] + dy * self.medial[1]

    def a_global(self, u, v):
        u, v = np.asarray(u), np.asarray(v)
        return (self.origen[0] + u * self.eje[0] + v * self.medial[0],
                self.origen[1] + u * self.eje[1] + v * self.medial[1])


def _borde(mascara: np.ndarray, dx: float, dy: float, p: np.ndarray, d: np.ndarray, maximo: float = 120.0) -> float:
    """Distancia desde p en dirección d hasta salir de la máscara del pie."""
    ny, nx = mascara.shape
    paso = min(dx, dy)
    for k in range(int(maximo / paso)):
        x, y = p + d * k * paso
        i, j = int(round(x / dx)), int(round(y / dy))
        if not (0 <= i < nx and 0 <= j < ny) or not mascara[j, i]:
            return k * paso
    return maximo


def geometria(r: Referencias, mascara: np.ndarray, dx: float, dy: float, cfg: dict) -> dict:
    """Líneas y zonas derivadas de las referencias, en coordenadas (x, y) del molde."""
    s = r.sistema()
    m1, m5 = np.array(r.puntos["mtt1"], float), np.array(r.puntos["mtt5"], float)
    # Eje: desde el borde trasero del talón hasta algo más allá de las cabezas.
    atras = _borde(mascara, dx, dy, s.origen, -s.eje)
    eje = [s.a_global(-atras, 0), s.a_global(s.largo * 1.25, 0)]
    # Talón interno / externo.
    t_med = s.origen + s.medial * _borde(mascara, dx, dy, s.origen, s.medial)
    t_lat = s.origen - s.medial * _borde(mascara, dx, dy, s.origen, -s.medial)
    # Zona del arco: del eje al borde interno, entre las dos fracciones.
    us = np.linspace(cfg["arco_inicio"], cfg["arco_fin"], 25) * s.largo
    borde = []
    for u in us:
        p = np.array(s.a_global(u, 0))
        borde.append(s.a_global(u, _borde(mascara, dx, dy, p, s.medial)))
    zona = [s.a_global(us[0], 0)] + borde + [s.a_global(us[-1], 0)]
    return {
        "eje": [tuple(map(float, p)) for p in eje],
        "linea_metatarsal": [tuple(m1), tuple(m5)],
        "talon_medial": tuple(map(float, t_med)),
        "talon_lateral": tuple(map(float, t_lat)),
        "zona_arco": [tuple(map(float, p)) for p in zona],
    }
