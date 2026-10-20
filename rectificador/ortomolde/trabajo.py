"""Guardar y volver a abrir el trabajo de un paciente (archivo `.molde`).

Un `.molde` es un ZIP con:
- `trabajo.json`: datos del paciente, referencias, recorte, piezas, lijado, lados y la receta completa;
- `campo.npz`: el escaneo YA LIMPIO (mapa de alturas) y los bloques de la limpieza, comprimidos.

Así se reabre al momento (sin volver a limpiar el escaneo) y no hace falta que el escaneo original siga
en su sitio. El resultado es exactamente el mismo molde.
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import date
from pathlib import Path

import numpy as np

from . import __version__
from . import piezas as piezas_mod
from .campo import Campo, Rejilla
from .limpieza import Bloque, InformeLimpieza
from .pies import detectar_pies
from .proyecto import Proyecto
from .recorte import Recorte
from .referencias import Referencias

FORMATO = "ortosend-molde"
VERSION = 1
EXTENSION = ".molde"


class ErrorTrabajo(ValueError):
    pass


def paciente_vacio() -> dict:
    return {"nombre": "", "fecha": date.today().isoformat(), "notas": ""}


def guardar(proyecto: Proyecto, ruta: str | Path) -> Path:
    ruta = Path(ruta)
    if ruta.suffix.lower() != EXTENSION:
        ruta = ruta.with_suffix(EXTENSION)
    o = proyecto.original
    arrays = {"z": np.asarray(o.z, float), "desplazamiento": np.asarray(o.desplazamiento, float)}
    informe = None
    if proyecto.informe is not None:
        inf = proyecto.informe
        bloques = []
        for k, b in enumerate(inf.bloques):
            arrays[f"bloque{k}_prof"] = np.asarray(b.prof, float)
            arrays[f"bloque{k}_zona"] = b.zona
            arrays[f"bloque{k}_matriz"] = b.matriz
            bloques.append({"ancho": b.ancho, "largo": b.largo, "giro_180": b.giro_180, "lado": b.lado,
                            "confianza_lado": b.confianza_lado})
        informe = {"modo": inf.modo, "avisos": list(inf.avisos), "pies": inf.pies, "bloques": bloques}
    datos = {
        "formato": FORMATO,
        "version": VERSION,
        "version_programa": __version__,
        "paciente": proyecto.paciente or paciente_vacio(),
        "escaneo": {"ruta": str(proyecto.ruta_stl), "sha256": proyecto.huella_stl, "tipo": proyecto.tipo},
        "rejilla": o.rejilla.a_dict(),
        "fondo": proyecto.fondo,
        "lijado": proyecto.lijado,
        "informe": informe,
        "pies": [{"lado": p.lado, "referencias": {k: [float(v[0]), float(v[1])] for k, v in p.referencias.puntos.items()},
                  "recorte": p.recorte.a_dict(),
                  "piezas": {k: v.a_dict() for k, v in p.piezas.items()}} for p in proyecto.pies],
        "taller": proyecto.taller,
        "valores_clinicos": proyecto.clinicos,
        "receta": proyecto.receta(),
    }
    npz = io.BytesIO()
    np.savez_compressed(npz, **arrays)
    temporal = ruta.with_name(ruta.name + ".tmp")
    with zipfile.ZipFile(temporal, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("trabajo.json", json.dumps(datos, ensure_ascii=False, indent=1, default=_a_json))
        z.writestr("campo.npz", npz.getvalue())
    temporal.replace(ruta)  # se escribe entero o nada (si se va la luz no queda un archivo a medias)
    return ruta


def _a_json(v):
    if isinstance(v, (np.floating, np.integer)):
        return v.item()
    if isinstance(v, np.ndarray):
        return v.tolist()
    if isinstance(v, Path):
        return str(v)
    raise TypeError(f"No se puede guardar {type(v)}")


def abrir(ruta: str | Path) -> Proyecto:
    """Vuelve a abrir un `.molde` tal como se guardó."""
    ruta = Path(ruta)
    try:
        with zipfile.ZipFile(ruta) as z:
            datos = json.loads(z.read("trabajo.json").decode("utf-8"))
            arrays = dict(np.load(io.BytesIO(z.read("campo.npz"))))
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError) as e:
        raise ErrorTrabajo(f"{ruta.name} no es un trabajo del rectificador o está dañado.") from e
    if datos.get("formato") != FORMATO:
        raise ErrorTrabajo(f"{ruta.name} no es un trabajo del rectificador.")
    if datos.get("version", 0) > VERSION:
        raise ErrorTrabajo(f"{ruta.name} se guardó con una versión más nueva del programa: actualízalo.")
    r = datos["rejilla"]
    rejilla = Rejilla(int(r["nx"]), int(r["ny"]), float(r["dx"]), float(r["dy"]))
    campo = Campo(rejilla, arrays["z"].astype(float), arrays["desplazamiento"])
    informe = None
    if datos.get("informe"):
        i = datos["informe"]
        bloques = [Bloque(arrays[f"bloque{k}_matriz"], b["ancho"], b["largo"], arrays[f"bloque{k}_prof"].astype(float),
                          arrays[f"bloque{k}_zona"].astype(bool), b["giro_180"], b["lado"], b["confianza_lado"])
                   for k, b in enumerate(i["bloques"])]
        informe = InformeLimpieza(modo=i["modo"], avisos=list(i["avisos"]), bloques=bloques, pies=i["pies"])
    esc = datos["escaneo"]
    taller, clinicos = datos["taller"], datos["valores_clinicos"]
    p = Proyecto(Path(esc["ruta"]), campo, float(datos["fondo"]), taller, clinicos, esc.get("sha256", ""),
                 esc.get("tipo", "limpio"), informe, lijado=float(datos["lijado"]))
    p.paciente = dict(datos.get("paciente") or paciente_vacio())
    p.pies = detectar_pies(campo, p.fondo, taller["limpieza"]["pie_izquierdo_en"])
    guardados = datos["pies"]
    if len(guardados) != len(p.pies):
        raise ErrorTrabajo(f"{ruta.name}: no coinciden los pies guardados con el molde.")
    for pie, g in zip(p.pies, guardados):
        pie.lado = g["lado"]
        pie.referencias = Referencias.de_dict(g["referencias"])
        pie.recorte = Recorte.de_dict(g["recorte"])
        pie.piezas = piezas_mod.por_defecto(clinicos)
        for k, v in g.get("piezas", {}).items():
            pie.piezas[k] = piezas_mod.Pieza.de_dict(v)
    from . import referencias as _ref
    _ref.EJE_SIN_2_3 = clinicos.get("referencias", {}).get("eje_sin_2_3", _ref.EJE_SIN_2_3)
    return p
