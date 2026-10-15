"""Molde sintético de prueba: recuadro con dos pies en bulto, mientras no hay un STL real.

La forma imita un molde positivo (planta hacia arriba): talón y antepié altos,
arco interno más bajo. No pretende ser anatómicamente exacto.
"""

from __future__ import annotations

import numpy as np

from .campo import Campo, Rejilla, campo_a_malla

# Perfil a lo largo del pie (t = 0 talón, t = 1 punta de los dedos).
_T = np.array([0.0, 0.05, 0.15, 0.30, 0.45, 0.60, 0.72, 0.80, 0.90, 1.0])
_LATERAL = np.array([8, 24, 30, 30, 30, 34, 40, 38, 30, 10])  # semiancho lado externo
_MEDIAL = np.array([8, 24, 30, 24, 20, 30, 48, 46, 40, 14])  # semiancho lado interno
_ALTURA = np.array([12, 21, 24, 21, 18, 18, 20, 15, 11, 7])  # altura del relieve


def _suave(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def altura_pie(X, Y, centro_x, talon_y, largo, medial_signo):
    """Relieve de un pie. medial_signo = +1 si el lado interno queda hacia +X."""
    t = (Y - talon_y) / largo
    u = (X - centro_x) * medial_signo
    tc = np.clip(t, 0, 1)
    lat = np.interp(tc, _T, _LATERAL)
    med = np.interp(tc, _T, _MEDIAL)
    h = np.interp(tc, _T, _ALTURA)
    # Arco interno: zona media, lado medial más baja.
    arco = 9.0 * np.exp(-((tc - 0.42) / 0.12) ** 2) * _suave(u / np.maximum(med, 1))
    # Pequeñas cabezas metatarsales.
    h = h - arco
    distancia_borde = np.minimum(u + lat, med - u)
    distancia_borde = np.minimum(distancia_borde, np.minimum(t * largo, (1 - t) * largo) + 4)
    return np.where(distancia_borde > 0, h * _suave(distancia_borde / 10.0), 0.0)


def campo_sintetico(ancho=288.0, largo=330.0, paso=0.5, fondo=2.0, alto=38.0) -> Campo:
    rejilla = Rejilla.para_recuadro(ancho, largo, paso)
    X, Y = rejilla.malla()
    z = np.full(X.shape, fondo)
    # Molde con la planta hacia arriba y dedos a +Y: en el pie izquierdo el lado
    # interno queda hacia -X. Izquierdo en la mitad izquierda, derecho en la derecha.
    z += altura_pie(X, Y, ancho * 0.25, 30.0, 255.0, -1)
    z += altura_pie(X, Y, ancho * 0.75, 34.0, 250.0, +1)
    z = np.minimum(z, alto)
    return Campo(rejilla, z, np.zeros(3))


def malla_sintetica(**kw):
    return campo_a_malla(campo_sintetico(**kw))


def campo_limpio_esperado(taller: dict, paso: float = 0.5) -> Campo:
    """Lo que debería devolver la limpieza para el escaneo en bruto sintético."""
    from .limpieza import compactar, separar_huellas

    rec, cfg = taller["recuadro"], taller["limpieza"]
    c = campo_sintetico(rec["ancho_x"], rec["largo_y"], paso, fondo=0.0)
    etiquetas, pies = separar_huellas(c.z, paso, cfg)
    x = {k: np.nonzero(etiquetas == k)[1].mean() for k in pies}
    lados = {k: ("izquierdo" if x[k] == min(x.values()) else "derecho") for k in pies}
    alt, _ = compactar(c.z, etiquetas, lados, c.rejilla, cfg["pie_izquierdo_en"])
    return Campo(c.rejilla, cfg["base"] + alt, np.zeros(3))


def malla_bruta(taller: dict, paso: float = 0.5, semilla: int = 1):
    """Escaneo en bruto sintético: mesa + dos bloques con la huella hundida, ruido,
    agujeros, un resto suelto, inclinado y girado como saldría del escáner."""
    import trimesh

    rng = np.random.default_rng(semilla)
    rec = taller["recuadro"]
    esperado = campo_limpio_esperado(taller, paso)
    prof = esperado.z - taller["limpieza"]["base"]
    # Deshacer el volcado (la huella está como en la espuma) y poner los dedos hacia -Y.
    prof = prof[:, ::-1][::-1, ::-1]
    prof = np.roll(prof, int(12 / paso), axis=0)  # pies no centrados en el bloque

    margen, hueco = 25.0, 1.0
    mesa = Rejilla.con_paso(rec["ancho_x"] + hueco + 2 * margen, rec["largo_y"] + 2 * margen, paso)
    z = np.zeros((mesa.ny, mesa.nx))
    m, h = int(margen / paso), int(hueco / paso)
    mitad = prof.shape[1] // 2
    alto = rec["alto_z"]
    z[m:m + prof.shape[0], m:m + mitad] = alto - prof[:, :mitad]
    z[m:m + prof.shape[0], m + mitad + h:m + mitad + h + prof.shape[1] - mitad] = alto - prof[:, mitad:]

    X, Y = mesa.malla()
    v = np.column_stack([X.ravel(), Y.ravel(), z.ravel()])
    v[:, 2] += rng.normal(0, 0.05, len(v))
    idx = np.arange(mesa.ny * mesa.nx).reshape(mesa.ny, mesa.nx)
    a, b, c_, d = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
    caras = np.concatenate([np.column_stack([a, b, c_]), np.column_stack([a, c_, d])])
    # Agujeros dentro de las huellas.
    centros = v[caras].mean(axis=1)
    quitar = np.zeros(len(caras), bool)
    for _ in range(6):
        k = rng.choice(np.nonzero(centros[:, 2] < alto - 8)[0])
        quitar |= np.linalg.norm(centros[:, :2] - centros[k, :2], axis=1) < 3.0
    malla = trimesh.Trimesh(v, caras[~quitar], process=False)
    resto = trimesh.creation.icosphere(subdivisions=2, radius=4.0)
    resto.apply_translation([60, 60, alto + 25])
    malla = trimesh.util.concatenate([malla, resto])
    giro = trimesh.transformations.euler_matrix(np.radians(8), np.radians(-5), np.radians(37))
    giro[:3, 3] = [-120.0, 40.0, 210.0]
    malla.apply_transform(giro)
    return malla
