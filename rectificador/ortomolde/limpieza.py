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
class Bloque:
    """Un bloque de espuma ya procesado (huella en bulto, dedos hacia +Y)."""

    matriz: np.ndarray  # 4×4: coordenadas del escaneo -> sistema del bloque (antes de volcar)
    ancho: float
    largo: float
    prof: np.ndarray  # altura del pie en bulto sobre la cara del bloque (0 fuera del pie)
    zona: np.ndarray  # máscara del pie
    giro_180: bool = False
    lado: str = ""
    confianza_lado: float = 0.0  # >0 parece izquierdo, <0 parece derecho

    def a_dict(self) -> dict:
        return {
            "matriz_escaneo_a_bloque": self.matriz.round(6).tolist(),
            "tam_mm": [round(float(self.ancho), 1), round(float(self.largo), 1)],
            "giro_180_dedos": self.giro_180,
            "lado": self.lado,
        }


@dataclass
class InformeLimpieza:
    avisos: list[str] = field(default_factory=list)
    bloques: list[Bloque] = field(default_factory=list)
    pies: list[dict] = field(default_factory=list)  # lado, mitad, profundidad máx...
    # Mapas intermedios para revisar la limpieza (no se guardan en la receta).
    mapas: dict = field(default_factory=dict, repr=False)

    @property
    def n_bloques(self) -> int:
        return len(self.bloques)

    def a_dict(self) -> dict:
        return {
            "avisos": self.avisos,
            "bloques": [b.a_dict() for b in self.bloques],
            "pies": self.pies,
        }


# ---------------------------------------------------------------------------
# 1. Plano superior de los bloques
# ---------------------------------------------------------------------------

def _ajustar_plano(puntos, pesos):
    c = np.average(puntos, axis=0, weights=pesos)
    _, _, vt = np.linalg.svd((puntos - c) * np.sqrt(pesos)[:, None], full_matrices=False)
    return c, vt[2]


def buscar_plano_superior(malla: trimesh.Trimesh, tolerancia: float, semilla: int = 0,
                          validas: np.ndarray | None = None):
    """Devuelve (punto, normal hacia arriba, máscara de caras del plano).

    `validas` limita la búsqueda a esas caras (para buscar el segundo bloque).
    """
    rng = np.random.default_rng(semilla)
    C = malla.triangles_center
    A = malla.area_faces
    N = malla.face_normals
    prob = A * (validas if validas is not None else 1.0)
    prob = prob / prob.sum()
    muestra = rng.choice(len(C), size=min(60_000, int((prob > 0).sum())), replace=False, p=prob)
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
        # Se puntúa el plano tal cual (sin reajustar): si hay dos bloques con distinta
        # inclinación, reajustar aquí mezclaría los dos.
        c = p[0]
        # Hacia dónde mira la superficie: el escáner ve las caras desde fuera, así que
        # las normales del plano apuntan hacia arriba. Si no son fiables (malla mal
        # orientada), se toma el lado que deja menos material por encima.
        media = (Nm[dentro] * Am[dentro, None]).sum(0) / area
        if abs(media @ n) > 0.5:
            if media @ n < 0:
                n, d = -n, -d
        elif Am[d > 3 * tolerancia + 1].sum() > Am[d < -3 * tolerancia - 1].sum():
            n, d = -n, -d
        # "Encima" = más de 20 mm por encima: así la mesa (con los bloques 38 mm por encima)
        # queda descartada, pero no la cara de un bloque por estar el otro algo inclinado.
        arriba = Am[d > 20.0].sum()
        candidatos.append((area, arriba / total, c, n))

    # La cara superior: casi nada por encima. De esos, el de más área.
    validos = [k for k in candidatos if k[1] < 0.05]
    if not validos:
        raise ValueError("No encuentro la cara superior plana de los bloques en el escaneo.")
    _, _, c, n = max(validos, key=lambda k: k[0])
    # Afinar el plano ganador con sus propias caras, cada vez más estricto.
    for tol in (tolerancia, 0.6 * tolerancia, 0.6 * tolerancia):
        mascara = np.abs((C - c) @ n) < tol
        if validas is not None:
            mascara &= validas
        c, n2 = _ajustar_plano(C[mascara], A[mascara])
        n = n2 if n2 @ n > 0 else -n2
    mascara = np.abs((C - c) @ n) < tolerancia
    if validas is not None:
        mascara &= validas
    return c, n, mascara


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


def zona_principal_del_plano(p2: np.ndarray, celda: float = 1.0) -> np.ndarray:
    """Se queda con los puntos del plano que forman la superficie continua más grande.

    Se rellena el hueco de la huella para que el borde fino que la rodea no se pierda,
    y se cortan puentes finos (paredes, restos, otros objetos que cruzan el plano).
    Devuelve una máscara sobre p2.
    """
    lo = p2.min(axis=0)
    ij = np.floor((p2 - lo) / celda).astype(int)
    ocup = np.zeros(ij.max(axis=0) + 1, bool)
    ocup[ij[:, 0], ij[:, 1]] = True
    # Cerrar solo huecos de 1-2 mm (ruido): la ranura entre bloques (3 mm o más) se respeta.
    ocup = ndimage.binary_closing(ocup, iterations=1)
    ocup = ndimage.binary_fill_holes(ocup)
    ocup = ndimage.binary_opening(ocup, iterations=4)
    etiquetas, n = ndimage.label(ocup)
    if n == 0:
        return np.ones(len(p2), bool)
    mayor = 1 + int(np.argmax(ndimage.sum(ocup, etiquetas, index=np.arange(1, n + 1))))
    return etiquetas[ij[:, 0], ij[:, 1]] == mayor


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


def dedos_hacia_mas_y(zona: np.ndarray, paso: float) -> bool:
    """True si los dedos ya apuntan a +Y.

    La parte más ancha del pie (cabezas metatarsales) está siempre más cerca de los dedos
    que del talón. La profundidad no sirve: unas veces se hunde más el talón y otras el antepié.
    """
    ancho = ndimage.gaussian_filter1d(zona.sum(axis=1).astype(float), 10.0 / paso)
    filas = np.nonzero(zona.any(axis=1))[0]
    a, b = filas[0], filas[-1]
    anchas = np.nonzero(ancho >= 0.95 * ancho.max())[0]
    return (anchas.mean() - a) / max(b - a, 1) > 0.5


def confianza_izquierdo(alt: np.ndarray, zona: np.ndarray) -> float:
    """>0 si parece pie izquierdo, <0 si parece derecho (molde en bulto, dedos a +Y).

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
    return float(x_peso - x_geo) / max(1.0, float(msk.any(axis=0).sum()))


def recortar_pie(alt: np.ndarray, zona: np.ndarray) -> np.ndarray:
    jj, ii = np.nonzero(zona)
    j0, j1, i0, i1 = jj.min(), jj.max() + 1, ii.min(), ii.max() + 1
    return np.where(zona[j0:j1, i0:i1], alt[j0:j1, i0:i1], 0.0)


def compactar(pies: list[tuple[np.ndarray, str]], destino: Rejilla, izq_en: str):
    """Coloca cada pie (recorte, lado) centrado en su mitad del recuadro.

    Devuelve (altura, info por pie).
    """
    sal = np.zeros((destino.ny, destino.nx))
    info = []
    mitad = destino.nx // 2
    for recorte, lado in pies:
        a_la_izquierda = (lado == "izquierdo") == (izq_en == "izquierda")
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


def _sistema_del_plano(malla, c, n, en_plano):
    """Rectángulo de la cara sobre el plano -> (R, o, ancho, largo, datos para revisar)."""
    u0 = np.cross(n, [1.0, 0, 0] if abs(n[0]) < 0.9 else [0, 1.0, 0])
    u0 /= np.linalg.norm(u0)
    v0 = np.cross(n, u0)
    P = malla.triangles_center[en_plano] - c
    p2 = np.column_stack([P @ u0, P @ v0])
    zona = zona_principal_del_plano(p2)
    origen2, u2, v2, ancho, largo = rectangulo_minimo(p2[zona])
    ex = u2[0] * u0 + u2[1] * v0
    ey = v2[0] * u0 + v2[1] * v0
    ez = np.cross(ex, ey)  # sistema directo (sin espejo)
    if ez @ n < 0:
        ex = -ex
        ez = -ez
        origen2 = origen2 + ancho * u2
    o = c + origen2[0] * u0 + origen2[1] * v0
    return np.vstack([ex, ey, ez]), o, ancho, largo, (p2, zona, origen2, u2, v2, ancho, largo)


def _procesar_bloque(z: np.ndarray, paso: float, cfg: dict) -> tuple[np.ndarray, np.ndarray, bool] | None:
    """Mapa de alturas visto desde arriba de UN bloque -> (pie en bulto, zona, giro_180)."""
    agujero = np.isnan(z)
    prof = np.where(agujero, 0.0, np.maximum(-z, 0.0))
    prof = np.where(agujero, prof, ndimage.median_filter(prof, size=3))
    etiquetas, pies = separar_huellas(prof, paso, cfg)
    if not pies:
        return None
    zona = etiquetas == 1  # una huella por bloque: la mayor
    prof = rellenar_agujeros(prof, agujero & zona)
    if cfg["suavizado"] > 0:
        prof = np.where(zona, ndimage.gaussian_filter(prof, cfg["suavizado"] / paso), prof)
    prof = np.where(zona, np.maximum(prof, 0.0), 0.0)
    # Volcar el bloque: giro de 180° alrededor del eje Y -> x pasa a (ancho - x).
    prof, zona = prof[:, ::-1], zona[:, ::-1]
    # Dedos hacia +Y (giro de 180° alrededor de Z si hace falta).
    giro = not dedos_hacia_mas_y(zona, paso)
    if giro:
        prof, zona = prof[::-1, ::-1], zona[::-1, ::-1]
    return prof, zona, giro


def limpiar(malla: trimesh.Trimesh, taller: dict, lados: dict[int, str] | None = None) -> tuple[Campo, InformeLimpieza]:
    """Escaneo en bruto -> campo del recuadro con los pies en bulto.

    Cada bloque se trata por separado (cada uno puede estar apoyado con una inclinación
    distinta). `lados` permite forzar izquierdo/derecho ({0: "izquierdo", 1: "derecho"},
    por orden de bloque en el informe) si el usuario corrige la propuesta automática.
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
    V0 = np.asarray(malla.vertices)
    F = np.asarray(malla.faces)

    libres = np.ones(len(F), bool)
    for intento in range(3):
        # 1-2. Cara superior y rectángulo -> sistema del bloque (X ancho, Y largo, Z normal, 0 en la cara).
        try:
            c, n, en_plano = buscar_plano_superior(malla, cfg["tolerancia_plano"], validas=libres)
        except ValueError:
            if intento == 0:
                raise
            break
        area = malla.area_faces[en_plano].sum()
        if intento == 0:
            c_primero, n_primero, area_primero = c, n, area
        elif (n @ n_primero < np.cos(np.radians(25)) or area < 0.3 * area_primero
              or abs((c - c_primero) @ n_primero) > 15.0):
            # No es la cara de otro bloque (inclinada de más, pequeña, o a otra altura: la mesa).
            break
        R, o, ancho, largo, plano_2d = _sistema_del_plano(malla, c, n, en_plano)
        inf.mapas.setdefault("plano_2d", plano_2d)

        # 3. Mapa de alturas visto desde arriba, solo dentro del rectángulo.
        V = (V0 - o) @ R.T
        tri = V[F]
        dentro = (
            libres
            & (tri[:, :, 0].min(1) > 0.3) & (tri[:, :, 0].max(1) < ancho - 0.3)
            & (tri[:, :, 1].min(1) > 0.3) & (tri[:, :, 1].max(1) < largo - 0.3)
            & (tri[:, :, 2].max(1) < 3.0) & (tri[:, :, 2].min(1) > -rec["alto_z"] - 10)
        )
        z = rasterizar(V, F[dentro], Rejilla.con_paso(ancho, largo, paso), rellenar=False)
        inf.mapas.setdefault("profundidad_bruta", np.where(np.isnan(z), 0, np.maximum(-z, 0)))
        # Estas caras ya están usadas: el siguiente bloque se busca en el resto.
        cerca = (
            (tri[:, :, 0].max(1) > -5) & (tri[:, :, 0].min(1) < ancho + 5)
            & (tri[:, :, 1].max(1) > -5) & (tri[:, :, 1].min(1) < largo + 5)
            & (tri[:, :, 2].max(1) < 5.0) & (tri[:, :, 2].min(1) > -rec["alto_z"] - 10)
        )
        libres &= ~cerca

        res = _procesar_bloque(z, paso, cfg)
        M = np.eye(4)
        M[:3, :3] = R
        M[:3, 3] = -R @ o
        if res is None:
            inf.avisos.append(f"Hay un bloque de {ancho:.0f} × {largo:.0f} mm sin huella de pie.")
        else:
            prof, zona, giro = res
            inf.bloques.append(Bloque(M, ancho, largo, prof, zona, giro))
        if len(inf.bloques) >= 2:
            break

    if not inf.bloques:
        raise ValueError("No encuentro ninguna huella de pie en el escaneo.")
    if len(inf.bloques) > 2:
        inf.bloques = sorted(inf.bloques, key=lambda b: -b.zona.sum())[:2]
    for b in inf.bloques:
        if abs(b.ancho - cfg["bloque_ancho"]) > 15 or abs(b.largo - cfg["bloque_largo"]) > 15:
            inf.avisos.append(
                f"Un bloque mide {b.ancho:.0f} × {b.largo:.0f} mm; se esperaba "
                f"{cfg['bloque_ancho']:.0f} × {cfg['bloque_largo']:.0f}. Revisa que el escaneo lo incluya entero."
            )
    if len(inf.bloques) == 1:
        inf.avisos.append("Solo se ha encontrado una huella de pie.")

    # 6. Izquierdo / derecho.
    for b in inf.bloques:
        b.confianza_lado = confianza_izquierdo(b.prof, b.zona)
    if lados is not None:
        for k, b in enumerate(inf.bloques):
            b.lado = lados[k]
    elif len(inf.bloques) == 2:
        # Uno de cada: el que más parece izquierdo es el izquierdo.
        a, b = inf.bloques
        izq = a if a.confianza_lado >= b.confianza_lado else b
        for blq in inf.bloques:
            blq.lado = "izquierdo" if blq is izq else "derecho"
        if np.sign(a.confianza_lado) == np.sign(b.confianza_lado):
            inf.avisos.append("No está claro qué pie es cada uno: confírmalo.")
    else:
        b = inf.bloques[0]
        b.lado = "izquierdo" if b.confianza_lado > 0 else "derecho"

    campo = componer(inf, taller)
    if campo.z.max() > rec["alto_z"]:
        inf.avisos.append(
            f"La huella más profunda ({campo.z.max() - cfg['base']:.1f} mm) más la base "
            f"({cfg['base']:.1f} mm) supera la altura del bloque ({rec['alto_z']:.0f} mm)."
        )
    return campo, inf


def componer(inf: InformeLimpieza, taller: dict) -> Campo:
    """Coloca los pies ya limpios en el recuadro según su lado (b.lado). Rápido: sirve para
    cambiar izquierdo/derecho sin repetir la limpieza."""
    rec, cfg = taller["recuadro"], taller["limpieza"]
    destino = Rejilla.para_recuadro(rec["ancho_x"], rec["largo_y"], taller["calculo"]["rejilla"])
    alt, inf.pies = compactar([(recortar_pie(b.prof, b.zona), b.lado) for b in inf.bloques],
                              destino, cfg["pie_izquierdo_en"])
    return Campo(destino, cfg["base"] + alt, np.zeros(3))
