"""Salida directa para la CNC (sin pasar por Fusion 360).

- Se fresa en una PLANCHA de escayola (por defecto la mesa de la CNC, 600 × 500 × 40 mm). En una
  misma tirada caben varios moldes: cada pie es una «pieza» y se colocan automáticamente lo más
  juntas posible (girándolas si hace falta) para aprovechar la plancha.
- Origen SIEMPRE en el mismo sitio: X0 Y0 = esquina delantera izquierda de la plancha,
  Z0 = su cara de arriba (todo el trabajo en X, Y positivos y Z negativos).
- Solo se fresa el rectángulo de cada pieza (pie + margen de base); el resto de la plancha no se toca,
  así se tarda menos y quedan paredes para separar las piezas después.
- Fresa de punta de bola: se calcula dónde debe ir la PUNTA para que la bola toque el molde sin
  comérselo (superficie desplazada), también junto a las paredes de escayola sin tocar.
- Desbaste por capas gruesas (1 cm) que deja `sobrante_desbaste`; luego acabado en zigzag a lo largo
  de cada pieza con la separación que deja crestas de como mucho `cresta_acabado`.
- G-code GRBL (G21 G90, M3/M5), sin cambios de herramienta.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage


# ---------------------------------------------------------------------------
# Piezas (un pie cada una) y su colocación en la plancha
# ---------------------------------------------------------------------------

@dataclass
class Pieza:
    nombre: str
    h: np.ndarray  # altura del molde sobre el fondo de la plancha (mm), rectángulo con margen
    fondo: float  # altura de la base del molde
    paso: float = 0.5  # mm entre puntos de `h`
    x: int | None = None  # posición (celdas) de la esquina delantera izquierda en la plancha
    y: int | None = None
    giro: int = 0  # cuartos de vuelta (0..3)

    @property
    def colocada(self) -> bool:
        return self.x is not None

    def forma(self, giro: int | None = None) -> tuple[int, int]:
        g = self.giro if giro is None else giro
        ny, nx = self.h.shape
        return (nx, ny) if g % 2 else (ny, nx)

    def h_girada(self) -> np.ndarray:
        return np.rot90(self.h, k=self.giro)


def piezas_de_molde(z: np.ndarray, fondo: float, mascaras: list[np.ndarray], nombres: list[str],
                    paso: float, cfg: dict) -> list[Pieza]:
    """Un rectángulo por pie: el pie con `margen_pie` de base alrededor."""
    margen = int(round(cfg["margen_pie"] / paso))
    piezas = []
    for m, nombre in zip(mascaras, nombres):
        relieve = m & (z - fondo > 0.05)
        if not relieve.any():
            continue
        jj, ii = np.nonzero(relieve)
        j0, j1 = max(jj.min() - margen, 0), min(jj.max() + margen + 1, z.shape[0])
        i0, i1 = max(ii.min() - margen, 0), min(ii.max() + margen + 1, z.shape[1])
        zona = ndimage.binary_dilation(relieve, iterations=margen)[j0:j1, i0:i1]
        piezas.append(Pieza(nombre, np.where(zona, z[j0:j1, i0:i1], fondo), fondo, paso))
    return piezas


def a_paso(piezas: list[Pieza], paso: float) -> None:
    """Pasa todas las piezas a la misma separación de puntos (por si vienen de moldes distintos)."""
    for p in piezas:
        if abs(p.paso - paso) > 1e-9:
            p.h = ndimage.zoom(p.h, p.paso / paso, order=1)
            p.paso = paso


def colocar(piezas: list[Pieza], ancho: float, largo: float, paso: float, cfg: dict) -> list[Pieza]:
    """Coloca las piezas en la plancha lo más juntas posible (MaxRects: mejor hueco por el lado
    corto), girándolas 90° si cabe mejor. Devuelve las que NO caben."""
    borde = int(round(cfg["margen_bloque"] / paso))
    sep = int(round(cfg["separacion"] / paso))
    W = int(round(ancho / paso)) + 1 - 2 * borde + sep
    L = int(round(largo / paso)) + 1 - 2 * borde + sep
    libres = [(0, 0, W, L)]  # (x, y, ancho, largo) en celdas
    giros = (0, 1) if cfg.get("permitir_giro", True) else (0,)
    sobran = []
    for p in piezas:
        p.x = p.y = None
    for p in sorted(piezas, key=lambda q: -q.h.size):
        mejor = None
        for g in giros:
            ny, nx = p.forma(g)
            w, l = nx + sep, ny + sep
            for fx, fy, fw, fl in libres:
                if w <= fw and l <= fl:
                    clave = (min(fw - w, fl - l), fy, fx)
                    if mejor is None or clave < mejor[0]:
                        mejor = (clave, fx, fy, g, w, l)
        if mejor is None:
            sobran.append(p)
            continue
        _, fx, fy, g, w, l = mejor
        p.x, p.y, p.giro = fx + borde, fy + borde, g
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


def componer(piezas: list[Pieza], ancho: float, largo: float, alto: float, paso: float):
    """Alturas de la plancha terminada (alto = sin tocar) y máscara de lo que se fresa."""
    nx, ny = int(round(ancho / paso)) + 1, int(round(largo / paso)) + 1
    h = np.full((ny, nx), alto)
    zona = np.zeros((ny, nx), bool)
    for p in piezas:
        if not p.colocada:
            continue
        hp = p.h_girada()
        a, b = hp.shape
        h[p.y:p.y + a, p.x:p.x + b] = hp
        zona[p.y:p.y + a, p.x:p.x + b] = True
    return h, zona


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
    aceptan caracteres básicos)."""
    t = texto.replace("·", "-").replace("×", "x").replace("º", "").replace("ª", "")
    return unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode("ascii")


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

    def bajar_a(self, x, y, z):
        """Subir a la altura de seguridad, ir encima del punto y bajar despacio hasta z."""
        self.rapido(z=self.z_seguro)
        self.rapido(x=x, y=y)
        self.rapido(z=min(self.z_seguro, z + 2.0))
        self.corte(x, y, z, self.cfg["avance_bajada"])
        self.f_actual = None


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
    resumen: dict = field(default_factory=dict)
    avisos: list[str] = field(default_factory=list)

    @property
    def aprovechamiento(self) -> float:
        return float(self.zona.mean())


def _desbaste(w: _Escritor, punta, x0, x1, y0, y1, paso, H, cfg) -> int:
    """Desbaste por capas gruesas de un rectángulo [x0, x1) × [y0, y1) (celdas)."""
    sub = punta[y0:y1, x0:x1]
    objetivo = sub + cfg["sobrante_desbaste"]
    material = np.full(sub.shape, H)
    niveles = []
    nivel = H - cfg["bajada_por_pasada"]
    fondo_min = float(objetivo.min())
    while nivel > fondo_min + 1e-6:
        niveles.append(nivel)
        nivel -= cfg["bajada_por_pasada"]
    niveles.append(fondo_min)
    paso_lin = max(1, int(round(cfg["paso_desbaste"] / paso)))
    cols = list(range(0, sub.shape[1], paso_lin))
    if cols[-1] != sub.shape[1] - 1:
        cols.append(sub.shape[1] - 1)
    ys = (np.arange(y0, y1)) * paso
    capas = 0
    for nivel in niveles:
        corte = np.maximum(nivel, objetivo)
        hubo = False
        sentido = 1
        for i in cols:
            prof = corte[:, i]
            x = (x0 + i) * paso
            for a, b in _tramos(material[:, i] - prof > 0.05, int(round(10 / paso)))[::sentido]:
                rango = np.arange(a, b + 1)[::sentido]
                w.bajar_a(x, ys[rango[0]], prof[rango[0]] - H)
                for k in rango[_simplificar(ys[rango] * sentido, prof[rango])]:
                    w.corte(x, ys[k], prof[k] - H, cfg["avance_desbaste"])
                hubo = True
            sentido = -sentido
        if hubo:
            capas += 1
            material = np.minimum(material, corte)
    w.rapido(z=w.z_seguro)
    return capas


def _acabado(w: _Escritor, punta, x0, x1, y0, y1, paso, H, cfg, radio) -> int:
    """Acabado en zigzag a lo largo de Y de un rectángulo, separación según la cresta permitida."""
    c = cfg["cresta_acabado"]
    s = 2 * np.sqrt(max(c * (2 * radio - c), 1e-9))
    paso_lin = max(1, int(np.floor(s / paso)))
    cols = list(range(x0, x1, paso_lin))
    if cols[-1] != x1 - 1:
        cols.append(x1 - 1)
    ys = np.arange(punta.shape[0]) * paso
    sentido = 1
    primero = True
    for i in cols:
        rango = np.arange(y0, y1)[::sentido]
        prof = punta[rango, i]
        sel = rango[_simplificar(ys[rango] * sentido, prof)]
        x = i * paso
        if primero:
            w.bajar_a(x, ys[sel[0]], punta[sel[0], i] - H)
            primero = False
        else:
            # A la siguiente línea por el extremo sin levantar: a la altura justa para no tocar nada.
            j = sel[0]
            i_prev = int(round(w.pos[0] / paso))
            zt = float(max(punta[j, min(i_prev, i):max(i_prev, i) + 1].max(), w.pos[2] + H))
            w.corte(w.pos[0], ys[j], zt - H, cfg["avance_acabado"])
            w.corte(x, ys[j], zt - H, cfg["avance_acabado"])
            w.corte(x, ys[j], punta[j, i] - H, cfg["avance_acabado"])
        for k in sel:
            w.corte(x, ys[k], punta[k, i] - H, cfg["avance_acabado"])
        sentido = -sentido
    w.rapido(z=w.z_seguro)
    return len(cols)


def generar(piezas: list[Pieza], ancho: float, largo: float, alto: float, paso: float,
            radio: float, cfg: dict, colocar_antes: bool = True) -> TrabajoCNC:
    """Coloca las piezas en la plancha y genera el G-code de toda la tirada."""
    a_paso(piezas, paso)
    sobran = colocar(piezas, ancho, largo, paso, cfg) if colocar_antes else [p for p in piezas if not p.colocada]
    puestas = [p for p in piezas if p.colocada]
    if not puestas:
        raise ValueError("Ninguna pieza cabe en la plancha.")
    H = alto
    h, zona = componer(puestas, ancho, largo, H, paso)
    if h.max() > H + 1e-6:
        raise ValueError(f"Algún molde ({h.max():.1f} mm) es más alto que la plancha ({H:.0f} mm).")
    punta = superficie_punta(h, radio, paso, 0.0)
    zseg = cfg["altura_seguridad"]
    w = _Escritor(cfg, zseg)
    w.lineas += [
        f"; Rectificador de moldes Ortosend - tirada de {len(puestas)} pieza(s) en {cfg.get('material', '')}",
        f"; Plancha: {ancho:.0f} x {largo:.0f} x {H:.0f} mm (ancho X x largo Y x alto Z)",
        "; ORIGEN: X0 Y0 = esquina DELANTERA IZQUIERDA de la plancha; Z0 = cara de ARRIBA",
        f"; Fresa: punta de bola diametro {2 * radio:.0f} mm (Z = punta de la bola)",
        "G21 ; milimetros", "G90 ; coordenadas absolutas", "G94 ; avance en mm/min",
        f"M3 S{cfg['revoluciones']:.0f}", "G4 P3 ; esperar a que coja revoluciones",
        f"G0 Z{zseg:.3f}",
    ]
    # Orden: de delante a detrás y de izquierda a derecha (menos recorrido en vacío).
    orden = sorted(puestas, key=lambda p: (p.y // max(1, int(100 / paso)), p.x))
    capas = lineas = 0
    for n, p in enumerate(orden, 1):
        a, b = p.h_girada().shape
        x0, x1, y0, y1 = p.x, p.x + b, p.y, p.y + a
        w.lineas.append(f"; ==== Pieza {n}: {texto_cnc(p.nombre)} (X {x0 * paso:.0f}-{(x1 - 1) * paso:.0f}, "
                        f"Y {y0 * paso:.0f}-{(y1 - 1) * paso:.0f}) ====")
        w.lineas.append("; -- desbaste --")
        capas = max(capas, _desbaste(w, punta, x0, x1, y0, y1, paso, H, cfg))
        w.lineas.append("; -- acabado --")
        lineas += _acabado(w, punta, x0, x1, y0, y1, paso, H, cfg, radio)
    w.rapido(z=zseg)
    w.rapido(x=0.0, y=0.0)
    w.lineas += ["M5", "M30"]
    w.lineas.insert(4, f"; Tiempo estimado: {w.tiempo:.0f} min")
    trabajo = TrabajoCNC(
        gcode="\n".join(w.lineas) + "\n", plancha=(ancho, largo, H), tiempo_min=w.tiempo,
        piezas=puestas, sobran=sobran, altura=h, punta=punta, zona=zona, paso=paso,
        resumen={"capas_desbaste": capas, "lineas_acabado": lineas, "z_minima": w.z_min},
    )
    if sobran:
        trabajo.avisos.append(f"No caben {len(sobran)} pieza(s): " + ", ".join(p.nombre for p in sobran)
                              + ". Usa otra plancha o hazlas en otra tirada.")
    return trabajo


def plancha_minima(piezas: list[Pieza], paso: float, cfg: dict, maximo: tuple[float, float]):
    """Coloca las piezas en una plancha del tamaño máximo y devuelve el tamaño justo que ocupan."""
    a_paso(piezas, paso)
    colocar(piezas, *maximo, paso, cfg)
    puestas = [p for p in piezas if p.colocada]
    if not puestas:
        return maximo
    borde = int(round(cfg["margen_bloque"] / paso))
    x1 = max(p.x + p.forma()[1] for p in puestas) + borde
    y1 = max(p.y + p.forma()[0] for p in puestas) + borde
    return (x1 - 1) * paso, (y1 - 1) * paso
