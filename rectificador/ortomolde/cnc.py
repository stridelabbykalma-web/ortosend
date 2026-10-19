"""Salida directa para la CNC (sin pasar por Fusion 360), con la misma estrategia que el ejemplo de
Fusion del taller (`molde_yeso.nc`).

- Se fresa en una PLANCHA de escayola (por defecto la mesa de la CNC, 600 × 500 × 40 mm). En una
  misma tirada caben varios moldes: cada pie es una «pieza» y se colocan automáticamente lo más
  juntas posible (girándolas si hace falta) para aprovechar la plancha.
- Origen SIEMPRE en el mismo sitio: X0 Y0 = esquina delantera izquierda de la plancha,
  Z0 = su cara de arriba (todo el trabajo en X, Y positivos y Z negativos).
- Cada pie se fresa con su parte más alta justo debajo de la cara de arriba de la plancha.
- Fresa de punta de bola (Ø25): se calcula dónde debe ir la PUNTA para que la bola toque el molde
  sin comérselo (superficie desplazada).
- Por cada pie, tres fases (como Fusion):
  1. CONTORNO: se rodea la silueta del pie bajando en espiral (`bajada_contorno` mm por vuelta)
     hasta dejar `suelo_contorno` mm de escayola debajo. El pie queda como una isla con la pared
     vertical; alrededor no queda base plana y el resto de la plancha no se toca.
  2. DESBASTE por capas (`bajada_por_pasada`) dentro de la silueta, dejando `sobrante_desbaste`.
  3. ACABADO en líneas paralelas a X separadas `paso_acabado` mm.
- G-code en el formato del ejemplo de Fusion (comentarios entre paréntesis, T1, S M3, G54…).
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

#: Distancia extra (mm) entre la silueta y el filo de la fresa en el contorno.
HOLGURA_CONTORNO = 0.25


# ---------------------------------------------------------------------------
# Piezas (un pie cada una) y su colocación en la plancha
# ---------------------------------------------------------------------------

@dataclass
class Pieza:
    nombre: str
    h: np.ndarray  # relieve del pie sobre su base (mm); 0 fuera de la silueta. Recuadro justo del pie.
    silueta: np.ndarray  # True dentro del pie (lo que queda de molde)
    paso: float = 0.5  # mm entre puntos de `h`
    x: int | None = None  # posición (celdas) de la esquina delantera izquierda de `h` en la plancha
    y: int | None = None
    giro: int = 0  # cuartos de vuelta (0..3)
    fija: bool = False  # puesta a mano: la colocación automática no la mueve

    @property
    def colocada(self) -> bool:
        return self.x is not None

    def forma(self, giro: int | None = None) -> tuple[int, int]:
        """(filas, columnas) = (largo Y, ancho X) en celdas, ya girada."""
        g = self.giro if giro is None else giro
        ny, nx = self.h.shape
        return (nx, ny) if g % 2 else (ny, nx)

    def h_girada(self) -> np.ndarray:
        return np.rot90(self.h, k=self.giro)

    def silueta_girada(self) -> np.ndarray:
        return np.rot90(self.silueta, k=self.giro)

    @property
    def alto(self) -> float:
        return float(self.h.max())


def silueta_de(relieve: np.ndarray, paso: float, umbral: float = 0.3) -> np.ndarray:
    """Silueta limpia del pie: la mancha más grande con relieve, sin agujeros ni picos sueltos."""
    m = relieve > umbral
    lab, n = ndimage.label(m)
    if n == 0:
        return m
    m = lab == (np.argmax(np.bincount(lab.ravel())[1:]) + 1)
    r = max(1, int(round(1.0 / paso)))
    m = ndimage.binary_closing(np.pad(m, r + 1), iterations=r)[r + 1:-r - 1, r + 1:-r - 1]
    return ndimage.binary_fill_holes(m)


def piezas_de_molde(z: np.ndarray, fondo: float, mascaras: list[np.ndarray], nombres: list[str],
                    paso: float, cfg: dict) -> list[Pieza]:
    """Una pieza por pie: su relieve sobre la base del molde y su silueta."""
    piezas = []
    for m, nombre in zip(mascaras, nombres):
        relieve = np.where(m, np.clip(z - fondo, 0, None), 0.0)
        sil = silueta_de(relieve, paso)
        if not sil.any():
            continue
        jj, ii = np.nonzero(sil)
        j0, j1, i0, i1 = jj.min(), jj.max() + 1, ii.min(), ii.max() + 1
        s = sil[j0:j1, i0:i1]
        piezas.append(Pieza(nombre, np.where(s, relieve[j0:j1, i0:i1], 0.0), s, paso))
    return piezas


def a_paso(piezas: list[Pieza], paso: float) -> None:
    """Pasa todas las piezas a la misma separación de puntos (por si vienen de moldes distintos)."""
    for p in piezas:
        if abs(p.paso - paso) > 1e-9:
            f = p.paso / paso
            p.h = ndimage.zoom(p.h, f, order=1)
            p.silueta = ndimage.zoom(p.silueta.astype(float), f, order=1) > 0.5
            p.h = np.where(p.silueta, p.h, 0.0)
            p.paso = paso


def margen_celdas(radio: float, paso: float, cfg: dict) -> int:
    """Celdas alrededor de cada silueta reservadas para el contorno.

    Dos piezas vecinas quedan a 2 × margen: la fresa que rodea una no llega a la otra. Y el centro de
    la fresa nunca sale de la plancha (X, Y ≥ 0)."""
    dc = radio + HOLGURA_CONTORNO
    m = max(dc, (dc + radio + 0.5) / 2) + cfg.get("separacion", 0.0) / 2
    return int(np.ceil(m / paso))


def huella(p: Pieza, m: int, x: int | None = None, y: int | None = None,
           giro: int | None = None) -> tuple[int, int, int, int]:
    """Rectángulo (x, y, ancho, largo) en celdas de la plancha que ocupa una pieza con su margen
    para el contorno."""
    ny, nx = p.forma(giro)
    x = p.x if x is None else x
    y = p.y if y is None else y
    return x - m, y - m, nx + 2 * m, ny + 2 * m


def _se_pisan(a, b) -> bool:
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def cabe(p: Pieza, otras: list[Pieza], ancho: float, largo: float, paso: float, cfg: dict, radio: float,
         x: int, y: int, giro: int) -> str | None:
    """¿Cabe la pieza en esa posición (celdas) y giro? None si cabe; si no, el motivo."""
    borde = int(round(cfg.get("margen_bloque", 0.0) / paso))
    m = margen_celdas(radio, paso, cfg)
    W, L = int(round(ancho / paso)) + 1, int(round(largo / paso)) + 1
    r = huella(p, m, x, y, giro)
    if r[0] < borde or r[1] < borde or r[0] + r[2] > W - borde or r[1] + r[3] > L - borde:
        return "se sale de la plancha (la fresa necesita sitio alrededor del pie)"
    for q in otras:
        if q is not p and q.colocada and _se_pisan(r, huella(q, m)):
            return f"queda demasiado cerca de {q.nombre} (las fresas de los dos se tocarían)"
    return None


def colocar(piezas: list[Pieza], ancho: float, largo: float, paso: float, cfg: dict,
            radio: float, avisos: list[str] | None = None) -> list[Pieza]:
    """Coloca las piezas en la plancha lo más juntas posible (MaxRects: mejor hueco por el lado
    corto), girándolas 90° si cabe mejor. Las puestas a mano (`fija`) se dejan donde están si siguen
    cabiendo; el resto se coloca alrededor. Devuelve las que NO caben."""
    borde = int(round(cfg.get("margen_bloque", 0.0) / paso))
    m = margen_celdas(radio, paso, cfg)
    W = int(round(ancho / paso)) + 1 - 2 * borde
    L = int(round(largo / paso)) + 1 - 2 * borde
    libres = [(0, 0, W, L)]  # (x, y, ancho, largo) en celdas
    giros = (0, 1) if cfg.get("permitir_giro", True) else (0,)
    sobran = []
    fijas = []
    for p in piezas:
        if not p.fija:
            p.x = p.y = None
    for p in piezas:
        if not p.fija:
            continue
        motivo = None if p.colocada else "sin posición"
        if motivo is None:
            motivo = cabe(p, fijas, ancho, largo, paso, cfg, radio, p.x, p.y, p.giro)
        if motivo:
            p.fija = False
            p.x = p.y = None
            if avisos is not None:
                avisos.append(f"{p.nombre} ya no cabe donde lo pusiste ({motivo}): se ha colocado solo.")
            continue
        fijas.append(p)
        hx, hy, hw, hl = huella(p, m)
        libres = _partir(libres, (hx - borde, hy - borde, hw, hl))
    for p in sorted([q for q in piezas if not q.fija], key=lambda q: -q.h.size):
        mejor = None
        for g in giros:
            ny, nx = p.forma(g)
            w, l = nx + 2 * m, ny + 2 * m
            for fx, fy, fw, fl in libres:
                if w <= fw and l <= fl:
                    clave = (min(fw - w, fl - l), fy, fx)
                    if mejor is None or clave < mejor[0]:
                        mejor = (clave, fx, fy, g, w, l)
        if mejor is None:
            sobran.append(p)
            continue
        _, fx, fy, g, w, l = mejor
        p.x, p.y, p.giro = fx + borde + m, fy + borde + m, g
        libres = _partir(libres, (fx, fy, w, l))
    return sobran


def _partir(libres, r):
    x, y, w, l = r
    nuevos = []
    for fx, fy, fw, fl in libres:
        if x >= fx + fw or x + w <= fx or y >= fy + fl or y + l <= fy:
            nuevos.append((fx, fy, fw, fl))
            continue
        if x > fx:
            nuevos.append((fx, fy, x - fx, fl))
        if x + w < fx + fw:
            nuevos.append((x + w, fy, fx + fw - x - w, fl))
        if y > fy:
            nuevos.append((fx, fy, fw, y - fy))
        if y + l < fy + fl:
            nuevos.append((fx, y + l, fw, fy + fl - y - l))
    # Quitar los que quedan dentro de otros.
    finales = []
    for i, a in enumerate(nuevos):
        dentro = any(j != i and a[0] >= b[0] and a[1] >= b[1] and a[0] + a[2] <= b[0] + b[2]
                     and a[1] + a[3] <= b[1] + b[3] and (a != b or j < i) for j, b in enumerate(nuevos))
        if not dentro and a[2] > 0 and a[3] > 0:
            finales.append(a)
    return finales


@dataclass
class _Colocada:
    """Lo que hace falta de una pieza ya colocada para fresarla."""
    pieza: Pieza
    sil: np.ndarray  # silueta en una ventana de la plancha [y0:y1, x0:x1]
    x0: int
    x1: int
    y0: int
    y1: int
    contorno: np.ndarray | None = None  # (n, 2) X, Y en mm: recorrido del centro de la fresa
    suelo: float = 0.0  # mm de escayola que quedan debajo de la ranura


def suelo_de(p: Pieza, alto: float, cfg: dict) -> float:
    """Escayola que queda debajo de la ranura del contorno: `suelo_contorno`, o menos si el pie es
    tan alto que si no su borde quedaría por debajo de la ranura (nunca menos de `suelo_minimo`)."""
    libre = alto - cfg.get("rebaje_superior", 0.5) - p.alto - 0.5
    return float(np.clip(libre, cfg.get("suelo_minimo", 3.0), cfg["suelo_contorno"]))


def componer(piezas: list[Pieza], ancho: float, largo: float, alto: float, paso: float, radio: float,
             cfg: dict):
    """Plancha terminada: alturas (mm sobre el fondo; `alto` = sin tocar), máscara de lo que se
    fresa y, por pieza, su silueta y el recorrido del contorno.

    El recorrido del contorno es por donde la bola, con la punta en el suelo de la ranura, roza el
    pie sin comérselo: junto a un borde alto queda a un radio de la silueta (pared vertical) y junto
    a un borde bajo se acerca más (así no queda un labio de escayola pegado al borde del pie)."""
    nx, ny = int(round(ancho / paso)) + 1, int(round(largo / paso)) + 1
    h = np.full((ny, nx), float(alto))
    zona = np.zeros((ny, nx), bool)
    punta_pies = np.full((ny, nx), -np.inf)
    tope = cfg.get("rebaje_superior", 0.5)
    alcance = int(np.ceil((2 * radio + HOLGURA_CONTORNO) / paso)) + 2
    colocadas = []
    for p in piezas:
        if not p.colocada:
            continue
        hp, sp = p.h_girada(), p.silueta_girada()
        a, b = sp.shape
        # Ventana de la plancha que toca esta pieza (silueta + alcance del contorno).
        wy0, wx0 = max(p.y - alcance, 0), max(p.x - alcance, 0)
        wy1, wx1 = min(p.y + a + alcance, ny), min(p.x + b + alcance, nx)
        suelo = suelo_de(p, alto, cfg)
        sil = np.zeros((wy1 - wy0, wx1 - wx0), bool)
        sil[p.y - wy0:p.y - wy0 + a, p.x - wx0:p.x - wx0 + b] = sp
        pie = np.full(sil.shape, -1e3)
        pie[sil] = alto - tope - p.alto + hp[sp]  # lo más alto del pie justo bajo la cara de arriba
        # Bola un poco mayor (misma punta) = holgura para no rozar el pie.
        pp = superficie_punta(pie, radio + HOLGURA_CONTORNO, paso, -1e3)
        punta_pies[wy0:wy1, wx0:wx1] = np.maximum(punta_pies[wy0:wy1, wx0:wx1], pp)
        # Lejos del pie `pp` cae a -1000: se recorta para que la línea quede bien interpolada.
        contorno = _recorrido(np.maximum(pp, suelo - 1.0), suelo, wx0, wy0, paso)
        ventana = h[wy0:wy1, wx0:wx1]
        if contorno is not None:
            # Lo que deja la bola alrededor: suelo debajo del recorrido y la curva de la bola a los lados.
            d = _distancia_a_linea(contorno, wx0, wy0, sil.shape, paso)
            cerca = (d < radio) & ~sil
            ranura = suelo + radio - np.sqrt(np.clip(radio ** 2 - d ** 2, 0, None))
            ventana[cerca] = np.minimum(ventana[cerca], ranura[cerca])
            zona[wy0:wy1, wx0:wx1] |= cerca
        ventana[sil] = pie[sil]
        zona[wy0:wy1, wx0:wx1] |= sil
        colocadas.append(_Colocada(p, sil, wx0, wx1, wy0, wy1, contorno, suelo))
    # Volver a poner cada pie encima por si la ranura de un vecino lo ha tocado (no debería).
    for c in colocadas:
        v = h[c.y0:c.y1, c.x0:c.x1]
        p = c.pieza
        v[c.sil] = alto - tope - p.alto + p.h_girada()[p.silueta_girada()]
    return h, zona, colocadas, punta_pies


def _distancia_a_linea(pts: np.ndarray, x0: int, y0: int, forma, paso: float) -> np.ndarray:
    """Distancia (mm) de cada celda de una ventana a una línea dada en mm."""
    from scipy.spatial import cKDTree

    trozos = []
    for a, b in zip(pts[:-1], pts[1:]):
        n = int(np.ceil(np.linalg.norm(b - a) / (paso / 8))) + 1
        trozos.append(a + (b - a) * np.linspace(0, 1, n)[:, None])
    jj, ii = np.mgrid[0:forma[0], 0:forma[1]]
    celdas = np.column_stack([(ii.ravel() + x0) * paso, (jj.ravel() + y0) * paso])
    d, _ = cKDTree(np.vstack(trozos)).query(celdas)
    return d.reshape(forma)


def _recorrido(campo: np.ndarray, nivel: float, x0: int, y0: int, paso: float) -> np.ndarray | None:
    """Línea cerrada más larga donde `campo` vale `nivel` (centro de la fresa en el contorno), en mm,
    en sentido horario visto desde arriba."""
    import contourpy

    lineas = contourpy.contour_generator(z=campo).lines(nivel)
    if not lineas:
        return None
    pts = max(lineas, key=len).astype(float)
    pts = pts[np.r_[True, np.any(np.abs(np.diff(pts, axis=0)) > 1e-9, axis=1)]]
    pts = np.column_stack([(pts[:, 0] + x0) * paso, (pts[:, 1] + y0) * paso])
    if np.linalg.norm(pts[0] - pts[-1]) > 1e-6:
        pts = np.vstack([pts, pts[:1]])
    area = np.sum(pts[:-1, 0] * pts[1:, 1] - pts[1:, 0] * pts[:-1, 1]) / 2
    if area > 0:  # antihorario → horario
        pts = pts[::-1]
    return pts[_simplificar_xy(pts, 0.02)]


# ---------------------------------------------------------------------------
# Dónde va la punta de la bola
# ---------------------------------------------------------------------------

def bola(radio: float, paso: float) -> np.ndarray:
    """Altura de la superficie de la bola respecto a su centro (-inf fuera del disco)."""
    r = int(np.ceil(radio / paso))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1] * paso
    d2 = xx ** 2 + yy ** 2
    return np.where(d2 <= radio ** 2, np.sqrt(np.clip(radio ** 2 - d2, 0, None)), -np.inf)


def superficie_punta(h: np.ndarray, radio: float, paso: float, relleno: float = 0.0) -> np.ndarray:
    """Altura mínima de la PUNTA de la bola en cada punto para no comerse nada.

    Centro de la bola = max sobre el disco de (h(vecino) + sqrt(R² - d²)); punta = centro - R.
    Fuera de la plancha no hay material (`relleno`).
    """
    r = int(np.ceil(radio / paso))
    hp = np.pad(h, r, constant_values=relleno)
    b = bola(radio, paso)
    centro = ndimage.grey_dilation(hp, structure=np.where(np.isfinite(b), b, -1e6), mode="nearest")
    return (centro - radio)[r:-r, r:-r]


# ---------------------------------------------------------------------------
# G-code
# ---------------------------------------------------------------------------

def texto_cnc(texto: str) -> str:
    """Texto sin acentos ni símbolos para los comentarios del G-code (los controladores solo
    aceptan caracteres básicos; sin paréntesis dentro de un comentario)."""
    t = texto.replace("·", "-").replace("×", "x").replace("º", "").replace("ª", "")
    t = t.replace("(", "[").replace(")", "]")
    return unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode("ascii")


def comentario(texto: str) -> str:
    return f"({texto_cnc(texto)})"


def _simplificar(ys: np.ndarray, zs: np.ndarray, tol: float = 0.01) -> np.ndarray:
    """Índices de puntos a conservar en una línea (quita los que están alineados)."""
    if len(ys) <= 2:
        return np.arange(len(ys))
    keep = [0]
    ancla = 0
    for k in range(2, len(ys)):
        t = (ys[ancla + 1:k] - ys[ancla]) / (ys[k] - ys[ancla])
        interp = zs[ancla] + t * (zs[k] - zs[ancla])
        if np.abs(interp - zs[ancla + 1:k]).max() > tol or abs(ys[k] - ys[ancla]) > 30:
            keep.append(k - 1)
            ancla = k - 1
    keep.append(len(ys) - 1)
    return np.array(keep)


def _simplificar_xy(pts: np.ndarray, tol: float) -> np.ndarray:
    """Igual que `_simplificar` para una línea en el plano (distancia perpendicular)."""
    if len(pts) <= 2:
        return np.arange(len(pts))
    keep = [0]
    ancla = 0
    for k in range(2, len(pts)):
        v = pts[k] - pts[ancla]
        lv = np.linalg.norm(v)
        w = pts[ancla + 1:k] - pts[ancla]
        dist = np.abs(w[:, 0] * v[1] - w[:, 1] * v[0]) / max(lv, 1e-9)
        if dist.max() > tol or lv > 30:
            keep.append(k - 1)
            ancla = k - 1
    keep.append(len(pts) - 1)
    return np.array(keep)


def _tramos(necesita: np.ndarray, hueco_max: int) -> list[tuple[int, int]]:
    """Tramos [a, b] de índices donde hay que cortar (uniendo huecos pequeños)."""
    idx = np.nonzero(necesita)[0]
    if idx.size == 0:
        return []
    tramos = []
    a = prev = idx[0]
    for k in idx[1:]:
        if k - prev > hueco_max:
            tramos.append((a, prev))
            a = k
        prev = k
    tramos.append((a, prev))
    return tramos


class _Escritor:
    """Va escribiendo el G-code y sumando distancias para estimar el tiempo."""

    def __init__(self, cfg: dict, z_seguro: float):
        self.lineas: list[str] = []
        self.cfg = cfg
        self.z_seguro = z_seguro
        self.z_paso = cfg.get("altura_paso", 2.0)  # para saltar dentro de una pieza (sobre la plancha)
        self.pos = np.array([0.0, 0.0, z_seguro])
        self.tiempo = 0.0  # minutos
        self.f_actual = None
        self.z_min = 0.0

    def _mover(self, destino, avance):
        self.tiempo += float(np.linalg.norm(destino - self.pos)) / avance
        self.pos = destino
        self.z_min = min(self.z_min, float(destino[2]))

    def rapido(self, x=None, y=None, z=None):
        d = self.pos.copy()
        for k, v in enumerate((x, y, z)):
            if v is not None:
                d[k] = v
        partes = [f"{e}{v:.3f}" for e, v, a in zip("XYZ", d, self.pos) if abs(v - a) > 1e-6]
        if partes:
            self.lineas.append("G0 " + " ".join(partes))
            self._mover(d, self.cfg["avance_rapido"])

    def corte(self, x, y, z, avance):
        d = np.array([x, y, z], float)
        partes = [f"{e}{v:.3f}" for e, v, a in zip("XYZ", d, self.pos) if abs(v - a) > 1e-6]
        if not partes:
            return
        f = ""
        if avance != self.f_actual:
            f = f" F{avance:.0f}"
            self.f_actual = avance
        self.lineas.append("G1 " + " ".join(partes) + f)
        self._mover(d, avance)

    def bajar_a(self, x, y, z, z_libre):
        """Subir sobre la plancha, ir encima del punto, bajar rápido hasta 1 mm sobre el material
        que pueda haber ahí (`z_libre`) y entrar despacio hasta z."""
        arriba = max(self.z_paso, z_libre + 1.0)
        if self.pos[2] < arriba:
            self.rapido(z=arriba)
        self.rapido(x=x, y=y)
        self.rapido(z=z_libre + 1.0)
        if z < z_libre:
            self.corte(x, y, z_libre, self.cfg["avance_entrada"])
        self.corte(x, y, z, self.cfg["avance_bajada"] if z < z_libre else self.cfg["avance_entrada"])

    def subir(self, z=None):
        self.rapido(z=self.z_paso if z is None else z)


@dataclass
class Ficha:
    """Datos de un pie de la tirada para el mapa y la hoja de trabajo (mm)."""
    numero: int  # orden en que se fresa (= «Pieza N» en el .nc)
    pieza: Pieza
    contorno: np.ndarray | None
    x: tuple[float, float]  # de dónde a dónde ocupa el pie en X
    y: tuple[float, float]
    alto: float
    suelo: float
    tiempo_min: float
    dedos: tuple[float, float]  # dirección (X, Y) del talón a los dedos en la plancha

    @property
    def nombre(self) -> str:
        return self.pieza.nombre


def _hacia_dedos(p: Pieza) -> tuple[float, float]:
    """Hacia dónde quedan los dedos en la plancha (los pies llegan con los dedos hacia +Y)."""
    marca = np.zeros(p.h.shape)
    marca[-1, :] = 1.0  # fila de los dedos (Y más grande)
    m = np.rot90(marca, k=p.giro)
    jj, ii = np.nonzero(m)
    ny, nx = m.shape
    v = np.array([ii.mean() - (nx - 1) / 2, jj.mean() - (ny - 1) / 2])
    v = v / max(np.linalg.norm(v), 1e-9)
    return float(v[0]), float(v[1])


@dataclass
class TrabajoCNC:
    gcode: str
    plancha: tuple[float, float, float]  # ancho X, largo Y, alto Z (mm)
    tiempo_min: float
    piezas: list[Pieza]
    sobran: list[Pieza]
    altura: np.ndarray  # plancha terminada (mm sobre el fondo)
    punta: np.ndarray  # altura de la punta de la bola
    zona: np.ndarray
    paso: float
    contornos: list[np.ndarray] = field(default_factory=list)  # recorridos del contorno (mm)
    punta_pies: np.ndarray | None = None  # punta mínima para no tocar los pies (solo los pies)
    fichas: list["Ficha"] = field(default_factory=list)  # una por pie, en el orden en que se fresan
    previa: bool = False  # True = solo la colocación (todavía sin trayectorias ni G-code)
    tiempos: dict = field(default_factory=dict)  # minutos por fase
    resumen: dict = field(default_factory=dict)
    avisos: list[str] = field(default_factory=list)

    @property
    def aprovechamiento(self) -> float:
        return float(self.zona.mean())


def _contorno(w: _Escritor, pts: np.ndarray, H: float, suelo: float, cfg: dict) -> int:
    """Rodea la silueta bajando en espiral `bajada_contorno` mm por vuelta hasta el suelo de la
    ranura y da una última vuelta plana. Devuelve las vueltas."""
    z_fin = -(H - suelo)
    baj = cfg["bajada_contorno"]
    niveles = [float(z) for z in np.arange(-baj, z_fin + 1e-6, -baj)]
    if not niveles or niveles[-1] > z_fin + 1e-6:
        niveles.append(z_fin)
    # Empezar por el punto más cercano a donde está la fresa.
    k = int(np.argmin(np.linalg.norm(pts[:-1] - w.pos[:2], axis=1)))
    anillo = np.vstack([pts[k:-1], pts[:k + 1]])
    t = np.r_[0, np.cumsum(np.linalg.norm(np.diff(anillo, axis=0), axis=1))]
    t = t / t[-1]
    w.bajar_a(anillo[0, 0], anillo[0, 1], 0.0, 0.0)
    z0 = 0.0
    for z1 in niveles + [z_fin]:
        for (x, y), f in zip(anillo[1:], t[1:]):
            w.corte(x, y, z0 + (z1 - z0) * f, cfg["avance_desbaste"])
        z0 = z1
    w.subir()
    return len(niveles) + 1


def _desbaste(w: _Escritor, punta, c: _Colocada, paso, H, cfg, radio) -> int:
    """Desbaste por capas dentro de la silueta, en líneas a lo largo de X."""
    sub = punta[c.y0:c.y1, c.x0:c.x1]
    objetivo = sub + cfg["sobrante_desbaste"]
    r = int(np.ceil(radio / paso))
    techo = ndimage.maximum_filter(objetivo, size=2 * r + 1)  # lo más alto que puede quedar cerca
    dentro = c.sil
    material = np.where(dentro, float(H), -np.inf)
    filas = list(range(0, sub.shape[0], max(1, int(round(cfg["paso_desbaste"] / paso)))))
    if filas[-1] != sub.shape[0] - 1:
        filas.append(sub.shape[0] - 1)
    filas = [j for j in filas if dentro[j].any()]
    xs = np.arange(c.x0, c.x1) * paso
    fondo_min = float(objetivo[dentro].min())
    baj = cfg["bajada_por_pasada"]
    niveles = [float(z) for z in np.arange(H - baj, fondo_min, -baj)] + [fondo_min]
    enlace_max = int(round((cfg["paso_desbaste"] + 3) / paso))
    capas = 0
    anterior = float(H)
    for nivel in niveles:
        corte = np.maximum(nivel, objetivo)
        hubo = False
        sentido = 1
        ultimo = None  # (fila, columna) donde terminó el último tramo de esta capa
        for j in filas:
            prof = corte[j]
            y = (c.y0 + j) * paso
            for a, b in _tramos(material[j] - prof > 0.05, int(round(10 / paso)))[::sentido]:
                rango = np.arange(a, b + 1)[::sentido]
                k0 = rango[0]
                if ultimo is not None and abs(j - ultimo[0]) <= enlace_max and abs(k0 - ultimo[1]) <= enlace_max:
                    # Paso a la línea siguiente sin levantar, por encima de lo que debe quedar.
                    jj = slice(min(j, ultimo[0]), max(j, ultimo[0]) + 1)
                    kk = slice(min(k0, ultimo[1]), max(k0, ultimo[1]) + 1)
                    zl = float(max(corte[jj, kk].max(), w.pos[2] + H, prof[k0]))
                    w.corte(w.pos[0], w.pos[1], zl - H, cfg["avance_entrada"])
                    w.corte(xs[k0], y, zl - H, cfg["avance_entrada"])
                    w.corte(xs[k0], y, prof[k0] - H, cfg["avance_entrada"])
                else:
                    libre = min(float(H), max(anterior, techo[j, k0]) + 0.3)
                    w.bajar_a(xs[k0], y, prof[k0] - H, libre - H)
                for k in rango[_simplificar(xs[rango] * sentido, prof[rango])]:
                    w.corte(xs[k], y, prof[k] - H, cfg["avance_desbaste"])
                ultimo = (j, rango[-1])
                hubo = True
            sentido = -sentido
        if hubo:
            capas += 1
            material = np.minimum(material, np.where(dentro, corte, -np.inf))
        anterior = nivel
    w.subir()
    return capas


def _acabado(w: _Escritor, punta, c: _Colocada, paso, H, cfg) -> int:
    """Acabado en zigzag con líneas a lo largo de X (como el «Paralelo» de Fusion)."""
    paso_lin = max(1, int(round(cfg["paso_acabado"] / paso)))
    filas_sil = np.nonzero(c.sil.any(axis=1))[0]
    filas = list(range(filas_sil[0], filas_sil[-1] + 1, paso_lin))
    if filas[-1] != filas_sil[-1]:
        filas.append(filas_sil[-1])
    xs = np.arange(punta.shape[1]) * paso
    holgura = cfg["sobrante_desbaste"] + 1.0
    sentido = 1
    primero = True
    for jl in filas:
        cols = np.nonzero(c.sil[jl])[0]
        j = c.y0 + jl
        rango = np.arange(c.x0 + cols[0], c.x0 + cols[-1] + 1)[::sentido]
        sel = rango[_simplificar(xs[rango] * sentido, punta[j, rango])]
        y = j * paso
        i = sel[0]
        if primero:
            w.bajar_a(xs[i], y, punta[j, i] - H, punta[j, i] + holgura - H)
            primero = False
        else:
            # A la siguiente línea sin levantar: a la altura justa para no tocar el molde.
            jp = int(round(w.pos[1] / paso))
            ip = int(round(w.pos[0] / paso))
            zt = float(max(punta[min(jp, j):max(jp, j) + 1, min(ip, i):max(ip, i) + 1].max(), w.pos[2] + H))
            w.corte(w.pos[0], w.pos[1], zt - H, cfg["avance_entrada"])
            w.corte(xs[i], y, zt - H, cfg["avance_entrada"])
            w.corte(xs[i], y, punta[j, i] - H, cfg["avance_entrada"])
        for k in sel:
            w.corte(xs[k], y, punta[j, k] - H, cfg["avance_acabado"])
        sentido = -sentido
    w.subir()
    return len(filas)


def orden_fresado(puestas: list[Pieza], paso: float) -> list[Pieza]:
    """Orden en que se fresan: de delante a detrás (franjas de 10 cm) y de izquierda a derecha."""
    return sorted(puestas, key=lambda p: (p.y // max(1, int(100 / paso)), p.x))


def previsualizar(piezas: list[Pieza], ancho: float, largo: float, alto: float, paso: float, radio: float,
                  cfg: dict, colocar_antes: bool = True) -> TrabajoCNC:
    """Coloca las piezas y prepara el mapa SIN calcular trayectorias (es casi instantáneo).

    La numeración y las posiciones son las mismas que tendrá el .nc si después se llama a
    `generar(..., colocar_antes=False)`. El contorno que se dibuja es aproximado (a un radio de la silueta)."""
    a_paso(piezas, paso)
    avisos = []
    sobran = (colocar(piezas, ancho, largo, paso, cfg, radio, avisos) if colocar_antes
              else [p for p in piezas if not p.colocada])
    puestas = [p for p in piezas if p.colocada]
    nx, ny = int(round(ancho / paso)) + 1, int(round(largo / paso)) + 1
    h = np.full((ny, nx), float(alto))
    zona = np.zeros((ny, nx), bool)
    tope = cfg.get("rebaje_superior", 0.5)
    dc = radio + HOLGURA_CONTORNO
    alcance = int(np.ceil((dc + radio) / paso)) + 2
    fichas = []
    for n, p in enumerate(orden_fresado(puestas, paso), 1):
        hp, sp = p.h_girada(), p.silueta_girada()
        a, b = sp.shape
        wy0, wx0 = max(p.y - alcance, 0), max(p.x - alcance, 0)
        wy1, wx1 = min(p.y + a + alcance, ny), min(p.x + b + alcance, nx)
        sil = np.zeros((wy1 - wy0, wx1 - wx0), bool)
        sil[p.y - wy0:p.y - wy0 + a, p.x - wx0:p.x - wx0 + b] = sp
        d = ndimage.distance_transform_edt(~sil, sampling=paso)
        suelo = suelo_de(p, alto, cfg)
        ranura = (d < dc + radio) & ~sil
        h[wy0:wy1, wx0:wx1][ranura] = suelo
        zona[wy0:wy1, wx0:wx1] |= ranura | sil
        h[p.y:p.y + a, p.x:p.x + b][sp] = alto - tope - p.alto + hp[sp]
        fichas.append(Ficha(n, p, _recorrido(d, dc, wx0, wy0, paso), (p.x * paso, (p.x + b - 1) * paso),
                            (p.y * paso, (p.y + a - 1) * paso), p.alto, suelo, float("nan"), _hacia_dedos(p)))
        if p.alto > alto - tope:
            avisos.append(f"{p.nombre} mide {p.alto:.1f} mm de alto: no cabe en una plancha de {alto:.0f} mm.")
    if sobran:
        avisos.append(f"No caben {len(sobran)} pieza(s): " + ", ".join(p.nombre for p in sobran)
                      + ". Usa otra plancha o hazlas en otra tirada.")
    return TrabajoCNC(gcode="", plancha=(ancho, largo, float(alto)), tiempo_min=float("nan"), piezas=puestas,
                      sobran=sobran, altura=h, punta=h, zona=zona, paso=paso,
                      contornos=[f.contorno for f in fichas if f.contorno is not None], fichas=fichas,
                      avisos=avisos, previa=True)


def generar(piezas: list[Pieza], ancho: float, largo: float, alto: float, paso: float,
            radio: float, cfg: dict, colocar_antes: bool = True) -> TrabajoCNC:
    """Coloca las piezas en la plancha y genera el G-code de toda la tirada."""
    a_paso(piezas, paso)
    sobran = (colocar(piezas, ancho, largo, paso, cfg, radio) if colocar_antes
              else [p for p in piezas if not p.colocada])
    puestas = [p for p in piezas if p.colocada]
    if not puestas:
        raise ValueError("Ninguna pieza cabe en la plancha.")
    H = float(alto)
    tope = cfg.get("rebaje_superior", 0.5)
    avisos = []
    for p in puestas:
        if p.alto > H - tope:
            raise ValueError(f"{p.nombre} mide {p.alto:.1f} mm de alto: no cabe en una plancha de {H:.0f} mm.")
        if p.alto > H - tope - suelo_de(p, H, cfg) - 0.5 + 1e-6:
            avisos.append(f"{p.nombre} mide {p.alto:.1f} mm de alto: con una plancha de {H:.0f} mm lo más bajo "
                          f"del borde del pie queda por debajo del contorno.")
    h, zona, colocadas, punta_pies = componer(puestas, ancho, largo, H, paso, radio, cfg)
    punta = superficie_punta(h, radio, paso, 0.0)
    zseg = cfg["altura_seguridad"]
    suelo = min(c.suelo for c in colocadas)
    w = _Escritor(cfg, zseg)
    w.lineas += [
        comentario(f"Rectificador de moldes Ortosend - tirada de {len(puestas)} pieza/s en {cfg.get('material', '')}"),
        comentario(f"Plancha {ancho:.0f} x {largo:.0f} x {H:.0f} mm - ancho X x largo Y x alto Z"),
        comentario("ORIGEN: X0 Y0 = esquina DELANTERA IZQUIERDA de la plancha - Z0 = cara de ARRIBA"),
        comentario(f"T1 D={2 * radio:g} CR={radio:g} - ZMIN={-(H - suelo):.3f} - fresa con punta de bola"),
        "G90 G94", "G17", "G21",
        "T1", f"S{cfg['revoluciones']:.0f} M3", "G4 P3", "G17 G90 G94", "G54",
        f"G0 Z{zseg:g}",
    ]
    numero = {id(p): n for n, p in enumerate(orden_fresado(puestas, paso))}
    orden = sorted(colocadas, key=lambda c: numero[id(c.pieza)])
    tiempos = {"contorno": 0.0, "desbaste": 0.0, "acabado": 0.0, "movimientos": 0.0}
    capas = lineas = vueltas = 0
    fichas = []
    for n, c in enumerate(orden, 1):
        p = c.pieza
        a, b = p.forma()
        t_pieza = w.tiempo
        w.lineas.append(comentario(f"Pieza {n}: {p.nombre} - X {p.x * paso:.0f}-{(p.x + b - 1) * paso:.0f}, "
                                   f"Y {p.y * paso:.0f}-{(p.y + a - 1) * paso:.0f}"))
        t0 = w.tiempo
        w.lineas.append("(2D Contorneado)")
        if c.contorno is not None and cfg.get("contorno", True):
            vueltas += _contorno(w, c.contorno, H, c.suelo, cfg)
        tiempos["contorno"] += w.tiempo - t0
        t0 = w.tiempo
        w.lineas.append(comentario(f"Desbaste en capas de {cfg['bajada_por_pasada']:g} mm"))
        capas = max(capas, _desbaste(w, punta, c, paso, H, cfg, radio))
        tiempos["desbaste"] += w.tiempo - t0
        t0 = w.tiempo
        w.lineas.append(comentario(f"Paralelo - acabado cada {cfg['paso_acabado']:g} mm"))
        lineas += _acabado(w, punta, c, paso, H, cfg)
        tiempos["acabado"] += w.tiempo - t0
        t0 = w.tiempo
        w.rapido(z=zseg)
        tiempos["movimientos"] += w.tiempo - t0
        fichas.append(Ficha(n, p, c.contorno, (p.x * paso, (p.x + b - 1) * paso), (p.y * paso, (p.y + a - 1) * paso),
                            p.alto, c.suelo, w.tiempo - t_pieza, _hacia_dedos(p)))
    w.rapido(z=zseg)
    w.rapido(x=0.0, y=0.0)
    w.lineas += ["M5", "M30"]
    w.lineas.insert(4, comentario(f"Tiempo estimado: {w.tiempo:.0f} min"))
    trabajo = TrabajoCNC(
        gcode="\n".join(w.lineas) + "\n", plancha=(ancho, largo, H), tiempo_min=w.tiempo,
        piezas=puestas, sobran=sobran, altura=h, punta=punta, zona=zona, paso=paso,
        contornos=[c.contorno for c in colocadas if c.contorno is not None], tiempos=tiempos,
        punta_pies=punta_pies, fichas=fichas,
        resumen={"capas_desbaste": capas, "lineas_acabado": lineas, "vueltas_contorno": vueltas,
                 "z_minima": w.z_min},
        avisos=avisos,
    )
    if sobran:
        trabajo.avisos.append(f"No caben {len(sobran)} pieza(s): " + ", ".join(p.nombre for p in sobran)
                              + ". Usa otra plancha o hazlas en otra tirada.")
    return trabajo


def plancha_minima(piezas: list[Pieza], paso: float, cfg: dict, maximo: tuple[float, float], radio: float):
    """Coloca las piezas en una plancha del tamaño máximo y devuelve el tamaño justo que ocupan."""
    a_paso(piezas, paso)
    colocar(piezas, *maximo, paso, cfg, radio)
    puestas = [p for p in piezas if p.colocada]
    if not puestas:
        return maximo
    extra = int(round(cfg.get("margen_bloque", 0.0) / paso)) + margen_celdas(radio, paso, cfg)
    x1 = max(p.x + p.forma()[1] for p in puestas) + extra
    y1 = max(p.y + p.forma()[0] for p in puestas) + extra
    return (x1 - 1) * paso, (y1 - 1) * paso
