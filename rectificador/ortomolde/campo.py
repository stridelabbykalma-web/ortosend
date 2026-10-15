"""Campo de alturas Z(x, y): paso de malla a rejilla y de rejilla a malla estanca.

Coordenadas internas (mm):
  - origen en la esquina delantera-izquierda del recuadro, en el fondo (Z = 0 abajo);
  - X a lo ancho, Y a lo largo, Z hacia arriba.
`desplazamiento` guarda dónde estaba esa esquina en el STL de entrada, para devolver
el resultado exactamente en el mismo sistema de coordenadas que se recibió.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import trimesh
from scipy import ndimage


@dataclass(frozen=True)
class Rejilla:
    """Rejilla regular de nodos: x = i*dx (i = 0..nx-1), y = j*dy (j = 0..ny-1)."""

    nx: int
    ny: int
    dx: float
    dy: float

    @classmethod
    def para_recuadro(cls, ancho: float, largo: float, paso: float) -> "Rejilla":
        nx = int(round(ancho / paso)) + 1
        ny = int(round(largo / paso)) + 1
        return cls(nx, ny, ancho / (nx - 1), largo / (ny - 1))

    @property
    def ancho(self) -> float:
        return self.dx * (self.nx - 1)

    @property
    def largo(self) -> float:
        return self.dy * (self.ny - 1)

    @property
    def xs(self) -> np.ndarray:
        return np.arange(self.nx) * self.dx

    @property
    def ys(self) -> np.ndarray:
        return np.arange(self.ny) * self.dy

    def malla(self) -> tuple[np.ndarray, np.ndarray]:
        """Matrices X, Y de forma (ny, nx)."""
        return np.meshgrid(self.xs, self.ys)

    def a_dict(self) -> dict:
        return {"nx": self.nx, "ny": self.ny, "dx": self.dx, "dy": self.dy}


@dataclass
class Campo:
    rejilla: Rejilla
    z: np.ndarray  # (ny, nx), mm sobre el fondo del bloque
    desplazamiento: np.ndarray  # (3,) esquina del recuadro en el STL original

    def copia(self, z: np.ndarray | None = None) -> "Campo":
        return Campo(self.rejilla, (self.z if z is None else z).copy(), self.desplazamiento.copy())


# ---------------------------------------------------------------------------
# Malla -> campo de alturas
# ---------------------------------------------------------------------------

def rasterizar(vertices: np.ndarray, caras: np.ndarray, rejilla: Rejilla) -> np.ndarray:
    """Altura máxima de la malla en cada nodo de la rejilla (z-buffer visto desde arriba).

    Los nodos que no caen bajo ningún triángulo toman la altura del nodo más cercano
    que sí cae (pasa solo en los bordes por redondeo).
    """
    tri = vertices[caras].astype(np.float64)  # (m, 3, 3)
    # Pasar x, y a unidades de rejilla.
    tri[:, :, 0] /= rejilla.dx
    tri[:, :, 1] /= rejilla.dy
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    area2 = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    utiles = np.abs(area2) > 1e-12  # se descartan paredes verticales
    tri, area2 = tri[utiles], area2[utiles]

    zbuf = np.full(rejilla.ny * rejilla.nx, -np.inf)
    eps = 1e-6
    i0 = np.clip(np.ceil(tri[:, :, 0].min(1) - eps), 0, rejilla.nx - 1).astype(np.int64)
    i1 = np.clip(np.floor(tri[:, :, 0].max(1) + eps), 0, rejilla.nx - 1).astype(np.int64)
    j0 = np.clip(np.ceil(tri[:, :, 1].min(1) - eps), 0, rejilla.ny - 1).astype(np.int64)
    j1 = np.clip(np.floor(tri[:, :, 1].max(1) + eps), 0, rejilla.ny - 1).astype(np.int64)
    tam = np.maximum(i1 - i0, j1 - j0) + 1
    tam[(i1 < i0) | (j1 < j0)] = 0

    # Agrupar triángulos por tamaño (en nodos) para vectorizar.
    limites = [1, 2, 4, 8, 16, 32, 64]
    pendientes = tam > 0
    for s in limites:
        sel = np.nonzero(pendientes & (tam <= s))[0]
        pendientes[sel] = False
        if sel.size:
            _rasterizar_grupo(tri, area2, i0, j0, sel, s, rejilla, zbuf, eps)
    for k in np.nonzero(pendientes)[0]:  # triángulos grandes, uno a uno
        s_i = i1[k] - i0[k] + 1
        s_j = j1[k] - j0[k] + 1
        ii, jj = np.meshgrid(np.arange(s_i) + i0[k], np.arange(s_j) + j0[k])
        _escribir(tri[k:k + 1], area2[k:k + 1], np.zeros(ii.size, np.int64),
                  ii.ravel(), jj.ravel(), rejilla, zbuf, eps)

    z = zbuf.reshape(rejilla.ny, rejilla.nx)
    vacio = ~np.isfinite(z)
    if vacio.all():
        raise ValueError("La malla no cubre el recuadro: no se ha podido calcular ninguna altura.")
    if vacio.any():
        _, (jj, ii) = ndimage.distance_transform_edt(vacio, return_indices=True)
        z = z[jj, ii]
    return z


def _rasterizar_grupo(tri, area2, i0, j0, sel, s, rejilla, zbuf, eps):
    off_i, off_j = np.meshgrid(np.arange(s), np.arange(s))
    off_i, off_j = off_i.ravel(), off_j.ravel()
    lote = max(1, 4_000_000 // (s * s))
    for inicio in range(0, sel.size, lote):
        idx = sel[inicio:inicio + lote]
        k = np.repeat(np.arange(idx.size), s * s)
        ii = (i0[idx][:, None] + off_i[None, :]).ravel()
        jj = (j0[idx][:, None] + off_j[None, :]).ravel()
        _escribir(tri[idx], area2[idx], k, ii, jj, rejilla, zbuf, eps)


def _escribir(tri, area2, k, ii, jj, rejilla, zbuf, eps):
    dentro_rejilla = (ii < rejilla.nx) & (jj < rejilla.ny)
    k, ii, jj = k[dentro_rejilla], ii[dentro_rejilla], jj[dentro_rejilla]
    a, b, c = tri[k, 0], tri[k, 1], tri[k, 2]
    px, py = ii.astype(np.float64), jj.astype(np.float64)
    A = area2[k]
    w0 = ((b[:, 0] - px) * (c[:, 1] - py) - (b[:, 1] - py) * (c[:, 0] - px)) / A
    w1 = ((c[:, 0] - px) * (a[:, 1] - py) - (c[:, 1] - py) * (a[:, 0] - px)) / A
    w2 = 1.0 - w0 - w1
    dentro = (w0 >= -eps) & (w1 >= -eps) & (w2 >= -eps)
    zz = w0 * a[:, 2] + w1 * b[:, 2] + w2 * c[:, 2]
    np.maximum.at(zbuf, jj[dentro] * rejilla.nx + ii[dentro], zz[dentro])


def malla_a_campo(malla: trimesh.Trimesh, paso: float, recuadro: tuple[float, float] | None = None) -> Campo:
    """Convierte la malla limpia del escaneo en campo de alturas.

    `recuadro` = (ancho_x, largo_y) esperado; si se da, se avisa si la malla no encaja.
    """
    lo, hi = malla.bounds
    tam = hi - lo
    if recuadro is not None:
        esperado = np.array(recuadro)
        if np.any(np.abs(tam[:2] - esperado) > 2.0):
            raise ValueError(
                f"El STL mide {tam[0]:.1f} × {tam[1]:.1f} mm y se esperaba "
                f"{esperado[0]:.0f} × {esperado[1]:.0f} mm. Revisa el archivo o config/taller.toml."
            )
    rejilla = Rejilla.para_recuadro(tam[0], tam[1], paso)
    v = np.asarray(malla.vertices) - lo
    caras = np.asarray(malla.faces)
    if malla.is_winding_consistent and malla.volume > 0:
        # Las caras que miran hacia abajo (la base) no aportan nada y son grandes: se omiten.
        caras = caras[malla.face_normals[:, 2] > 0]
    z = rasterizar(v, caras, rejilla)
    return Campo(rejilla, z, lo.copy())


def detectar_fondo(z: np.ndarray, paso: float = 0.1) -> float:
    """Altura de la base plana alrededor de los pies (la altura más frecuente)."""
    bins = np.arange(z.min(), z.max() + 2 * paso, paso)
    hist, bordes = np.histogram(z, bins=bins)
    k = int(np.argmax(hist))
    sel = (z >= bordes[k]) & (z < bordes[k + 1])
    return float(np.median(z[sel]))


# ---------------------------------------------------------------------------
# Campo de alturas -> malla estanca
# ---------------------------------------------------------------------------

def campo_a_malla(campo: Campo, en_coordenadas_originales: bool = True) -> trimesh.Trimesh:
    """Sólido estanco: superficie superior = campo, paredes verticales y fondo plano (Z = 0).

    Por construcción no hay autointersecciones (cada punto (x, y) tiene una sola altura).
    """
    r = campo.rejilla
    ny, nx = r.ny, r.nx
    X, Y = r.malla()
    z = np.maximum(campo.z, 0.0)
    sup = np.column_stack([X.ravel(), Y.ravel(), z.ravel()])

    idx = np.arange(ny * nx).reshape(ny, nx)
    v00 = idx[:-1, :-1].ravel()
    v10 = idx[:-1, 1:].ravel()
    v11 = idx[1:, 1:].ravel()
    v01 = idx[1:, :-1].ravel()
    caras_sup = np.concatenate([np.column_stack([v00, v10, v11]), np.column_stack([v00, v11, v01])])

    # Contorno en sentido antihorario visto desde arriba.
    borde = np.concatenate([
        idx[0, :],            # delantero, izquierda -> derecha
        idx[1:, -1],          # derecho, hacia atrás
        idx[-1, -2::-1],      # trasero, derecha -> izquierda
        idx[-2:0:-1, 0],      # izquierdo, hacia delante
    ])
    n_sup = sup.shape[0]
    # Vértice inferior de cada punto del contorno (si la altura es 0 se reutiliza el superior).
    z_borde = sup[borde, 2]
    abajo = np.where(z_borde > 1e-9, n_sup + np.arange(borde.size), borde)
    v_inf = sup[borde].copy()
    v_inf[:, 2] = 0.0
    centro = np.array([[r.ancho / 2, r.largo / 2, 0.0]])
    i_centro = n_sup + borde.size

    ta, tb = borde, np.roll(borde, -1)
    ba, bb = abajo, np.roll(abajo, -1)
    paredes = np.concatenate([np.column_stack([ta, ba, bb]), np.column_stack([ta, bb, tb])])
    fondo = np.column_stack([np.full(borde.size, i_centro), bb, ba])

    vertices = np.concatenate([sup, v_inf, centro])
    caras = np.concatenate([caras_sup, paredes, fondo])
    degeneradas = (caras[:, 0] == caras[:, 1]) | (caras[:, 1] == caras[:, 2]) | (caras[:, 0] == caras[:, 2])
    caras = caras[~degeneradas]
    if en_coordenadas_originales:
        vertices = vertices + campo.desplazamiento
    malla = trimesh.Trimesh(vertices, caras, process=False)
    malla.remove_unreferenced_vertices()
    return malla
