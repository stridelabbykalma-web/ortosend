"""Referencias anatómicas de un pie y el sistema de coordenadas que se deriva de ellas.

El usuario marca sobre el molde: cabeza del 1.er MTT, cabeza del 5.º MTT y talón
(obligatorias) y, si quiere, las cabezas del 2.º, 3.º y 4.º MTT (el recorte en arco pasa
entonces por delante de todas). De ahí salen:
  - eje del pie: del talón al punto medio entre la 2.ª y la 3.ª cabeza (si no están
    marcadas, a la altura donde suelen estar, sobre la línea 1.ª-5.ª);
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

NOMBRES = {
    "mtt1": "Cabeza 1.er MTT", "mtt2": "Cabeza 2.º MTT", "mtt3": "Cabeza 3.er MTT",
    "mtt4": "Cabeza 4.º MTT", "mtt5": "Cabeza 5.º MTT", "talon": "Talón",
}
OBLIGATORIAS = ("mtt1", "mtt5", "talon")
OPCIONALES = ("mtt2", "mtt3", "mtt4")
ORDEN = ("mtt1", "mtt2", "mtt3", "mtt4", "mtt5", "talon")  # orden en pantalla
ORDEN_CLIC = OBLIGATORIAS + OPCIONALES  # orden al marcar con clic: primero las obligatorias
CABEZAS = ("mtt1", "mtt2", "mtt3", "mtt4", "mtt5")
# Sin 2.ª y 3.ª cabeza marcadas: el eje sale de la línea 1.ª->5.ª a esta fracción (0 = 1.ª, 1 = 5.ª).
# Se ajusta desde config/valores_clinicos.toml ([referencias] eje_sin_2_3) al abrir un proyecto.
EJE_SIN_2_3 = 0.375


@dataclass
class Referencias:
    puntos: dict[str, tuple[float, float]] = field(default_factory=dict)  # nombre -> (x, y) en mm

    @property
    def completas(self) -> bool:
        """Están las obligatorias (1.er MTT, 5.º MTT y talón)."""
        return all(k in self.puntos for k in OBLIGATORIAS)

    def siguiente(self) -> str | None:
        """La próxima referencia que falta por marcar."""
        return next((k for k in ORDEN_CLIC if k not in self.puntos), None)

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
    largo: float  # talón -> punto delantero del eje (entre 2.ª y 3.ª cabeza)

    @classmethod
    def desde(cls, r: Referencias) -> "SistemaPie":
        t = np.array(r.puntos["talon"], float)
        m1, m5 = np.array(r.puntos["mtt1"], float), np.array(r.puntos["mtt5"], float)
        if "mtt2" in r.puntos and "mtt3" in r.puntos:
            delante = (np.array(r.puntos["mtt2"], float) + np.array(r.puntos["mtt3"], float)) / 2
        else:
            delante = m1 + EJE_SIN_2_3 * (m5 - m1)
        eje = delante - t
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
    # Eje: desde el borde trasero del talón hasta el punto entre la 2.ª y la 3.ª cabeza.
    atras = _borde(mascara, dx, dy, s.origen, -s.eje)
    eje = [s.a_global(-atras, 0), s.a_global(s.largo, 0)]
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


def proponer(mascara: np.ndarray, lado: str, dx: float, dy: float, cfg: dict,
             altura: np.ndarray | None = None) -> Referencias:
    """Referencias APROXIMADAS para empezar (el usuario las corrige). Molde con la planta
    hacia arriba y dedos hacia +Y.

    - Talón: centro del pie a `propuesta_talon` del largo.
    - Cabezas metatarsales: se trazan 5 líneas a lo largo del antepié (repartidas de dentro
      a fuera) y en cada una se busca dónde se hundió más el pie en la espuma (lo más alto
      del molde) dentro de la franja de las cabezas. Así se respeta la fórmula metatarsal
      de cada paciente. Si no hay altura o no se ve un máximo claro, se usan proporciones típicas.
    """
    jj, ii = np.nonzero(mascara)
    pts = np.column_stack([ii * dx, jj * dy])
    centro = pts.mean(axis=0)
    # Eje largo del pie (componente principal), hacia los dedos (+Y).
    _, _, vt = np.linalg.svd(pts - centro, full_matrices=False)
    eje = vt[0] if vt[0][1] > 0 else -vt[0]
    perp = np.array([-eje[1], eje[0]])
    # Pie izquierdo con la planta hacia arriba: lado interno hacia -X.
    medial = perp if (perp[0] < 0) == (lado == "izquierdo") else -perp
    u = (pts - centro) @ eje
    u0, largo = u.min(), u.max() - u.min()
    sh = altura is not None
    if sh:
        from scipy import ndimage
        alt = ndimage.gaussian_filter(altura, 3.0 / dx)

    def valor(p):
        i, j = int(round(p[0] / dx)), int(round(p[1] / dy))
        if not (0 <= j < mascara.shape[0] and 0 <= i < mascara.shape[1]) or not mascara[j, i]:
            return None
        return alt[j, i] if sh else 1.0

    def bordes(uf):
        """Extremos interno y externo (v) de la parte alta de la planta a la altura uf."""
        base = centro + (u0 + uf * largo) * eje
        vs = np.arange(-90.0, 90.0, 0.5)
        vals = [valor(base + v * medial) for v in vs]
        ok = np.array([x is not None for x in vals])
        h = np.array([x if x is not None else -np.inf for x in vals])
        if sh and ok.any():
            hmin = h[ok].min()
            ok &= h > hmin + 0.7 * (h[ok].max() - hmin)
        vv = vs[ok]
        return base, vv.max(), vv.min()  # (punto del eje, v interno, v externo)

    base, vi, ve = bordes(cfg["propuesta_talon"])
    talon = base + medial * (vi + ve) / 2
    puntos = {"talon": (float(talon[0]), float(talon[1]))}

    # Proporciones típicas (de dentro a fuera) si no se encuentra un máximo claro.
    tipicas = np.linspace(cfg["propuesta_mtt1"], cfg["propuesta_mtt5"], 5)
    base, vi, ve = bordes((cfg["propuesta_mtt1"] + cfg["propuesta_mtt5"]) / 2)
    ancho = vi - ve
    fr_int = cfg["propuesta_mtt1_borde"] / ancho
    fr_ext = 1 - cfg["propuesta_mtt5_borde"] / ancho
    for k, nombre in enumerate(CABEZAS):
        v = vi - (fr_int + (fr_ext - fr_int) * k / 4) * ancho
        uf = tipicas[k]
        if sh:
            us = np.arange(0.55, 0.80, 0.0025)
            perfil = []
            for f in us:
                x = valor(centro + (u0 + f * largo) * eje + v * medial)
                perfil.append(-np.inf if x is None else x)
            perfil = np.array(perfil)
            m = int(np.argmax(perfil))
            if 0 < m < len(us) - 1 and np.isfinite(perfil[m]):
                uf = us[m]
        p = centro + (u0 + uf * largo) * eje + v * medial
        puntos[nombre] = (float(p[0]), float(p[1]))
    return Referencias(puntos)
