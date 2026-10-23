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
- Tres fases y en el mismo orden que Fusion, cada una en todos los pies de la plancha antes de la siguiente
  (el contorno al final, para que la escayola trabaje entera y firme mientras se desbasta y se da el acabado):
  1. DESBASTE grande en cajeras, en niveles planos de Z cada `bajada_por_pasada` mm (como el «Desbaste de
     desfase 3D» de Fusion): en cada nivel, vueltas paralelas al borde de dentro hacia fuera con una sola
     entrada (en hélice o en rampa); quita la carga sin seguir la forma del pie y deja escalones.
  2. ACABADO en líneas paralelas a X separadas `paso_acabado` mm.
  3. CONTORNO: se rodea la silueta del pie bajando en espiral (`bajada_contorno` mm por vuelta)
     hasta dejar `suelo_contorno` mm de escayola debajo. El pie queda como una isla con la pared
     vertical, unida a la plancha por debajo; alrededor no queda base plana y el resto no se toca.
- G-code en el formato del ejemplo de Fusion (comentarios entre paréntesis, T1, S M3, G54…).
"""

from __future__ import annotations

import math
import unicodedata
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

#: Distancia extra (mm) entre la silueta y el filo de la fresa en el contorno.
HOLGURA_CONTORNO = 0.25
#: Desvío máximo (mm) al simplificar las vueltas del desbaste en tramos rectos (deja sobrante igualmente).
TOL_DESBASTE = 0.1


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
    h_entero: np.ndarray | None = field(default=None, repr=False)  # `h` antes de quitarle nada por abajo
    pedido: int | None = None  # nº de pedido (caso de la web) del molde, si se sabe

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
            if p.h_entero is not None:
                p.h, p.h_entero = p.h_entero, None
            f = p.paso / paso
            p.h = ndimage.zoom(p.h, f, order=1)
            p.silueta = ndimage.zoom(p.silueta.astype(float), f, order=1) > 0.5
            p.h = np.where(p.silueta, p.h, 0.0)
            p.paso = paso


def ajustar_alto(piezas: list[Pieza], alto: float, cfg: dict) -> list[str]:
    """Si un pie es más alto de lo que cabe en la plancha, se le quita lo que sobra POR ABAJO: lo más alto
    (la planta) queda igual y el borde más bajo se junta con el suelo de la ranura."""
    maximo = alto - cfg.get("rebaje_superior", 0.5) - cfg.get("suelo_minimo", 3.0) - 0.5
    avisos = []
    for p in piezas:
        if p.h_entero is None:
            p.h_entero = p.h
        sobra = float(p.h_entero.max()) - maximo
        if sobra > 1e-6:
            p.h = np.where(p.silueta, np.maximum(p.h_entero - sobra, 0.0), 0.0)
            if sobra > 0.05:
                avisos.append(f"{p.nombre} mide {p.h_entero.max():.1f} mm de alto: en una plancha de {alto:.0f} mm "
                              f"se le quitan {sobra:.1f} mm por abajo (la planta queda igual).")
        else:
            p.h = p.h_entero
    return avisos


def margen_celdas(radio: float, paso: float, cfg: dict) -> int:
    """Celdas alrededor de cada silueta reservadas para el contorno.

    Entre moldes el límite es el recorrido de la fresa (su centro): dos pies vecinos quedan, en su punto
    más cercano, a 2 × margen, así el recorrido de uno puede coincidir con el del otro (la misma ranura
    sirve a los dos) pero nunca se come al vecino. Con el borde de la plancha el límite es lo de fuera
    de la ranura (el filo de la fresa): ver `margen_borde`."""
    dc = radio + HOLGURA_CONTORNO
    m = dc + cfg.get("separacion", 0.0) / 2
    celdas = int(np.ceil(m / paso - 1e-9))
    # Dos moldes vecinos: (fresa + holgura) entre ellos. El radio justo se guarda para `zona` (la
    # cuenta en celdas enteras, para recuadros y bordes, redondea hacia arriba). +0,75 celdas: en una
    # rejilla dos zonas pueden no pisarse estando hasta √2 celdas más cerca de 2 × radio.
    _RADIOS[celdas] = m / paso + 0.75
    return celdas


def margen_borde(radio: float, paso: float, cfg: dict) -> int:
    """Celdas desde la zona de una pieza (`zona`) hasta el borde de la plancha: todo lo que corta la
    fresa (hasta su filo de fuera, lo gris del mapa) queda dentro del área de trabajo."""
    return int(round(cfg.get("margen_bloque", 0.0) / paso)) + margen_celdas(radio, paso, cfg)


def huella(p: Pieza, m: int, x: int | None = None, y: int | None = None,
           giro: int | None = None) -> tuple[int, int, int, int]:
    """Rectángulo (x, y, ancho, largo) en celdas de la plancha que ocupa una pieza con su margen
    para el contorno (el recuadro de `zona`)."""
    ny, nx = p.forma(giro)
    x = p.x if x is None else x
    y = p.y if y is None else y
    return x - m, y - m, nx + 2 * m, ny + 2 * m


def _radio_zona(m: int) -> float:
    """Radio (celdas) con que se ensancha la silueta en `zona`: el de `margen_celdas` sin redondear
    hacia arriba (lo guarda `margen_celdas`), para que dos moldes queden tan juntos como deja la fresa."""
    return _RADIOS.get(m, float(m))


_RADIOS: dict[int, float] = {}


def zona(p: Pieza, m: int, giro: int | None = None) -> np.ndarray:
    """Forma real que ocupa la pieza con su margen: la silueta (girada) ensanchada `m` celdas en
    redondo. Va en el recuadro de `huella` (su esquina es x - m, y - m). Dos piezas pueden ir donde
    sus zonas no se pisan: así encajan por su forma (dedos junto al talón, arco junto al borde de
    otro…) y no como rectángulos."""
    g = p.giro if giro is None else giro
    sil = p.silueta_girada() if giro is None or g == p.giro else np.rot90(p.silueta, k=g)
    clave = (g % 4, m, _radio_zona(m), id(p.silueta), p.silueta.shape)
    cache = p.__dict__.setdefault("_zonas", {})
    if clave not in cache:
        con = np.pad(sil, m + 1, constant_values=False)
        d = ndimage.distance_transform_edt(~con)
        cache.clear() if len(cache) > 16 else None
        cache[clave] = (d <= _radio_zona(m) + 1e-9)[1:-1, 1:-1]
    return cache[clave]


def _se_pisan(a, b) -> bool:
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def _zonas_se_pisan(za: np.ndarray, ra, zb: np.ndarray | None, rb) -> bool:
    """¿Se pisan dos zonas (zb None = rectángulo lleno) puestas en sus recuadros ra y rb?"""
    if not _se_pisan(ra, rb):
        return False
    x0, y0 = max(ra[0], rb[0]), max(ra[1], rb[1])
    x1, y1 = min(ra[0] + ra[2], rb[0] + rb[2]), min(ra[1] + ra[3], rb[1] + rb[3])
    trozo_a = za[y0 - ra[1]:y1 - ra[1], x0 - ra[0]:x1 - ra[0]]
    if zb is None:
        return bool(trozo_a.any())
    return bool((trozo_a & zb[y0 - rb[1]:y1 - rb[1], x0 - rb[0]:x1 - rb[0]]).any())


def cabe(p: Pieza, otras: list[Pieza], ancho: float, largo: float, paso: float, cfg: dict, radio: float,
         x: int, y: int, giro: int, usadas: list[tuple[int, int, int, int]] | None = None) -> str | None:
    """¿Cabe la pieza en esa posición (celdas) y giro? None si cabe; si no, el motivo.

    `usadas`: zonas de la placa ya fresadas en tiradas anteriores (x, y, ancho, largo en celdas)."""
    borde = margen_borde(radio, paso, cfg)
    m = margen_celdas(radio, paso, cfg)
    W, L = int(round(ancho / paso)) + 1, int(round(largo / paso)) + 1
    r = huella(p, m, x, y, giro)
    z = zona(p, m, giro)
    filas, cols = np.flatnonzero(z.any(axis=1)), np.flatnonzero(z.any(axis=0))
    if (not len(filas) or r[0] + cols[0] < borde or r[1] + filas[0] < borde
            or r[0] + cols[-1] + 1 > W - borde or r[1] + filas[-1] + 1 > L - borde):
        return "se sale de la plancha (la fresa necesita sitio alrededor del pie)"
    for q in otras:
        if q is not p and q.colocada and _zonas_se_pisan(z, r, zona(q, m), huella(q, m)):
            return f"queda demasiado cerca de {q.nombre} (las fresas de los dos se tocarían)"
    for u in usadas or []:
        if _zonas_se_pisan(z, r, None, u):
            return "esa parte de la placa ya está fresada (de una tirada anterior)"
    return None


def colocar(piezas: list[Pieza], ancho: float, largo: float, paso: float, cfg: dict,
            radio: float, avisos: list[str] | None = None,
            usadas: list[tuple[int, int, int, int]] | None = None) -> list[Pieza]:
    """Coloca las piezas en la plancha lo más juntas posible por su FORMA (no por su rectángulo): los
    recorridos de la fresa de dos pies vecinos pueden coincidir, y lo que corta la fresa nunca pasa del
    borde de la plancha. Cada pie, del más grande al más
    pequeño, va en el sitio libre más cercano al origen; se prueban varias maneras (llenando primero
    hacia la derecha o hacia detrás, y con los pies a lo largo, atravesados o de cualquier forma) y se
    queda la que mete más pies en menos sitio. Las puestas a mano (`fija`) se dejan donde están si
    siguen cabiendo; el resto se coloca alrededor. Las zonas `usadas` (ya fresadas en tiradas anteriores
    de la misma placa) no se tocan. Devuelve las que NO caben."""
    borde = margen_borde(radio, paso, cfg)
    m = margen_celdas(radio, paso, cfg)
    W, L = int(round(ancho / paso)) + 1, int(round(largo / paso)) + 1
    for p in piezas:
        if not p.fija:
            p.x = p.y = None
    fijas = []
    for p in piezas:
        if not p.fija:
            continue
        motivo = None if p.colocada else "sin posición"
        if motivo is None:
            motivo = cabe(p, fijas, ancho, largo, paso, cfg, radio, p.x, p.y, p.giro, usadas)
        if motivo:
            p.fija = False
            p.x = p.y = None
            if avisos is not None:
                avisos.append(f"{p.nombre} ya no cabe donde lo pusiste ({motivo}): se ha colocado solo.")
            continue
        fijas.append(p)
    k = max(1, int(round(2.0 / paso)))  # se busca sitio en saltos de ~2 mm
    Wc, Lc = -(-W // k), -(-L // k)
    ocupado = np.ones((Lc * k, Wc * k), bool)
    ocupado[borde:L - borde, borde:W - borde] = False
    for ux, uy, uw, ul in usadas or []:
        ocupado[max(uy, 0):max(uy + ul, 0), max(ux, 0):max(ux + uw, 0)] = True
    for p in fijas:
        x, y, w, l = huella(p, m)
        ocupado[y:y + l, x:x + w] |= zona(p, m)
    sueltas = sorted([q for q in piezas if not q.fija], key=lambda q: -q.h.size)
    if cfg.get("permitir_giro", True):
        juegos = ((0, 2), (1, 3), (0, 1, 2, 3))
    else:
        juegos = ((0,),)
    mejor = None
    for giros in juegos:
        for hacia in ("derecha", "detras"):
            puestas = _rellenar(sueltas, ocupado, m, k, giros, hacia)
            n = sum(1 for v in puestas.values() if v)
            # Rectángulo desde el origen que hace falta para lo puesto: cuanto menor, más placa libre.
            esquinas = [(x - m + zona(q, m, g).shape[1], y - m + zona(q, m, g).shape[0])
                        for q in sueltas if puestas[id(q)] for x, y, g in [puestas[id(q)]]] or [(0, 0)]
            clave = (-n, max(e[0] for e in esquinas) * max(e[1] for e in esquinas))
            if mejor is None or clave < mejor[0]:
                mejor = (clave, puestas)
    sobran = []
    for p in sueltas:
        sitio = mejor[1][id(p)]
        if sitio is None:
            sobran.append(p)
        else:
            p.x, p.y, p.giro = sitio
    return sobran


def _rellenar(piezas: list[Pieza], ocupado: np.ndarray, m: int, k: int, giros, hacia: str) -> dict:
    """Una manera de colocar: cada pieza en el primer sitio libre (lo más a la izquierda y luego lo más
    delante, o al revés). Busca en una rejilla gruesa (bloques de k × k celdas, ocupado si lo está alguna
    celda): lo que cabe en ella cabe seguro. Devuelve {id(pieza): (x, y, giro) o None}."""
    from scipy.signal import fftconvolve

    ocupado = ocupado.copy()
    Lc, Wc = ocupado.shape[0] // k, ocupado.shape[1] // k
    sitios: dict = {}
    for p in piezas:
        grueso = ocupado.reshape(Lc, k, Wc, k).any(axis=(1, 3)).astype(float)
        mejor = None
        for g in giros:
            z = zona(p, m, g)
            a, b = z.shape
            zp = np.zeros((-(-a // k) * k, -(-b // k) * k), bool)
            zp[:a, :b] = z
            zg = zp.reshape(zp.shape[0] // k, k, zp.shape[1] // k, k).any(axis=(1, 3))
            if zg.shape[0] > Lc or zg.shape[1] > Wc:
                continue
            libres = np.argwhere(fftconvolve(grueso, zg[::-1, ::-1].astype(float), mode="valid") < 0.5)
            if not len(libres):
                continue
            derecha, detras = libres[:, 1] * k + b, libres[:, 0] * k + a
            orden = np.lexsort((detras, derecha)) if hacia == "derecha" else np.lexsort((derecha, detras))
            i = orden[0]
            clave = (int(derecha[i]), int(detras[i])) if hacia == "derecha" else (int(detras[i]), int(derecha[i]))
            if mejor is None or clave < mejor[0]:
                mejor = (clave, int(libres[i, 1]) * k, int(libres[i, 0]) * k, g, z)
        if mejor is None:
            sitios[id(p)] = None
            continue
        _, x0, y0, g, z = mejor
        # Afinar celda a celda (la rejilla gruesa deja hasta k celdas de más): acercarlo al origen
        # mientras siga cabiendo de verdad.
        a, b = z.shape

        def cabe_en(x, y):
            return x >= 0 and y >= 0 and not (ocupado[y:y + a, x:x + b] & z).any()

        pasos = ((-1, 0), (0, -1)) if hacia == "derecha" else ((0, -1), (-1, 0))
        movido = True
        while movido:
            movido = False
            for dx, dy in pasos:
                while cabe_en(x0 + dx, y0 + dy):
                    x0, y0, movido = x0 + dx, y0 + dy, True
        ocupado[y0:y0 + a, x0:x0 + b] |= z
        sitios[id(p)] = (x0 + m, y0 + m, g)
    return sitios


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


def superficie_fresada(h: np.ndarray, radio: float, paso: float, relleno: float = 0.0) -> np.ndarray:
    """Lo que deja de verdad la fresa de bola si la punta pasa por `superficie_punta`: en los huecos más
    estrechos que la bola queda escayola sin quitar. Siempre >= h."""
    punta = superficie_punta(h, radio, paso, relleno)
    r = int(np.ceil(radio / paso))
    b = bola(radio, paso)
    # Fondo de la bola respecto a su punta: R - sqrt(R² - d²) (fuera del disco no cuenta).
    estructura = np.where(np.isfinite(b), b - radio, -1e6)
    pp = np.pad(punta, r, mode="edge")
    return ndimage.grey_erosion(pp, structure=estructura, mode="nearest")[r:-r, r:-r]


def donde_no_llega(h: np.ndarray, radio: float, paso: float, zona: np.ndarray | None = None,
                   paso_calculo: float = 1.0) -> np.ndarray:
    """Cuánta escayola (mm) queda sin quitar en cada punto porque la bola no cabe (huecos estrechos,
    esquinas). Se calcula con una rejilla de `paso_calculo` mm (es un aviso, no hace falta más detalle)
    y solo en el recuadro de `zona` (con margen)."""
    out = np.zeros(h.shape)
    if zona is not None and not zona.any():
        return out
    margen = int(np.ceil(2 * radio / paso)) + 2
    if zona is not None:
        jj, ii = np.nonzero(zona)
        j0, j1 = max(jj.min() - margen, 0), min(jj.max() + margen + 1, h.shape[0])
        i0, i1 = max(ii.min() - margen, 0), min(ii.max() + margen + 1, h.shape[1])
    else:
        j0, j1, i0, i1 = 0, h.shape[0], 0, h.shape[1]
    sub = h[j0:j1, i0:i1]
    k = max(1, int(round(paso_calculo / paso)))
    if k > 1:
        reducido = ndimage.maximum_filter(sub, size=k)[::k, ::k]  # conservador: lo más alto de cada celda
        fresado = superficie_fresada(reducido, radio, paso * k, float(sub.min()))
        resto = np.clip(fresado - reducido, 0, None)
        resto = ndimage.zoom(resto, (sub.shape[0] / resto.shape[0], sub.shape[1] / resto.shape[1]), order=1)
        resto = resto[:sub.shape[0], :sub.shape[1]]
    else:
        resto = np.clip(superficie_fresada(sub, radio, paso, float(sub.min())) - sub, 0, None)
    out[j0:j0 + resto.shape[0], i0:i0 + resto.shape[1]] = resto
    if zona is not None:
        out[~zona] = 0.0
    return out


def no_llega_en_molde(z: np.ndarray, fondo: float, mascaras: list[np.ndarray], radio: float, paso: float,
                      borde_mm: float = 8.0) -> tuple[np.ndarray, dict]:
    """Escayola que la bola no podrá quitar en el molde, como se fresa de verdad (cada pie es una isla
    rodeada por el contorno, así que la fresa también entra por los lados).

    Devuelve el mapa (mm) y un resumen: máximo y superficie en la PLANTA (lo importante) y en el BORDE
    del pie (los `borde_mm` últimos mm, donde la planta se junta con la base)."""
    sil = np.zeros(z.shape, bool)
    for m in mascaras:
        sil |= silueta_de(np.where(m, np.clip(z - fondo, 0, None), 0.0), paso)
    if not sil.any():
        return np.zeros(z.shape), {"planta_max": 0.0, "borde_max": 0.0, "planta_mm2": 0.0}
    h = np.where(sil, z, fondo - 2 * radio)  # alrededor del pie: la ranura del contorno
    d = donde_no_llega(h, radio, paso, sil)
    interior = ndimage.distance_transform_edt(sil, sampling=paso) > borde_mm
    planta, borde = d[interior], d[sil & ~interior]
    return d, {"planta_max": float(planta.max()) if planta.size else 0.0,
               "borde_max": float(borde.max()) if borde.size else 0.0,
               "planta_mm2": float((planta > 0.3).sum() * paso * paso)}


def en_vacio(gcode: str, por_encima: float = 5.0) -> str:
    """El mismo programa entero, pero subido lo justo para que la fresa nunca baje de `por_encima` mm
    sobre la plancha, y con el cabezal apagado: para comprobar el origen y los recorridos sin cortar."""
    import re

    numero = re.compile(r"Z(-?\d+\.?\d*)")
    zs = [float(m.group(1)) for linea in gcode.splitlines() if linea.startswith(("G0 ", "G1 "))
          for m in numero.finditer(linea)]
    sube = max(0.0, por_encima - min(zs, default=0.0))
    lineas = [comentario(f"PRUEBA EN VACIO: todo {sube:.1f} mm mas alto (nunca baja de {por_encima:g} mm sobre la "
                         f"plancha), cabezal apagado. NO CORTA."),
              comentario("Si todo va bien, despues lanza el archivo normal.")]
    for linea in gcode.splitlines():
        if re.match(r"^S\d+ M3$", linea) or linea.startswith("G4 "):
            lineas.append(comentario(f"{linea} quitado en la prueba en vacio"))
            continue
        if linea.startswith(("G0 ", "G1 ")):
            linea = numero.sub(lambda m: f"Z{float(m.group(1)) + sube:.3f}", linea)
        lineas.append(linea)
    return "\n".join(lineas) + "\n"


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


def _suavizar_lazo(pts: np.ndarray, paso: float, sigma_mm: float = 1.0) -> np.ndarray:
    """Quita a una vuelta del desbaste los escalones de la rejilla (línea de nivel de una distancia
    calculada en celdas): sin ellos se puede simplificar en tramos largos y la máquina va a su
    velocidad en vez de frenar en cada escalón. Mueve la línea como mucho unas décimas de mm, menos
    que el sobrante que deja el desbaste."""
    if len(pts) < 5:
        return pts
    cerrada = np.linalg.norm(pts[0] - pts[-1]) < 1e-6
    base = pts[:-1] if cerrada else pts
    sigma = sigma_mm / paso
    suave = ndimage.gaussian_filter1d(base, sigma, axis=0, mode="wrap" if cerrada else "nearest")
    if cerrada:
        return np.vstack([suave, suave[:1]])
    suave[0], suave[-1] = pts[0], pts[-1]
    return suave


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

    def bajar_a(self, x, y, z, z_libre, z_techo=None):
        """Subir sobre la plancha, ir encima del punto, bajar rápido hasta 1 mm sobre el material
        que pueda haber ahí (`z_libre`) y entrar despacio hasta z. Si la bola alcanza escayola sin fresar
        más alta (`z_techo`: junto al borde, antes del contorno), en rápido solo hasta 1 mm sobre ella."""
        z_rapido = z_libre if z_techo is None else max(z_libre, z_techo)
        arriba = max(self.z_paso, z_rapido + 1.0)
        if self.pos[2] < arriba:
            self.rapido(z=arriba)
        self.rapido(x=x, y=y)
        self.rapido(z=z_rapido + 1.0)
        if z < z_libre:
            self.corte(x, y, z_libre, self.cfg["avance_entrada"])
        self.corte(x, y, z, self.cfg["avance_bajada"] if z < z_libre else self.cfg["avance_entrada"])

    def subir(self, z=None):
        self.rapido(z=self.z_paso if z is None else z)

    def helice(self, cx: float, cy: float, z_ini: float, z_fin: float, radio: float, grados: float,
               avance: float, por_vuelta: int = 24) -> None:
        """Entra en el material bajando en hélice alrededor de (cx, cy), como el desbaste de Fusion, en vez
        de clavar la fresa en vertical. Empieza y acaba en la posición actual (que está en la
        circunferencia), con vueltas enteras. En G1 cortos (la prueba en vacío y las comprobaciones los leen)."""
        x0, y0 = float(self.pos[0]), float(self.pos[1])
        a0 = math.atan2(y0 - cy, x0 - cx)
        baja = 2 * math.pi * radio * math.tan(math.radians(grados))
        vueltas = max(1, math.ceil((z_ini - z_fin) / baja - 1e-9))
        self.corte(x0, y0, z_ini, avance)
        n = vueltas * por_vuelta
        for k in range(1, n + 1):
            a = a0 + 2 * math.pi * k / por_vuelta
            z = z_ini + (z_fin - z_ini) * k / n
            x, y = (x0, y0) if k % por_vuelta == 0 else (cx + radio * math.cos(a), cy + radio * math.sin(a))
            self.corte(x, y, z, avance)


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
    # Zonas de la placa ya fresadas en tiradas anteriores (x, y, ancho, largo en mm), para el mapa.
    usadas: list = field(default_factory=list)
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
    """Desbaste «grande» en cajeras, como el de Fusion: en niveles planos de Z (`bajada_por_pasada`). En cada
    nivel, cada zona que se puede vaciar (por encima del nivel y donde el molde queda más abajo) se recorre en
    vueltas paralelas a su borde, de dentro hacia fuera y separadas `paso_desbaste` mm, entrando una sola vez
    (en hélice donde cabe). No sigue la forma del pie: deja escalones que quita el paralelo."""
    sub = punta[c.y0:c.y1, c.x0:c.x1]
    objetivo = sub + cfg["sobrante_desbaste"]
    r = int(np.ceil(radio / paso))
    dentro = c.sil
    material = np.where(dentro, float(H), -np.inf)
    # Donde la bola llega a fuera de la silueta todavía hay escayola entera (el contorno va al final).
    al_borde = _cerca_del_borde(dentro, r)
    radio_h = cfg.get("radio_helice", 0.0)
    rh = int(np.ceil(radio_h / paso))
    fondo_min = float(objetivo[dentro].min())
    baj = cfg["bajada_por_pasada"]
    niveles = [float(z) for z in np.arange(H - baj, fondo_min, -baj)] + [fondo_min]
    capas = 0
    for nivel in niveles:
        zona = dentro & (objetivo <= nivel) & (material - nivel > 0.05)
        if not zona.any():
            continue
        # Lo más alto que hay cerca (escalones de niveles anteriores): para bajar en rápido sin tocarlo.
        alto_cerca = ndimage.maximum_filter(material, size=2 * (r + rh) + 1)
        etiquetas, n = ndimage.label(zona, structure=np.ones((3, 3)))
        # Las motas sueltas junto al borde (menos de 5 mm²) no merecen una entrada: las quita la bola al pasar.
        areas = ndimage.sum(zona, etiquetas, range(1, n + 1)) * paso * paso
        pendientes = [k for k in range(1, n + 1) if areas[k - 1] >= 5.0]
        while pendientes:
            # La zona más cercana a donde está la fresa.
            centros = {}
            for k in pendientes:
                comp = etiquetas == k
                d = ndimage.distance_transform_edt(np.pad(comp, 1), sampling=paso)[1:-1, 1:-1]
                jc, kc = np.unravel_index(int(np.argmax(d)), d.shape)
                centros[k] = (comp, d, jc, kc)
            k = min(pendientes, key=lambda q: np.hypot((c.x0 + centros[q][3]) * paso - w.pos[0],
                                                       (c.y0 + centros[q][2]) * paso - w.pos[1]))
            pendientes.remove(k)
            comp, d, jc, kc = centros[k]
            _vaciar_zona(w, comp, d, jc, kc, objetivo, material, alto_cerca, al_borde, nivel, paso, H, c, cfg)
        material = np.where(zona, nivel, material)
        capas += 1
    w.subir()
    return capas


def _vaciar_zona(w: _Escritor, comp, d, jc, kc, objetivo, material, alto_cerca, al_borde, nivel, paso, H, c,
                 cfg) -> None:
    """Una cajera: entrar en el punto más alejado del borde (en hélice si cabe; si la zona es estrecha, en
    rampa siguiendo la primera vuelta) y dar vueltas paralelas al borde de dentro hacia fuera."""
    import contourpy

    s = cfg["paso_desbaste"]
    radio_h = cfg.get("radio_helice", 0.0)
    grados = cfg.get("rampa_grados", 2.0)
    dmax = float(d[jc, kc])
    cx, cy = (c.x0 + kc) * paso, (c.y0 + jc) * paso
    lib = min(float(H), float(material[comp].max()) + 0.3)
    techo = float(alto_cerca[jc, kc]) + 0.3
    z_techo = 0.0 if al_borde[jc, kc] else min(techo, float(H)) - H
    # Vueltas: líneas donde la distancia al borde vale d0, d0 + s, …, de la más interior a la exterior.
    d0 = paso
    vueltas: list[list[np.ndarray]] = []
    if dmax > d0 + 1e-6:
        gen = contourpy.contour_generator(z=np.pad(d, 1))
        for dist in reversed(list(np.arange(d0, dmax - s / 2 + 1e-6, s)) or [d0]):
            lineas = [np.column_stack([(ln[:, 0] - 1 + c.x0) * paso, (ln[:, 1] - 1 + c.y0) * paso])
                      for ln in gen.lines(float(dist)) if len(ln) >= 3]
            if lineas:
                vueltas.append(lineas)
    if radio_h > 0 and dmax >= radio_h + paso and lib - nivel > 0.5:
        w.bajar_a(cx + radio_h, cy, lib - H, lib - H, z_techo)
        w.helice(cx, cy, lib - H, nivel - H, radio_h, grados, cfg["avance_entrada"])
    elif vueltas and radio_h > 0 and lib - nivel > 0.5:
        # Zona estrecha: entra en rampa por la primera vuelta (como el contorno), sin clavar la fresa.
        lazo = max(vueltas[0], key=len)
        vueltas[0] = [ln for ln in vueltas[0] if ln is not lazo]
        lazo = _suavizar_lazo(lazo, paso)
        pts = lazo[_simplificar_xy(lazo, TOL_DESBASTE)]
        z_t = 0.0 if al_borde.any() and _toca(al_borde, pts, paso, c) else z_techo
        w.bajar_a(pts[0, 0], pts[0, 1], lib - H, lib - H, z_t)
        _rampa_por(w, pts, lib - H, nivel - H, grados, cfg["avance_entrada"], cfg["avance_desbaste"])
    else:  # zona pequeña (o casi no hay que bajar): en vertical, despacio
        w.bajar_a(cx, cy, nivel - H, lib - H, z_techo)
    for lineas in vueltas:
        while lineas:
            pos = w.pos[:2]
            cerca = [np.linalg.norm(m - pos, axis=1) for m in lineas]
            q = int(np.argmin([cc.min() for cc in cerca]))
            pts = lineas.pop(q)
            if np.linalg.norm(pts[0] - pts[-1]) < 1e-6:  # cerrada: empezar por el punto más cercano
                i0 = int(np.argmin(cerca[q][:-1]))
                pts = np.vstack([pts[i0:-1], pts[:i0 + 1]])
            pts = _suavizar_lazo(pts, paso)
            pts = pts[_simplificar_xy(pts, TOL_DESBASTE)]
            _ir_a(w, pts[0], objetivo, comp, nivel, paso, H, c, cfg)
            for x, y in pts[1:]:
                w.corte(x, y, nivel - H, cfg["avance_desbaste"])


def _toca(mascara: np.ndarray, pts: np.ndarray, paso: float, c: _Colocada) -> bool:
    kk = np.clip(np.rint(pts[:, 0] / paso).astype(int) - c.x0, 0, mascara.shape[1] - 1)
    jj = np.clip(np.rint(pts[:, 1] / paso).astype(int) - c.y0, 0, mascara.shape[0] - 1)
    return bool(mascara[jj, kk].any())


def _rampa_por(w: _Escritor, pts: np.ndarray, z_ini: float, z_fin: float, grados: float, avance_rampa: float,
               avance: float) -> None:
    """Baja de z_ini a z_fin avanzando por la línea `pts` (dando las vueltas que haga falta si es cerrada) con
    la inclinación `grados`, y después la recorre entera al nivel final."""
    cerrada = np.linalg.norm(pts[0] - pts[-1]) < 1e-6
    tramo = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    largo_rampa = (z_ini - z_fin) / math.tan(math.radians(grados))
    if not cerrada or tramo[-1] < 1e-6:
        # Línea abierta: ida y vuelta por ella hasta llegar abajo.
        ida = np.vstack([pts, pts[::-1][1:]])
        pts, tramo = ida, np.r_[0, np.cumsum(np.linalg.norm(np.diff(ida, axis=0), axis=1))]
    recorrido = 0.0
    z = z_ini
    i = 0
    n = len(pts)
    while z > z_fin + 1e-9:
        a, b = pts[i % (n - 1)], pts[i % (n - 1) + 1]
        largo = float(np.linalg.norm(b - a))
        recorrido += largo
        z = max(z_fin, z_ini - (z_ini - z_fin) * recorrido / max(largo_rampa, 1e-9))
        w.corte(b[0], b[1], z, avance_rampa)
        i += 1
    # Una vuelta entera al nivel final (la rampa ha dejado el suelo inclinado).
    k = i % (n - 1)
    for b in np.vstack([pts[k + 1:], pts[1:k + 1]]):
        w.corte(b[0], b[1], z_fin, avance)


def _ir_a(w: _Escritor, destino, objetivo, comp, nivel, paso, H, c, cfg) -> None:
    """Pasar a la vuelta siguiente: en línea recta al nivel si el camino va por la zona que se vacía; si no,
    por encima de lo que debe quedar."""
    a, b = w.pos[:2], np.asarray(destino, float)
    n = max(2, int(np.linalg.norm(b - a) / (paso / 2)) + 1)
    t = np.linspace(0, 1, n)
    kk = np.clip(np.rint((a[0] + (b[0] - a[0]) * t) / paso).astype(int) - c.x0, 0, comp.shape[1] - 1)
    jj = np.clip(np.rint((a[1] + (b[1] - a[1]) * t) / paso).astype(int) - c.y0, 0, comp.shape[0] - 1)
    if comp[jj, kk].all():
        w.corte(b[0], b[1], nivel - H, cfg["avance_desbaste"])
        return
    zl = float(max(objetivo[jj, kk].max(), nivel)) + 0.5
    w.corte(a[0], a[1], max(zl, w.pos[2] + H) - H, cfg["avance_entrada"])
    w.corte(b[0], b[1], max(zl, w.pos[2] + H) - H, cfg["avance_entrada"])
    w.corte(b[0], b[1], nivel - H, cfg["avance_bajada"])


def _cerca_del_borde(sil: np.ndarray, r: int) -> np.ndarray:
    """Celdas de la silueta a menos de `r` celdas de su borde (la bola de ahí alcanza fuera de la silueta)."""
    con_margen = np.pad(sil, r + 1, constant_values=False)
    d = ndimage.distance_transform_edt(con_margen)[r + 1:-(r + 1), r + 1:-(r + 1)]
    return sil & (d <= r)


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
            # Al empezar puede haber escayola entera cerca (el contorno va al final): en rápido solo
            # hasta 1 mm sobre la plancha.
            w.bajar_a(xs[i], y, punta[j, i] - H, punta[j, i] + holgura - H, 0.0)
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
                  cfg: dict, colocar_antes: bool = True,
                  usadas: list[tuple[int, int, int, int]] | None = None) -> TrabajoCNC:
    """Coloca las piezas y prepara el mapa SIN calcular trayectorias (es casi instantáneo).

    La numeración y las posiciones son las mismas que tendrá el .nc si después se llama a
    `generar(..., colocar_antes=False)`. El contorno que se dibuja es aproximado (a un radio de la silueta)."""
    a_paso(piezas, paso)
    avisos = ajustar_alto(piezas, alto, cfg)
    sobran = (colocar(piezas, ancho, largo, paso, cfg, radio, avisos, usadas) if colocar_antes
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
    if sobran:
        avisos.append(f"No caben {len(sobran)} pieza(s): " + ", ".join(p.nombre for p in sobran)
                      + ". Usa otra plancha o hazlas en otra tirada.")
    return TrabajoCNC(gcode="", plancha=(ancho, largo, float(alto)), tiempo_min=float("nan"), piezas=puestas,
                      sobran=sobran, altura=h, punta=h, zona=zona, paso=paso,
                      contornos=[f.contorno for f in fichas if f.contorno is not None], fichas=fichas,
                      avisos=avisos, previa=True)


def generar(piezas: list[Pieza], ancho: float, largo: float, alto: float, paso: float,
            radio: float, cfg: dict, colocar_antes: bool = True,
            usadas: list[tuple[int, int, int, int]] | None = None) -> TrabajoCNC:
    """Coloca las piezas en la plancha y genera el G-code de toda la tirada."""
    a_paso(piezas, paso)
    avisos = ajustar_alto(piezas, alto, cfg)
    sobran = (colocar(piezas, ancho, largo, paso, cfg, radio, usadas=usadas) if colocar_antes
              else [p for p in piezas if not p.colocada])
    puestas = [p for p in piezas if p.colocada]
    if not puestas:
        raise ValueError("Ninguna pieza cabe en la plancha.")
    H = float(alto)
    h, zona, colocadas, punta_pies = componer(puestas, ancho, largo, H, paso, radio, cfg)
    punta = superficie_punta(h, radio, paso, 0.0)
    zseg = cfg["altura_seguridad"]
    suelo = min(c.suelo for c in colocadas)
    w = _Escritor(cfg, zseg)
    w.lineas += [
        comentario(f"Ortosend Taller - tirada de {len(puestas)} pieza/s en {cfg.get('material', '')}"),
        comentario(f"Plancha {ancho:.0f} x {largo:.0f} x {H:.0f} mm - ancho X x largo Y x alto Z"),
        comentario("ORIGEN: X0 Y0 = esquina DELANTERA IZQUIERDA de la plancha - Z0 = cara de ARRIBA"),
        comentario(f"T1 D={2 * radio:g} CR={radio:g} - ZMIN={-(H - suelo):.3f} - fresa con punta de bola"),
        *([comentario("Velocidades y pasadas cambiadas en Ajustes de la CNC")] if cfg.get("ajustes_propios") else []),
        "G90 G94", "G17", "G21",
        "T1", f"S{cfg['revoluciones']:.0f} M3", "G4 P3", "G17 G90 G94", "G54",
        f"G0 Z{zseg:g}",
    ]
    numero = {id(p): n for n, p in enumerate(orden_fresado(puestas, paso))}
    orden = sorted(colocadas, key=lambda c: numero[id(c.pieza)])
    tiempos = {"contorno": 0.0, "desbaste": 0.0, "acabado": 0.0, "movimientos": 0.0}
    capas_de: list[int] = []
    lineas_de: list[int] = []
    vueltas_de: list[int] = []
    fichas = []
    t_pieza = {id(c): 0.0 for c in orden}

    def fase(c: _Colocada, n: int, nombre: str, hacer) -> None:
        """Una fase de una pieza: comentario con la fase delante (como Fusion) y su tiempo."""
        p = c.pieza
        a, b = p.forma()
        t0 = w.tiempo
        w.lineas.append(comentario(f"{nombre} - Pieza {n}: {p.nombre} - X {p.x * paso:.0f}-{(p.x + b - 1) * paso:.0f}, "
                                   f"Y {p.y * paso:.0f}-{(p.y + a - 1) * paso:.0f}"))
        hacer()
        w.rapido(z=zseg)
        t_pieza[id(c)] += w.tiempo - t0

    # Como Fusion, operación por operación en toda la plancha: primero el desbaste grande de todos los pies
    # (quita la carga), después el paralelo y el contorno al final (la escayola trabaja entera y firme).
    t0 = w.tiempo
    for n, c in enumerate(orden, 1):
        fase(c, n, f"Desbaste en cajeras, niveles de {cfg['bajada_por_pasada']:g} mm",
             lambda c=c: capas_de.append(_desbaste(w, punta, c, paso, H, cfg, radio)))
    tiempos["desbaste"] = w.tiempo - t0
    t0 = w.tiempo
    for n, c in enumerate(orden, 1):
        fase(c, n, f"Paralelo - acabado cada {cfg['paso_acabado']:g} mm",
             lambda c=c: lineas_de.append(_acabado(w, punta, c, paso, H, cfg)))
    tiempos["acabado"] = w.tiempo - t0
    t0 = w.tiempo
    for n, c in enumerate(orden, 1):
        if c.contorno is not None and cfg.get("contorno", True):
            fase(c, n, "2D Contorneado", lambda c=c: vueltas_de.append(_contorno(w, c.contorno, H, c.suelo, cfg)))
    tiempos["contorno"] = w.tiempo - t0
    capas, lineas, vueltas = max(capas_de, default=0), sum(lineas_de), sum(vueltas_de)
    for n, c in enumerate(orden, 1):
        p = c.pieza
        a, b = p.forma()
        fichas.append(Ficha(n, p, c.contorno, (p.x * paso, (p.x + b - 1) * paso), (p.y * paso, (p.y + a - 1) * paso),
                            p.alto, c.suelo, t_pieza[id(c)], _hacia_dedos(p)))
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
    for f in fichas:  # ¿queda escayola en la planta que la bola no puede quitar?
        _, r = no_llega_en_molde(f.pieza.h_girada(), 0.0, [f.pieza.silueta_girada()], radio, paso)
        if r["planta_max"] >= 0.5:
            trabajo.avisos.append(f"{f.nombre}: en la planta quedan hasta {r['planta_max']:.1f} mm que la bola de "
                                  f"Ø{2 * radio:g} no puede quitar (huecos más estrechos que la fresa).")
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
    extra = margen_borde(radio, paso, cfg) + margen_celdas(radio, paso, cfg)
    x1 = max(p.x + p.forma()[1] for p in puestas) + extra
    y1 = max(p.y + p.forma()[0] for p in puestas) + extra
    return (x1 - 1) * paso, (y1 - 1) * paso
