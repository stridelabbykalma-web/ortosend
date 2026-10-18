"""Salida directa para la CNC (sin pasar por Fusion 360).

- Los pies se colocan lo más juntos posible para usar el bloque más pequeño (talones a la misma
  altura), y se calcula qué bloque hay que preparar.
- Origen SIEMPRE en el mismo sitio: X0 Y0 en la esquina delantera izquierda del bloque,
  Z0 en su cara de arriba (todo el trabajo queda en X, Y positivos y Z negativos).
- Fresa de punta de bola: se calcula dónde debe ir la PUNTA de la bola para que la bola toque el
  molde sin comérselo (superficie desplazada). Así nunca se pasa, ni en zonas cóncavas estrechas.
- Desbaste por capas (deja `sobrante_desbaste`) y acabado en pasadas paralelas a lo largo del pie,
  con la separación que deja crestas de como mucho `cresta_acabado`.
- G-code GRBL (G21 G90, M3/M5), sin cambios de herramienta.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage


@dataclass
class TrabajoCNC:
    gcode: str
    bloque: tuple[float, float, float]  # ancho X, largo Y, alto Z del bloque a preparar (mm)
    tiempo_min: float
    altura: np.ndarray  # molde colocado en el bloque (mm sobre el fondo del bloque)
    punta: np.ndarray  # dónde va la punta de la bola (mm sobre el fondo del bloque)
    paso: float
    pasadas: dict = field(default_factory=dict)  # resumen: número de capas, pasadas...
    avisos: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# 1. Disposición compacta
# ---------------------------------------------------------------------------

def disponer(z: np.ndarray, fondo: float, mascaras: list[np.ndarray], paso: float, cfg: dict):
    """Recorta cada pie (con su margen) y los pone uno al lado del otro, talones alineados.

    Devuelve (altura en el bloque, ancho, largo). Fuera de los pies queda la base (fondo).
    """
    margen = int(round(cfg["margen_pie"] / paso))
    borde = int(round(cfg["margen_bloque"] / paso))
    piezas = []
    for m in mascaras:
        relieve = m & (z - fondo > 0.05)
        if not relieve.any():
            continue
        jj, ii = np.nonzero(relieve)
        j0, j1 = max(jj.min() - margen, 0), min(jj.max() + margen + 1, z.shape[0])
        i0, i1 = max(ii.min() - margen, 0), min(ii.max() + margen + 1, z.shape[1])
        zona = ndimage.binary_dilation(relieve, iterations=margen)[j0:j1, i0:i1]
        piezas.append((i0, np.where(zona, z[j0:j1, i0:i1], fondo)))
    if not piezas:
        raise ValueError("No hay ningún pie que fresar.")
    piezas.sort(key=lambda p: p[0])  # de izquierda a derecha, como en el molde
    alto_y = max(p[1].shape[0] for p in piezas) + 2 * borde
    ancho_x = sum(p[1].shape[1] for p in piezas) + 2 * borde
    h = np.full((alto_y, ancho_x), fondo)
    x = borde
    for _, pz in piezas:
        ny, nx = pz.shape
        h[borde:borde + ny, x:x + nx] = np.maximum(h[borde:borde + ny, x:x + nx], pz)
        x += nx
    return h, (ancho_x - 1) * paso, (alto_y - 1) * paso


# ---------------------------------------------------------------------------
# 2. Dónde va la punta de la bola
# ---------------------------------------------------------------------------

def bola(radio: float, paso: float) -> np.ndarray:
    """Altura de la superficie de la bola respecto a su centro (-inf fuera)."""
    r = int(np.ceil(radio / paso))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1] * paso
    d2 = xx ** 2 + yy ** 2
    return np.where(d2 <= radio ** 2, np.sqrt(np.clip(radio ** 2 - d2, 0, None)), -np.inf)


def superficie_punta(h: np.ndarray, radio: float, paso: float, relleno: float) -> np.ndarray:
    """Altura mínima de la PUNTA de la bola en cada punto para no comerse el molde.

    Centro de la bola = max sobre el disco de (h(vecino) + sqrt(R² - d²)); punta = centro - R.
    Alrededor del bloque se supone la base (`relleno`), así la bola limpia también los bordes.
    """
    r = int(np.ceil(radio / paso))
    hp = np.pad(h, r, constant_values=relleno)
    b = bola(radio, paso)
    centro = ndimage.grey_dilation(hp, structure=np.where(np.isfinite(b), b, -1e6), mode="nearest")
    return (centro - radio)[r:-r, r:-r]


# ---------------------------------------------------------------------------
# 3. Trayectorias
# ---------------------------------------------------------------------------

def _simplificar(ys: np.ndarray, zs: np.ndarray, tol: float = 0.01) -> np.ndarray:
    """Índices de puntos a conservar en una línea (quita los que están alineados)."""
    if len(ys) <= 2:
        return np.arange(len(ys))
    keep = [0]
    ancla = 0
    for k in range(2, len(ys)):
        # ¿se puede ir en recta desde el ancla hasta k sin desviarse más de tol?
        t = (ys[ancla + 1:k] - ys[ancla]) / (ys[k] - ys[ancla])
        interp = zs[ancla] + t * (zs[k] - zs[ancla])
        if np.abs(interp - zs[ancla + 1:k]).max() > tol or ys[k] - ys[ancla] > 30:
            keep.append(k - 1)
            ancla = k - 1
    keep.append(len(ys) - 1)
    return np.array(keep)


class _Escritor:
    """Va escribiendo el G-code y sumando distancias para estimar el tiempo."""

    def __init__(self, cfg: dict, z_seguro: float):
        self.lineas: list[str] = []
        self.cfg = cfg
        self.z_seguro = z_seguro
        self.pos = np.array([0.0, 0.0, z_seguro])
        self.tiempo = 0.0  # minutos
        self.f_actual = None

    def _mover(self, destino, avance):
        d = float(np.linalg.norm(destino - self.pos))
        self.tiempo += d / avance
        self.pos = destino

    def rapido(self, x=None, y=None, z=None):
        d = self.pos.copy()
        if x is not None:
            d[0] = x
        if y is not None:
            d[1] = y
        if z is not None:
            d[2] = z
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

    def bajar_a(self, x, y, z, avance_corte):
        """Ir en rápido encima del punto y bajar despacio hasta z."""
        self.rapido(z=self.z_seguro)
        self.rapido(x=x, y=y)
        self.rapido(z=min(self.z_seguro, z + 2.0))
        self.corte(x, y, z, self.cfg["avance_bajada"])
        self.f_actual = None  # tras bajar, volver a poner el avance de corte


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


def generar(h: np.ndarray, paso: float, alto_bloque: float, fondo: float, radio: float, cfg: dict) -> TrabajoCNC:
    """Calcula desbaste + acabado y devuelve el G-code. `h` = molde colocado en el bloque."""
    ny, nx = h.shape
    H = alto_bloque
    punta = superficie_punta(h, radio, paso, fondo)
    xs = np.arange(nx) * paso
    ys = np.arange(ny) * paso
    zseg = cfg["altura_seguridad"]
    w = _Escritor(cfg, zseg)
    w.lineas += [
        f"; Rectificador de moldes Ortosend - molde de {cfg.get('material', '')}",
        f"; Bloque: {xs[-1]:.0f} x {ys[-1]:.0f} x {H:.0f} mm (ancho X x largo Y x alto Z)",
        "; ORIGEN: X0 Y0 = esquina DELANTERA IZQUIERDA del bloque; Z0 = cara de ARRIBA del bloque",
        f"; Fresa: punta de bola diametro {2 * radio:.0f} mm (Z = punta de la bola)",
        "G21 ; milimetros", "G90 ; coordenadas absolutas", "G94 ; avance en mm/min",
        f"M3 S{cfg['revoluciones']:.0f}", "G4 P3 ; esperar a que coja revoluciones",
        f"G0 Z{zseg:.3f}",
    ]

    # --- Desbaste por capas, pasadas a lo largo de Y (el pie), en zigzag ---
    sobrante = cfg["sobrante_desbaste"]
    objetivo_desb = punta + sobrante
    material = np.full(h.shape, H)  # altura del material que queda (aprox. por celdas)
    paso_lin = max(1, int(round(cfg["paso_desbaste"] / paso)))
    cols = list(range(0, nx, paso_lin))
    if cols[-1] != nx - 1:
        cols.append(nx - 1)
    niveles = []
    nivel = H - cfg["bajada_por_pasada"]
    while nivel > punta.min() + sobrante - 1e-6:
        niveles.append(nivel)
        nivel -= cfg["bajada_por_pasada"]
    niveles.append(max(punta.min() + sobrante, 0.0))
    n_capas = 0
    w.lineas.append("; ---- DESBASTE ----")
    for nivel in niveles:
        corte = np.maximum(nivel, objetivo_desb)
        hubo = False
        sentido = 1
        for i in cols:
            prof = corte[:, i]
            necesita = material[:, i] - prof > 0.05
            for a, b in _tramos(necesita, int(round(10 / paso)))[::sentido]:
                rango = np.arange(a, b + 1)[::sentido]
                y0 = ys[rango[0]]
                w.bajar_a(xs[i], y0, prof[rango[0]] - H, cfg["avance_desbaste"])
                sel = rango[_simplificar(ys[rango] * sentido, prof[rango])]
                for k in sel:
                    w.corte(xs[i], ys[k], prof[k] - H, cfg["avance_desbaste"])
                hubo = True
            sentido = -sentido
        if hubo:
            n_capas += 1
            # Lo que queda tras esta capa: las pasadas (separadas menos que el diámetro) barren todo.
            material = np.minimum(material, corte)
        w.rapido(z=zseg)

    # --- Acabado: pasadas a lo largo de Y separadas según la cresta permitida ---
    c = cfg["cresta_acabado"]
    s = 2 * np.sqrt(max(c * (2 * radio - c), 1e-9))
    paso_acab = max(1, int(np.floor(s / paso)))
    cols = list(range(0, nx, paso_acab))
    if cols[-1] != nx - 1:
        cols.append(nx - 1)
    w.lineas.append(f"; ---- ACABADO (separacion {paso_acab * paso:.2f} mm, cresta <= {c} mm) ----")
    sentido = 1
    primero = True
    for i in cols:
        rango = np.arange(ny)[::sentido]
        prof = punta[rango, i]
        sel = rango[_simplificar(ys[rango] * sentido, prof)]
        if primero:
            w.bajar_a(xs[i], ys[sel[0]], punta[sel[0], i] - H, cfg["avance_acabado"])
            primero = False
        else:
            # Pasar a la siguiente línea por el extremo, sin levantar (zigzag): a la altura que
            # haga falta para no tocar nada entre las dos líneas.
            j = sel[0]
            i_prev = int(round(w.pos[0] / paso))
            zt = float(max(punta[j, min(i_prev, i):max(i_prev, i) + 1].max(), w.pos[2] + H))
            w.corte(w.pos[0], ys[j], zt - H, cfg["avance_acabado"])
            w.corte(xs[i], ys[j], zt - H, cfg["avance_acabado"])
            w.corte(xs[i], ys[j], punta[j, i] - H, cfg["avance_acabado"])
        for k in sel:
            w.corte(xs[i], ys[k], punta[k, i] - H, cfg["avance_acabado"])
        sentido = -sentido
    w.rapido(z=zseg)
    w.rapido(x=0.0, y=0.0)
    w.lineas += ["M5", "M30"]
    tiempo = w.tiempo
    w.lineas.insert(5, f"; Tiempo estimado: {tiempo:.0f} min")
    return TrabajoCNC(
        gcode="\n".join(w.lineas) + "\n",
        bloque=(float(xs[-1]), float(ys[-1]), float(H)),
        tiempo_min=float(tiempo),
        altura=h, punta=punta, paso=paso,
        pasadas={"capas_desbaste": n_capas, "lineas_acabado": len(cols),
                 "separacion_acabado_mm": round(paso_acab * paso, 2)},
    )


def preparar(z: np.ndarray, fondo: float, mascaras: list[np.ndarray], paso: float, taller: dict) -> TrabajoCNC:
    """Molde terminado (campo del recuadro) -> trabajo de CNC completo."""
    cfg = taller["cnc"]
    radio = taller["fresa"]["diametro"] / 2
    h, ancho, largo = disponer(z, fondo, mascaras, paso, cfg)
    alto = float(np.ceil(h.max() + 0.5))  # el bloque debe sobresalir al menos 0,5 mm del punto más alto
    trabajo = generar(h, paso, alto, fondo, radio, cfg)
    trabajo.avisos.append(
        f"Prepara un bloque de {cfg.get('material', 'material')} de al menos "
        f"{np.ceil(ancho):.0f} × {np.ceil(largo):.0f} × {alto:.0f} mm "
        f"(ancho × largo × alto). Pon el origen en la esquina delantera izquierda, arriba."
    )
    return trabajo
