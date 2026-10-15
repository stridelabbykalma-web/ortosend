"""Exportación de resultados: STL a escala real, STL para Fusion y receta JSON."""

from __future__ import annotations

import json
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh

from .campo import Campo, campo_a_malla


def decimar(malla: trimesh.Trimesh, objetivo: int, maximo: int) -> trimesh.Trimesh:
    """Reduce la malla a menos de `maximo` triángulos (apuntando a `objetivo`)."""
    caras = np.asarray(malla.faces)
    if len(caras) <= objetivo:
        return malla.copy()
    v = np.asarray(malla.vertices, dtype=np.float64)
    meta = objetivo
    for _ in range(6):
        reduccion = 1.0 - meta / len(caras)
        v2, f2 = fast_simplification.simplify(v, caras, target_reduction=reduccion)
        if len(f2) < maximo:
            break
        meta = int(meta * 0.95)
    else:
        raise RuntimeError("No se ha podido reducir la malla por debajo del máximo de triángulos.")
    reducida = trimesh.Trimesh(v2, f2, process=True)
    reducida.fix_normals()
    return reducida


def medidas_stl(ruta: str | Path) -> tuple[float, float, float]:
    """Tamaño (ancho X, largo Y, alto Z) de un STL en sus propias unidades."""
    m = trimesh.load(ruta, force="mesh")
    return tuple(float(v) for v in m.bounds[1] - m.bounds[0])


def exportar(campo: Campo, carpeta: str | Path, nombre: str, receta: dict, taller: dict) -> dict[str, Path]:
    """Escribe NOMBRE.stl, NOMBRE_FUSION.stl y NOMBRE_receta.json. Devuelve las rutas."""
    carpeta = Path(carpeta)
    carpeta.mkdir(parents=True, exist_ok=True)
    rutas = {
        "stl": carpeta / f"{nombre}.stl",
        "fusion": carpeta / f"{nombre}_FUSION.stl",
        "receta": carpeta / f"{nombre}_receta.json",
    }
    malla = campo_a_malla(campo)
    if not malla.is_watertight:
        raise RuntimeError("La malla resultante no es estanca (no debería pasar).")
    malla.export(rutas["stl"])

    fus = taller["fusion"]
    reducida = decimar(malla, fus["objetivo_triangulos"], fus["max_triangulos"])
    reducida.apply_scale(fus["escala"])
    reducida.export(rutas["fusion"])

    with open(rutas["receta"], "w", encoding="utf-8") as f:
        json.dump(receta, f, ensure_ascii=False, indent=2)
    return rutas
