"""Correcciones clínicas sobre el molde (las «piezas»).

Las alturas se dan pensando en la PLANTILLA, como se prescriben, y aquí se pasan al molde (al revés):

| Pieza                    | En la plantilla                     | En el molde                               |
|--------------------------|-------------------------------------|-------------------------------------------|
| Relleno de arco          | rebaja el arco (o lo sube)          | se añade escayola (o se quita)            |
| Oliva retrocapital       | bulto                               | hueco                                     |
| Barra metatarsal         | bulto transversal (1.ª a 5.ª)       | hueco, curvado como el recorte            |
| Descargas (1.º, 5.º MTT, | hueco                               | se añade escayola                         |
|   sesamoideos, espolón)  |                                     |                                           |
| Cuña anterior            | antepié en varo o valgo (grados)    | se quita escayola del lado que sube       |
| Soporte navicular/cuboid.| bulto bajo el hueso                 | hueco                                     |
| Canal fascia plantar     | surco del talón a la 1.ª cabeza     | tira de escayola añadida                  |
| Skive (Kirby)            | varo o valgo en la cazoleta         | corte en plano a 15° (2-6 mm en W/3)      |
| Cuña posterior           | retropié supinador/pronador (grados)| se quita escayola del lado que sube       |
| Alza de talón            | talón más alto                      | se quita escayola bajo el talón (rampa)   |
| Expansión de talón       | más sitio al talón (+ % de ancho)   | se añade escayola en la periferia         |

Cada pieza se coloca sola a partir de las referencias del pie (eje talón → punto entre la 2.ª y la 3.ª
cabeza; `SistemaPie`), así que gira con el pie y vale igual para el izquierdo y el derecho. Se puede mover
a mano (`du` a lo largo del pie, `dv` hacia dentro). Los bordes son suaves (sin escalones) y nada sale
del pie.

Con `adaptar` (por defecto), el largo y el ancho guardados son los de un pie medio (`pie_medio` mm del talón
a las cabezas) y se escalan con el pie: más pequeñas en un pie pequeño, más grandes en uno grande. La altura
no cambia nunca (es la prescripción).

El skive sigue la técnica de Kirby (JAPMA 1992; ProLab 2023): se corta en un plano inclinado `angulo` (15°)
en el plano frontal, que en la línea a 1/3 del ancho del talón (desde medial, o desde lateral en valgo) queda
`altura` mm (2, 4 o 6) por debajo de la superficie; va desde atrás hasta el borde anterior de la cazoleta.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace

import numpy as np
from scipy import ndimage

from .. import recorte as recorte_mod
from ..recorte import Recorte
from ..referencias import Referencias, _borde

TIPOS = ("oliva", "barra", "descarga_1mtt", "descarga_sesamoideos", "descarga_5mtt", "cuna_ant",
         "arco", "navicular", "cuboides", "canal_fascia",
         "skive", "cuna_post", "alza", "expansion_talon", "espolon")
ZONAS = {"Antepié": TIPOS[:6], "Mediopié": TIPOS[6:10], "Retropié": TIPOS[10:]}
NOMBRES = {
    "arco": "Relleno de arco",
    "oliva": "Oliva retrocapital",
    "barra": "Barra metatarsal",
    "descarga_1mtt": "Descarga 1.er MTT",
    "descarga_sesamoideos": "Descarga sesamoideos",
    "descarga_5mtt": "Descarga 5.º MTT",
    "cuna_ant": "Cuña anterior",
    "navicular": "Soporte navicular",
    "cuboides": "Soporte cuboides",
    "canal_fascia": "Canal fascia plantar",
    "skive": "Skive (Kirby)",
    "cuna_post": "Cuña posterior",
    "alza": "Alza de talón",
    "expansion_talon": "Expansión de talón",
    "espolon": "Descarga espolón",
}
COLORES = {"arco": "#20c997", "oliva": "#f783ac", "barra": "#da77f2", "descarga_1mtt": "#66d9e8",
           "descarga_sesamoideos": "#4dabf7", "descarga_5mtt": "#3bc9db", "cuna_ant": "#ffd43b",
           "navicular": "#94d82d", "cuboides": "#69db7c", "canal_fascia": "#748ffc",
           "skive": "#ff922b", "cuna_post": "#fab005", "alza": "#e599f7", "expansion_talon": "#ffa8a8",
           "espolon": "#99e9f2"}
# Opciones de sentido de cada pieza (valor, texto); la primera es la de por defecto.
SENTIDOS = {
    "arco": (("rebajar", "Rebajar arco"), ("subir", "Subir arco")),
    "skive": (("varo", "Varo · medial"), ("valgo", "Valgo · lateral")),
    "cuna_post": (("varo", "Supinadora (varo)"), ("valgo", "Pronadora (valgo)")),
    "cuna_ant": (("varo", "Varo"), ("valgo", "Valgo")),
}
# Qué es la «altura» de cada pieza: (unidad, mínimo, máximo, paso).
UNIDAD_ALTURA = {"cuna_ant": ("°", 0.0, 20.0, 1.0), "cuna_post": ("°", 0.0, 20.0, 1.0),
                 "expansion_talon": ("%", 0.0, 25.0, 1.0)}
_CORTES = ("skive", "cuna_post", "cuna_ant", "alza", "expansion_talon")  # llegan al borde del pie


@dataclass
class Pieza:
    tipo: str
    activa: bool = False
    altura: float = 3.0  # mm (en la plantilla: altura del bulto o profundidad del hueco); ° en las cuñas
    largo: float = 20.0  # mm a lo largo del pie (o diámetro)
    ancho: float = 20.0  # mm de lado a lado
    retraso: float = 8.0  # mm por detrás de la línea metatarsal (oliva y barra)
    du: float = 0.0  # mm movida a mano a lo largo del pie (+ hacia los dedos)
    dv: float = 0.0  # mm movida a mano de lado (+ hacia dentro)
    sentido: str = "rebajar"  # ver SENTIDOS
    adaptar: bool = True  # largo y ancho para un pie medio, escalados a la medida de este pie
    angulo: float = 15.0  # skive: inclinación del plano de corte en el plano frontal (°)

    @property
    def nombre(self) -> str:
        return NOMBRES[self.tipo]

    @property
    def valgo(self) -> bool:
        return self.sentido == "valgo"

    def copia(self) -> "Pieza":
        return replace(self)

    def a_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def de_dict(cls, d: dict) -> "Pieza":
        validos = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        validos.setdefault("adaptar", False)  # trabajos guardados antes de existir: que salgan igual
        if validos.get("tipo") in SENTIDOS and validos.get("sentido") not in dict(SENTIDOS[validos["tipo"]]):
            validos["sentido"] = SENTIDOS[validos["tipo"]][0][0]
        return cls(**validos)

    def medidas(self, escala_pie: float) -> tuple[float, float]:
        """(largo, ancho) en mm para este pie."""
        f = escala_pie if self.adaptar else 1.0
        return self.largo * f, self.ancho * f


def escala(refs: Referencias, cfg_ref: dict) -> float:
    """Tamaño de este pie respecto a un pie medio (1 = medio). 1 si faltan referencias."""
    try:
        largo = refs.sistema().largo
    except ValueError:
        return 1.0
    f = largo / cfg_ref.get("pie_medio", 175.0)
    return float(np.clip(f, cfg_ref.get("escala_minima", 0.6), cfg_ref.get("escala_maxima", 1.4)))


def por_defecto(clinicos: dict) -> dict[str, Pieza]:
    """Todas las piezas con los valores de `config/valores_clinicos.toml` (desactivadas)."""
    def c(seccion):
        return clinicos.get(seccion, {})
    a, o, b = c("relleno_arco"), c("oliva"), c("barra_metatarsal")
    s = c("skive") or c("skive_medial")
    piezas = {
        "arco": Pieza("arco", altura=a.get("altura", 3.0), largo=a.get("largo", 70.0), ancho=a.get("ancho", 35.0),
                      sentido=a.get("sentido", "rebajar")),
        "oliva": Pieza("oliva", altura=o.get("altura", 5.0), largo=o.get("largo", 25.0), ancho=o.get("ancho", 20.0),
                       retraso=o.get("retraso", 8.0)),
        "barra": Pieza("barra", altura=b.get("altura", 5.0), largo=b.get("ancho", 20.0), retraso=b.get("retraso", 8.0)),
        "skive": Pieza("skive", altura=s.get("altura", 4.0), largo=s.get("largo", 55.0),
                       sentido=s.get("sentido", "varo"), angulo=s.get("angulo", 15.0)),
    }
    for tipo, seccion, alto, largo, ancho in (
            ("descarga_1mtt", "descarga_1mtt", 2.0, 20.0, None),
            ("descarga_5mtt", "descarga_5mtt", 2.0, 20.0, None),
            ("espolon", "descarga_espolon", 3.0, 25.0, None),
            ("descarga_sesamoideos", "descarga_sesamoideos", 2.0, 22.0, 16.0),
            ("navicular", "soporte_navicular", 3.0, 30.0, 22.0),
            ("cuboides", "soporte_cuboides", 3.0, 30.0, 22.0)):
        d = c(seccion)
        diam = d.get("diametro", largo)
        piezas[tipo] = Pieza(tipo, altura=d.get("profundidad", d.get("altura", alto)), largo=d.get("largo", diam),
                             ancho=d.get("ancho", ancho if ancho is not None else diam))
    f, cp, ca = c("canal_fascia"), c("cuna_posterior"), c("cuna_anterior")
    al, ex = c("alza_talon"), c("expansion_talon")
    piezas.update({
        "canal_fascia": Pieza("canal_fascia", altura=f.get("profundidad", 4.0), ancho=f.get("ancho", 15.0)),
        "cuna_post": Pieza("cuna_post", altura=cp.get("grados", 4.0), largo=cp.get("largo", 60.0),
                           sentido=cp.get("sentido", "varo")),
        "cuna_ant": Pieza("cuna_ant", altura=ca.get("grados", 4.0), largo=ca.get("largo", 45.0),
                          sentido=ca.get("sentido", "varo")),
        "alza": Pieza("alza", altura=al.get("altura", 5.0), largo=al.get("largo", 120.0)),
        "expansion_talon": Pieza("expansion_talon", altura=ex.get("porcentaje", 10.0), largo=ex.get("largo", 60.0)),
    })
    return {t: piezas[t] for t in TIPOS}


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


def _min_suave(x: np.ndarray, k: float = 1.0) -> np.ndarray:
    """≈ min(x, 0) con la esquina redondeada (radio ~k mm): el corte no deja arista."""
    return (x - np.sqrt(x * x + k * k)) / 2


def centro(pieza: Pieza, refs: Referencias, mascara: np.ndarray, dx: float, dy: float,
           cfg_ref: dict, recorte: Recorte | None = None) -> tuple[float, float] | None:
    """Dónde va el centro de la pieza, en (x, y) del molde (para dibujarla y cogerla con el ratón)."""
    g = _geometria_local(pieza, refs, mascara, dx, dy, cfg_ref, recorte)
    if g is None:
        return None
    sis, cu, cv = g["sis"], g["cu"], g["cv"]
    x, y = sis.a_global(cu + pieza.du, cv + pieza.dv)
    return float(x), float(y)


def _anchos(sis, mascara, dx, dy, u: float) -> tuple[float, float]:
    """(hasta el borde medial, hasta el borde lateral) en mm, a la altura `u` del eje."""
    p = np.array(sis.a_global(u, 0.0), float)
    return _borde(mascara, dx, dy, p, sis.medial), _borde(mascara, dx, dy, p, -sis.medial)


def _geometria_local(pieza: Pieza, refs: Referencias, mascara, dx, dy, cfg_ref,
                     recorte: Recorte | None = None) -> dict | None:
    if not refs.completas:
        return None
    try:
        sis = refs.sistema()
    except ValueError:
        return None
    m1, m5 = np.array(refs.puntos["mtt1"], float), np.array(refs.puntos["mtt5"], float)
    largo, ancho = pieza.medidas(escala(refs, cfg_ref))
    L = sis.largo
    out = {"sis": sis, "largo": largo, "ancho": ancho}
    tipo = pieza.tipo
    if tipo in ("skive", "cuna_post", "alza", "expansion_talon", "espolon", "canal_fascia"):
        atras = _borde(mascara, dx, dy, sis.origen, -sis.eje)
        med, lat = _anchos(sis, mascara, dx, dy, 0.0)
        out.update(atras=atras, med=med, lat=lat, W=med + lat)
    if tipo == "arco":
        u0, u1 = cfg_ref.get("arco_inicio", 0.25) * L, cfg_ref.get("arco_fin", 0.80) * L
        cu = (u0 + u1) / 2
        p = np.array(sis.a_global(cu, 0))
        cv = _borde(mascara, dx, dy, p, sis.medial) - ancho / 3
        out.update(cu=cu, cv=cv)
    elif tipo == "oliva":
        out.update(cu=L - pieza.retraso, cv=0.0)
    elif tipo == "barra":
        # Banda de borde a borde del pie, paralela al arco de las cabezas (la misma curva que el recorte),
        # `retraso` mm por detrás. El cuadradito va en medio (t = 0,5).
        perfil = recorte_mod._perfil(refs, recorte or Recorte())
        medio = m1 + 0.5 * (m5 - m1) + sis.eje * (float(perfil(0.5)) - pieza.retraso)
        cu, cv = sis.a_local(medio[0], medio[1])
        out.update(cu=float(cu), cv=float(cv), perfil=perfil)
    elif tipo in ("descarga_1mtt", "descarga_5mtt", "descarga_sesamoideos"):
        u, v = sis.a_local(*(m5 if tipo == "descarga_5mtt" else m1))
        # Los sesamoideos quedan bajo la cabeza del 1.er MTT, un poco por detrás.
        out.update(cu=float(u) - (4.0 if tipo == "descarga_sesamoideos" else 0.0), cv=float(v))
    elif tipo == "navicular":
        u = 0.52 * L
        med, _ = _anchos(sis, mascara, dx, dy, u)
        out.update(cu=u, cv=med - ancho / 2)
    elif tipo == "cuboides":
        u = 0.45 * L
        _, lat = _anchos(sis, mascara, dx, dy, u)
        out.update(cu=u, cv=-lat + ancho / 2)
    elif tipo == "cuna_ant":
        med, lat = _anchos(sis, mascara, dx, dy, L)
        out.update(cu=L - largo / 2, cv=0.0, inicio=L - largo, med=med, lat=lat)
    elif tipo == "espolon":
        # Tubérculo medial del calcáneo: talón plantar, algo por delante del centro y hacia dentro.
        out.update(cu=5.0, cv=out["W"] / 6)
    elif tipo == "canal_fascia":
        # Del tubérculo medial del calcáneo a ~10 mm por detrás de la 1.ª articulación MTF.
        a = np.array([5.0, out["W"] / 6])
        u1, v1 = sis.a_local(*m1)
        b = np.array([float(u1) - 10.0, float(v1)])
        out.update(a=a, b=b, cu=float((a[0] + b[0]) / 2), cv=float((a[1] + b[1]) / 2))
    elif tipo == "skive":
        # Línea de referencia a 1/3 del ancho del talón desde el borde (medial en varo, lateral en valgo).
        W = out["W"]
        vref = -out["lat"] + W / 3 if pieza.valgo else out["med"] - W / 3
        out.update(cu=-out["atras"] + largo / 2, cv=vref, vref=vref)
    elif tipo in ("cuna_post", "alza"):
        out.update(cu=-out["atras"] + largo / 2, cv=0.0)
    elif tipo == "expansion_talon":
        out.update(cu=0.0, cv=0.0)
    else:
        raise ValueError(f"Pieza desconocida: {tipo}")
    return out


def _hacia_delante(u, fin: float, rampa: float) -> np.ndarray:
    """1 hasta `fin − rampa` y baja suave a 0 en `fin`."""
    return 1.0 - _rampa((u - (fin - rampa)) / max(rampa, 1e-6))


def cambio_altura(pieza: Pieza, refs: Referencias, mascara: np.ndarray, X: np.ndarray, Y: np.ndarray,
                  dx: float, dy: float, cfg_ref: dict, suavizado_borde: float = 8.0,
                  recorte: Recorte | None = None, z: np.ndarray | None = None) -> np.ndarray | None:
    """Cuánto sube (+) o baja (−) el MOLDE en cada punto por esta pieza (mm). None si no se puede
    colocar todavía (faltan referencias). El skive y la expansión de talón necesitan el molde (`z`)."""
    if not pieza.activa or pieza.altura == 0:
        return None
    if pieza.tipo in ("skive", "expansion_talon") and z is None:
        return None
    g = _geometria_local(pieza, refs, mascara, dx, dy, cfg_ref, recorte)
    if g is None:
        return None
    sis = g["sis"]
    # Solo se calcula en el recuadro del pie (más rápido).
    jj, ii = np.nonzero(mascara)
    j0, j1, i0, i1 = jj.min(), jj.max() + 1, ii.min(), ii.max() + 1
    u, v = sis.a_local(X[j0:j1, i0:i1], Y[j0:j1, i0:i1])
    u = u - pieza.du
    v = v - pieza.dv
    zz = z[j0:j1, i0:i1] if z is not None else None
    cu, cv, largo, ancho = g["cu"], g["cv"], g["largo"], g["ancho"]
    h = pieza.altura
    tipo = pieza.tipo
    if tipo == "arco":
        # Máximo junto al borde interno a mitad del arco; se desvanece hacia el eje y hacia los extremos.
        pu = _campana(np.abs(u - cu) / (largo / 2))
        pv = _campana(np.abs(v - cv) / (ancho / 2 + ancho / 3))
        dz = (1.0 if pieza.sentido == "rebajar" else -1.0) * h * pu * pv
    elif tipo in ("oliva", "navicular", "cuboides", "descarga_sesamoideos"):
        forma = _campana(np.hypot((u - cu) / (largo / 2), (v - cv) / (ancho / 2)))
        dz = (1.0 if tipo == "descarga_sesamoideos" else -1.0) * h * forma
    elif tipo == "barra":
        # Misma altura de lado a lado; a lo largo del pie, campana centrada en la curva del arco − retraso.
        xs, ys = sis.a_global(u, v)  # ya movida a mano
        tt, ss = recorte_mod.coordenadas_arco(refs, xs, ys)
        dz = -h * _campana(np.abs(ss - (g["perfil"](tt) - pieza.retraso)) / (largo / 2))
    elif tipo in ("descarga_1mtt", "descarga_5mtt", "espolon"):
        dz = h * _campana(np.hypot(u - cu, v - cv) / (largo / 2))
    elif tipo == "canal_fascia":
        a, b = g["a"], g["b"]
        ab = b - a
        n = float(np.hypot(*ab))
        s = ((u - a[0]) * ab[0] + (v - a[1]) * ab[1]) / n  # mm a lo largo del canal
        d = np.abs((u - a[0]) * ab[1] - (v - a[1]) * ab[0]) / n  # mm al eje del canal
        extremos = _rampa(s / 10.0) * _rampa((n - s) / 10.0)
        dz = h * _campana(d / (ancho / 2)) * extremos
    elif tipo == "skive":
        # Plano inclinado `angulo` en el plano frontal, `h` mm por debajo de la superficie en la línea W/3
        # (varo: más hondo hacia medial; valgo, hacia lateral). Se sigue la forma del talón a lo largo del pie.
        vref = g["vref"]
        inicio, fin = -g["atras"], -g["atras"] + largo
        us = np.linspace(inicio - 5, fin, 64)
        xs, ys = sis.a_global(us + pieza.du, np.full_like(us, vref + pieza.dv))  # donde está ahora
        zref = ndimage.map_coordinates(z, [ys / dy, xs / dx], order=1, mode="nearest")
        # En la pared de atrás la superficie cae hasta la base: ahí se toma la altura de algo más adelante
        # (si no, el plano bajaría con la pared y cortaría de más el borde posterior).
        zref = np.where(us < inicio + 12.0, np.interp(inicio + 12.0, us, zref), zref)
        zref = ndimage.gaussian_filter1d(zref, 2.0)
        zr = np.interp(u, us, zref)
        lado = -1.0 if pieza.valgo else 1.0
        plano = zr - h - np.tan(np.radians(pieza.angulo)) * lado * (v - vref)
        dz = _min_suave(plano - zz, 1.0) * _hacia_delante(u, fin, min(10.0, largo / 3))
    elif tipo in ("cuna_post", "cuna_ant"):
        # Cuña intrínseca: el plano gira sobre el borde que no se toca (varo: gira sobre el lateral).
        tan = np.tan(np.radians(h))
        dist = np.clip(g["med"] - v, 0.0, None) if pieza.valgo else np.clip(v + g["lat"], 0.0, None)
        if tipo == "cuna_post":
            fin = -g["atras"] + largo
            zona = _hacia_delante(u, fin, min(20.0, largo / 2))
        else:
            zona = _rampa((u - g["inicio"]) / min(15.0, largo / 2))
        dz = -tan * dist * zona
    elif tipo == "alza":
        # Igual bajo el talón y rampa suave hasta el final.
        fin = -g["atras"] + largo
        dz = -h * _hacia_delante(u, fin, 0.6 * largo)
    elif tipo == "expansion_talon":
        # El talón se ensancha `h` % (la mitad a cada lado): la pared se desplaza `e` mm hacia fuera. Cada
        # punto toma la altura del que está `e` mm más hacia dentro del pie (en lo plano no cambia nada).
        e = g["W"] * h / 200.0
        dist = ndimage.distance_transform_edt(np.pad(mascara[j0:j1, i0:i1], 1), sampling=dx)[1:-1, 1:-1]
        gy, gx = np.gradient(ndimage.gaussian_filter(dist, 2.0))
        n = np.hypot(gx, gy) + 1e-9
        filas, cols = np.mgrid[0:dist.shape[0], 0:dist.shape[1]]
        desplazado = ndimage.map_coordinates(zz, [filas + e / dy * gy / n, cols + e / dx * gx / n],
                                             order=1, mode="nearest")
        # Solo en la pared (en la planta del talón no se toca) y, junto al borde de la huella, se va quitando
        # para que no quede un escalón.
        pared = _rampa((np.hypot(*np.gradient(zz, dy, dx)) - 0.3) / 0.7)
        dz = (np.clip(desplazado - zz, 0.0, None) * pared
              * _hacia_delante(u, -g["atras"] + largo, min(20.0, largo / 2)) * _rampa(dist / (e + 3.0)))
    else:
        raise ValueError(f"Pieza desconocida: {tipo}")
    salida = np.zeros(mascara.shape)
    # Bordes suaves en el contorno del pie: se desvanece en los 2 últimos mm hacia dentro (fuera no hay nada).
    #    Los cortes (skive, cuñas, alza, expansión) llegan hasta el borde: fuera del pie ya está la base.
    #    La barra va de borde a borde: se desvanece en `suavizado_borde` mm para no dejar escalón.
    if tipo in _CORTES:
        dentro = mascara[j0:j1, i0:i1].astype(float)
    else:
        distancia = ndimage.distance_transform_edt(np.pad(mascara[j0:j1, i0:i1], 1), sampling=dx)[1:-1, 1:-1]
        dentro = _rampa(distancia / (max(suavizado_borde, 2.0) if tipo == "barra" else 2.0))
    salida[j0:j1, i0:i1] = dz * dentro
    return salida


def aplicar(z: np.ndarray, fondo: float, refs: Referencias, piezas: dict[str, Pieza], mascara: np.ndarray,
            X: np.ndarray, Y: np.ndarray, dx: float, dy: float, cfg_ref: dict,
            suavizado_borde: float = 8.0, recorte: Recorte | None = None) -> np.ndarray:
    """El molde con todas las piezas activas de un pie (nunca por debajo de la base)."""
    total = None
    for p in piezas.values():
        dz = cambio_altura(p, refs, mascara, X, Y, dx, dy, cfg_ref, suavizado_borde, recorte, z)
        if dz is not None:
            total = dz if total is None else total + dz
    if total is None:
        return z
    return np.maximum(z + total, fondo)


def _dentro_del_pie(x, y, mascara, dx, dy, cerrar: bool = False) -> list | None:
    ny, nx = mascara.shape
    x, y = np.atleast_1d(x), np.atleast_1d(y)
    i = np.clip(np.round(x / dx).astype(int), 0, nx - 1)
    j = np.clip(np.round(y / dy).astype(int), 0, ny - 1)
    ok = mascara[j, i] & (x >= 0) & (y >= 0)
    pts = [(float(a), float(b)) for a, b in zip(x[ok], y[ok])]
    if len(pts) <= 2:
        return None
    return pts + pts[:1] if cerrar else pts


def _rectangulo(u0, u1, v0, v1, n):
    """Contorno de un rectángulo en coordenadas del pie, con muchos puntos (para recortarlo al pie)."""
    a = np.linspace(0, 1, n)
    uu = np.concatenate([u0 + (u1 - u0) * a, np.full(n, u1), u1 - (u1 - u0) * a, np.full(n, u0)])
    vv = np.concatenate([np.full(n, v0), v0 + (v1 - v0) * a, np.full(n, v1), v1 - (v1 - v0) * a])
    return uu, vv


def contorno(pieza: Pieza, refs: Referencias, mascara, dx, dy, cfg_ref, n: int = 48,
             recorte: Recorte | None = None) -> list | None:
    """Contorno aproximado de la pieza en (x, y) del molde, para dibujarlo."""
    g = _geometria_local(pieza, refs, mascara, dx, dy, cfg_ref, recorte)
    if g is None:
        return None
    sis, cu, cv = g["sis"], g["cu"] + pieza.du, g["cv"] + pieza.dv
    largo, ancho = g["largo"], g["ancho"]
    tipo = pieza.tipo
    t = np.linspace(0, 2 * np.pi, n)
    if tipo in ("oliva", "navicular", "cuboides", "descarga_sesamoideos", "arco"):
        uu, vv = cu + largo / 2 * np.cos(t), cv + ancho / 2 * np.sin(t)
    elif tipo in ("descarga_1mtt", "descarga_5mtt", "espolon"):
        uu, vv = cu + largo / 2 * np.cos(t), cv + largo / 2 * np.sin(t)
    elif tipo == "barra":
        # Las dos orillas de la banda (solo lo que cae dentro del pie), cerradas.
        m1, m5 = np.array(refs.puntos["mtt1"], float), np.array(refs.puntos["mtt5"], float)
        tt = np.linspace(-0.8, 1.8, 3 * n)
        orillas = []
        for lado in (1, -1):
            s = g["perfil"](tt) - pieza.retraso + lado * largo / 2
            px = m1[0] + tt * (m5[0] - m1[0]) + sis.eje[0] * s
            py = m1[1] + tt * (m5[1] - m1[1]) + sis.eje[1] * s
            u_, v_ = sis.a_local(px, py)
            orillas.append((u_ + pieza.du, v_ + pieza.dv))
        uu = np.concatenate([orillas[0][0], orillas[1][0][::-1]])
        vv = np.concatenate([orillas[0][1], orillas[1][1][::-1]])
        return _dentro_del_pie(*sis.a_global(uu, vv), mascara, dx, dy, cerrar=True)
    elif tipo == "canal_fascia":
        a, b = g["a"] + [pieza.du, pieza.dv], g["b"] + [pieza.du, pieza.dv]
        d = (b - a) / np.hypot(*(b - a))
        p = np.array([-d[1], d[0]]) * ancho / 2
        esquinas = np.array([a + p, b + p, b - p, a - p, a + p])
        uu, vv = esquinas[:, 0], esquinas[:, 1]
    elif tipo == "cuna_ant":
        uu, vv = _rectangulo(g["inicio"] + pieza.du, g["inicio"] + 80 + pieza.du, -150, 150, n)
        return _dentro_del_pie(*sis.a_global(uu, vv), mascara, dx, dy, cerrar=True)
    else:  # skive, cuña posterior, alza y expansión: la zona del talón
        u0, u1 = -g["atras"] - 5 + pieza.du, -g["atras"] + largo + pieza.du
        if tipo == "skive":
            ancho_corte = pieza.altura / max(np.tan(np.radians(pieza.angulo)), 0.05)  # hasta donde llega el plano
            if pieza.valgo:
                v0, v1 = -150, g["vref"] + ancho_corte
            else:
                v0, v1 = g["vref"] - ancho_corte, 150
        else:
            v0, v1 = -150, 150
        uu, vv = _rectangulo(u0, u1, v0 + pieza.dv, v1 + pieza.dv, n)
        return _dentro_del_pie(*sis.a_global(uu, vv), mascara, dx, dy, cerrar=True)
    x, y = sis.a_global(uu, vv)
    # Solo la parte dentro del recuadro.
    ny, nx = mascara.shape
    pts = []
    for px, py in zip(np.atleast_1d(x), np.atleast_1d(y)):
        i, j = int(round(px / dx)), int(round(py / dy))
        if 0 <= i < nx and 0 <= j < ny:
            pts.append((float(px), float(py)))
    return pts if len(pts) > 2 else None
