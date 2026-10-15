"""Limpieza del escaneo en bruto del Revopoint.

Entrada: STL tal cual sale del escáner, con los dos bloques de espuma lado a lado y la
huella de cada pie HUNDIDA en la cara superior. Puede estar inclinado, girado, con ruido,
agujeros, trozos de mesa o restos sueltos.

Salida: campo de alturas del recuadro (ancho × largo del taller) con los dos pies EN BULTO,
dedos hacia +Y, cada pie centrado en su mitad, sobre una base plana.

Pasos:
 1. Buscar la cara superior plana de los bloques (el plano grande que no tiene casi nada
    por encima; la mesa se descarta porque los bloques quedan por encima de ella).
 2. Ajustar el rectángulo de los bloques sobre ese plano y llevarlo a ejes X, Y.
 3. Mapa de profundidad de la huella visto desde arriba; quitar picos, rellenar agujeros.
 4. Separar las dos huellas y borrar todo lo que no es pie.
 5. Volcar el molde como se vuelca un bloque (giro de 180° alrededor del eje largo,
    NUNCA un espejo: el pie izquierdo sigue siendo izquierdo).
 6. Dedos hacia +Y, identificar izquierdo/derecho, compactar en el recuadro.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import trimesh
from scipy import ndimage, sparse
from scipy.sparse.linalg import spsolve

from .campo import Campo, Rejilla, rasterizar


@dataclass
class InformeLimpieza:
    avisos: list[str] = field(default_factory=list)
    tam_bloques: tuple[float, float] = (0.0, 0.0)
    matriz: list[list[float]] | None = None  # escaneo -> sistema de los bloques (antes de volcar)
    giro_180: bool = False  # se giró para dejar los dedos hacia +Y
    pies: list[dict] = field(default_factory=list)  # lado, mitad, profundidad máx...

    def a_dict(self) -> dict:
        return {
            "avisos": self.avisos,
            "tam_bloques_mm": list(self.tam_bloques),
            "matriz_escaneo_a_bloques": self.matriz,
            "giro_180_dedos": self.giro_180,
            "pies": self.pies,
        }


# ---------------------------------------------------------------------------
# 1. Plano superior de los bloques
# ---------------------------------------------------------------------------

def _ajustar_plano(puntos, pesos):
    c = np.average(puntos, axis=0, weights=pesos)
    _, _, vt = np.linalg.svd((puntos - c) * np.sqrt(pesos)[:, None], full_matrices=False)
    return c, vt[2]


def buscar_plano_superior(malla: trimesh.Trimesh, tolerancia: float, semilla: int = 0):
    """Devuelve (punto, normal hacia arriba, máscara de caras del plano)."""
    rng = np.random.default_rng(semilla)
    C = malla.triangles_center
    A = malla.area_faces
    N = malla.face_normals
    prob = A / A.sum()
    muestra = rng.choice(len(C), size=min(60_000, len(C)), replace=False, p=prob)
    # La muestra se elige proporcional al área: cada cara elegida representa la misma
    # superficie, así que dentro de la muestra se cuenta por número de caras.
    Cm, Nm = C[muestra], N[muestra]
    Am = np.ones(len(Cm))
    total = Am.sum()

    candidatos = []
    for _ in range(500):
        p = Cm[rng.choice(len(Cm), 3, replace=False)]  # la muestra ya está pesada por área
        n = np.cross(p[1] - p[0], p[2] - p[0])
        if np.linalg.norm(n) < 1e-6:
            continue
        n /= np.linalg.norm(n)
        d = (Cm - p[0]) @ n
        dentro = np.abs(d) < tolerancia
        area = Am[dentro].sum()
        if area < 0.05 * total:
            continue
        c, n = _ajustar_plano(Cm[dentro], Am[dentro])
        d = (Cm - c) @ n
        dentro = np.abs(d) < tolerancia
        area = Am[dentro].sum()
        # Hacia dónde mira la superficie: el escáner ve las caras desde fuera, así que
        # las normales del plano apuntan hacia arriba. Si no son fiables (malla mal
        # orientada), se toma el lado que deja menos material por encima.
        media = (Nm[dentro] * Am[dentro, None]).sum(0) / area
        if abs(media @ n) > 0.5:
            if media @ n < 0:
                n, d = -n, -d
        elif Am[d > 3 * tolerancia + 1].sum() > Am[d < -3 * tolerancia - 1].sum():
            n, d = -n, -d
        arriba = Am[d > 3 * tolerancia + 1].sum()
        candidatos.append((area, arriba / total, c, n))

    # La cara superior: casi nada por encima. De esos, el de más área.
    validos = [k for k in candidatos if k[1] < 0.05]
    if not validos:
        raise ValueError("No encuentro la cara superior plana de los bloques en el escaneo.")
    _, _, c, n = max(validos, key=lambda k: k[0])
    mascara = np.abs((C - c) @ n) < tolerancia
    c, n2 = _ajustar_plano(C[mascara], A[mascara])
    if n2 @ n < 0:
        n2 = -n2
    return c, n2, mascara


# ---------------------------------------------------------------------------
# 2. Rectángulo de los bloques
# ---------------------------------------------------------------------------

def rectangulo_minimo(p2: np.ndarray):
    """Rectángulo de área mínima que contiene los puntos 2D. Devuelve (origen, eje_u, eje_v, ancho, largo)."""
    from scipy.spatial import ConvexHull

    h = p2[ConvexHull(p2).vertices]
    mejor = None
    for k in range(len(h)):
        e = h[(k + 1) % len(h)] - h[k]
        if np.linalg.norm(e) < 1e-9:
            continue
        u = e / np.linalg.norm(e)
        v = np.array([-u[1], u[0]])
        a, b = h @ u, h @ v
        area = (a.max() - a.min()) * (b.max() - b.min())
        if mejor is None or area < mejor[0]:
            mejor = (area, u, v, a.min(), a.max(), b.min(), b.max())
    _, u, v, a0, a1, b0, b1 = mejor
    if a1 - a0 > b1 - b0:  # el lado largo va en Y
        u, v, a0, a1, b0, b1 = v, -u, b0, b1, -a1, -a0
    origen = a0 * u + b0 * v
    return origen, u, v, a1 - a0, b1 - b0


# ---------------------------------------------------------------------------
# 3. Huecos
# ---------------------------------------------------------------------------

def rellenar_agujeros(z: np.ndarray, agujero: np.ndarray) -> np.ndarray:
    """Rellena los nodos marcados con una superficie suave (ecuación de Laplace)."""
    if not agujero.any():
        return z
    z = z.copy()
    ny, nx = z.shape
    idx = -np.ones(z.shape, np.int64)
    jj, ii = np.nonzero(agujero)
    n = len(jj)
    idx[jj, ii] = np.arange(n)
    filas, cols, vals = [], [], []
    b = np.zeros(n)
    diag = np.zeros(n)
    for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        j2, i2 = jj + dj, ii + di
        ok = (j2 >= 0) & (j2 < ny) & (i2 >= 0) & (i2 < nx)
        diag[ok] += 1
        k = np.nonzero(ok)[0]
        vecino = idx[j2[k], i2[k]]
        desconocido = vecino >= 0
        filas.append(k[desconocido]); cols.append(vecino[desconocido]); vals.append(-np.ones(desconocido.sum()))
        conocido = ~desconocido
        np.add.at(b, k[conocido], z[j2[k[conocido]], i2[k[conocido]]])
    filas.append(np.arange(n)); cols.append(np.arange(n)); vals.append(diag)
    M = sparse.csr_matrix((np.concatenate(vals), (np.concatenate(filas), np.concatenate(cols))), shape=(n, n))
    z[jj, ii] = spsolve(M, b)
    return z


# ---------------------------------------------------------------------------
# Pasos 4-6
# ---------------------------------------------------------------------------

def separar_huellas(prof: np.ndarray, paso: float, cfg: dict):
    """Etiquetas 1..k de las huellas (de mayor a menor área), ya ampliadas con el margen."""
    marca = prof > cfg["umbral_huella"]
    etiquetas, n = ndimage.label(marca)
    if n == 0:
        return np.zeros_like(etiquetas), []
    areas = ndimage.sum(np.ones_like(prof), etiquetas, index=np.arange(1, n + 1)) * paso * paso
    orden = [k + 1 for k in np.argsort(-areas) if areas[k] >= cfg["area_minima_pie"]]
    salida = np.zeros_like(etiquetas)
    radio = max(1, int(round(cfg["margen_huella"] / paso)))
    estructura = ndimage.generate_binary_structure(2, 1)
    for nuevo, viejo in enumerate(orden[:2], start=1):
        zona = ndimage.binary_dilation(etiquetas == viejo, estructura, iterations=radio)
        salida[zona & (salida == 0)] = nuevo
    return salida, list(range(1, min(len(orden), 2) + 1))


def dedos_hacia_mas_y(etiquetas: np.ndarray, pies: list[int]) -> bool:
    """True si los dedos ya apuntan a +Y (el antepié es más ancho que el talón)."""
    voto = 0.0
    for k in pies:
        ancho = (etiquetas == k).sum(axis=1)
        filas = np.nonzero(ancho)[0]
        tercio = max(1, (filas[-1] - filas[0]) // 3)
        voto += ancho[filas[-1] - tercio:filas[-1] + 1].mean() - ancho[filas[0]:filas[0] + tercio + 1].mean()
    return voto >= 0


def lado_del_pie(alt: np.ndarray, zona: np.ndarray) -> str:
    """Izquierdo/derecho mirando el mediopié del molde (planta hacia arriba, dedos a +Y).

    El arco interno apenas se marca en la espuma, así que en el molde es la parte más baja
    del mediopié. En un pie izquierdo visto así, el lado interno queda hacia -X.
    """
    filas = np.nonzero(zona.any(axis=1))[0]
    a, b = filas[0], filas[-1]
    medio = slice(a + int(0.35 * (b - a)), a + int(0.6 * (b - a)) + 1)
    sub, msk = alt[medio], zona[medio]
    ii = np.broadcast_to(np.arange(sub.shape[1]), sub.shape)
    x_geo = ii[msk].mean()
    x_peso = np.average(ii[msk], weights=np.maximum(sub[msk], 1e-6))
    # El peso se va hacia el lado externo (más alto); el interno es el contrario.
    return "izquierdo" if x_peso > x_geo else "derecho"


def compactar(alt: np.ndarray, etiquetas: np.ndarray, pies: dict[int, str], destino: Rejilla, izq_en: str):
    """Coloca cada pie centrado en su mitad del recuadro. Devuelve (altura, info por pie)."""
    sal = np.zeros((destino.ny, destino.nx))
    info = []
    mitad = destino.nx // 2
    for k, lado in pies.items():
        zona = etiquetas == k
        jj, ii = np.nonzero(zona)
        j0, j1, i0, i1 = jj.min(), jj.max() + 1, ii.min(), ii.max() + 1
        recorte = np.where(zona[j0:j1, i0:i1], alt[j0:j1, i0:i1], 0.0)
        a_la_izquierda = (lado == "izquierdo") == (izq_en == "izquierda")
        if len(pies) == 1:
            x_ini, x_fin = 0, destino.nx
        else:
            x_ini, x_fin = (0, mitad) if a_la_izquierda else (mitad, destino.nx)
        h, w = recorte.shape
        if w > x_fin - x_ini or h > destino.ny:
            raise ValueError(
                f"El pie {lado} ({w * destino.dx:.0f} × {h * destino.dy:.0f} mm) no cabe en su sitio del recuadro."
            )
        oi = x_ini + (x_fin - x_ini - w) // 2
        oj = (destino.ny - h) // 2
        sal[oj:oj + h, oi:oi + w] = np.maximum(sal[oj:oj + h, oi:oi + w], recorte)
        info.append({
            "lado": lado,
            "mitad": "izquierda" if oi < mitad else "derecha",
            "largo_mm": round(h * destino.dy, 1),
            "ancho_mm": round(w * destino.dx, 1),
            "profundidad_max_mm": round(float(recorte.max()), 2),
        })
    return sal, info


def limpiar(malla: trimesh.Trimesh, taller: dict, lados: dict[int, str] | None = None) -> tuple[Campo, InformeLimpieza]:
    """Escaneo en bruto -> campo del recuadro con los pies en bulto.

    `lados` permite forzar izquierdo/derecho ({1: "izquierdo", 2: "derecho"}, por orden de tamaño
    de huella) si el usuario corrige la propuesta automática.
    """
    cfg = taller["limpieza"]
    rec = taller["recuadro"]
    paso = taller["calculo"]["rejilla"]
    inf = InformeLimpieza()

    # Restos sueltos pequeños fuera.
    malla = trimesh.Trimesh(malla.vertices, malla.faces, process=True)
    grupo = trimesh.graph.connected_component_labels(malla.face_adjacency, node_count=len(malla.faces))
    areas = np.bincount(grupo, weights=malla.area_faces)
    if len(areas) > 1:
        malla = malla.submesh([np.nonzero(areas[grupo] >= 0.01 * areas.max())[0]], append=True, repair=False)

    # 1-2. Plano y rectángulo -> sistema de los bloques (X ancho, Y largo, Z normal al plano, 0 en la cara).
    c, n, en_plano = buscar_plano_superior(malla, cfg["tolerancia_plano"])
    u0 = np.cross(n, [1.0, 0, 0] if abs(n[0]) < 0.9 else [0, 1.0, 0])
    u0 /= np.linalg.norm(u0)
    v0 = np.cross(n, u0)
    P = malla.triangles_center[en_plano] - c
    origen2, u2, v2, ancho, largo = rectangulo_minimo(np.column_stack([P @ u0, P @ v0]))
    ex = u2[0] * u0 + u2[1] * v0
    ey = v2[0] * u0 + v2[1] * v0
    ez = np.cross(ex, ey)  # sistema directo (sin espejo)
    if ez @ n < 0:
        ex = -ex
        origen2 = origen2 + ancho * u2
    o = c + origen2[0] * u0 + origen2[1] * v0
    R = np.vstack([ex, ey, ez])
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = -R @ o
    inf.matriz = M.round(6).tolist()
    inf.tam_bloques = (round(float(ancho), 1), round(float(largo), 1))
    if abs(ancho - rec["ancho_x"]) > 15 or abs(largo - rec["largo_y"]) > 15:
        inf.avisos.append(
            f"Los bloques miden {ancho:.0f} × {largo:.0f} mm; se esperaba {rec['ancho_x']:.0f} × "
            f"{rec['largo_y']:.0f}. Revisa que el escaneo incluya los dos bloques enteros."
        )

    # 3. Mapa de profundidad visto desde arriba (solo dentro de los bloques).
    V = (np.asarray(malla.vertices) - o) @ R.T
    F = np.asarray(malla.faces)
    tri = V[F]
    dentro = (
        (tri[:, :, 0].min(1) > 0.3) & (tri[:, :, 0].max(1) < ancho - 0.3)
        & (tri[:, :, 1].min(1) > 0.3) & (tri[:, :, 1].max(1) < largo - 0.3)
        & (tri[:, :, 2].max(1) < 3.0) & (tri[:, :, 2].min(1) > -rec["alto_z"] - 10)
    )
    rej = Rejilla.con_paso(ancho, largo, paso)
    z = rasterizar(V, F[dentro], rej, rellenar=False)
    agujero = np.isnan(z)
    prof = np.where(agujero, 0.0, np.maximum(-z, 0.0))
    prof = np.where(agujero, prof, ndimage.median_filter(prof, size=3))

    # 4. Huellas.
    etiquetas, pies = separar_huellas(prof, paso, cfg)
    if not pies:
        raise ValueError("No encuentro ninguna huella de pie en el escaneo.")
    if len(pies) == 1:
        inf.avisos.append("Solo se ha encontrado una huella de pie.")
    zona_pies = etiquetas > 0
    prof = rellenar_agujeros(prof, agujero & zona_pies)
    if cfg["suavizado"] > 0:
        suave = ndimage.gaussian_filter(prof, cfg["suavizado"] / paso)
        prof = np.where(zona_pies, suave, prof)
    prof = np.where(zona_pies, np.maximum(prof, 0.0), 0.0)

    # 5. Volcar el bloque: giro de 180° alrededor del eje Y -> x pasa a (ancho - x).
    prof, etiquetas = prof[:, ::-1], etiquetas[:, ::-1]

    # 6. Dedos hacia +Y (giro de 180° alrededor de Z si hace falta).
    if not dedos_hacia_mas_y(etiquetas, pies):
        prof, etiquetas = prof[::-1, ::-1], etiquetas[::-1, ::-1]
        inf.giro_180 = True

    if lados is None:
        lados = {k: lado_del_pie(prof, etiquetas == k) for k in pies}
        if len(pies) == 2 and lados[1] == lados[2]:
            # Contradicción: se decide por posición (el de -X es el izquierdo).
            x = {k: np.nonzero(etiquetas == k)[1].mean() for k in pies}
            izq = min(x, key=x.get)
            lados = {k: ("izquierdo" if k == izq else "derecho") for k in pies}
            inf.avisos.append("No está claro qué pie es cada uno: confírmalo.")

    destino = Rejilla.para_recuadro(rec["ancho_x"], rec["largo_y"], paso)
    alt, inf.pies = compactar(prof, etiquetas, lados, destino, cfg["pie_izquierdo_en"])
    alt = cfg["base"] + alt
    if alt.max() > rec["alto_z"]:
        inf.avisos.append(
            f"La huella más profunda ({alt.max() - cfg['base']:.1f} mm) más la base "
            f"({cfg['base']:.1f} mm) supera la altura del bloque ({rec['alto_z']:.0f} mm)."
        )
    return Campo(destino, alt, np.zeros(3)), inf
