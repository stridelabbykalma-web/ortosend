"""La placa que hay ahora en la CNC: qué zonas se han fresado ya en tiradas anteriores.

Las placas son del tamaño de la mesa de la CNC. Si una tirada solo ocupa una parte, la siguiente se coloca
en lo que queda libre, siempre con el mismo origen (X0 Y0 = esquina delantera izquierda, el home de la
CNC). Una zona se da por gastada al pulsar «▶ Inicio» en la tirada. Con «Placa nueva» se empieza de cero.

Se guarda en un archivo del usuario (junto a los «Ajustes de la CNC»), así no se pierde al actualizar el
programa. Las zonas van en mm desde el home: el rectángulo de cada pie con el margen de su ranura de
contorno (la misma separación que entre dos pies de una tirada).
"""

from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path

from . import config


def ruta() -> Path:
    return config.ruta_ajustes().with_name("placa_cnc.json")


def nueva(ancho: float, largo: float, alto: float) -> dict:
    return {"ancho": float(ancho), "largo": float(largo), "alto": float(alto),
            "creada": datetime.now().isoformat(timespec="minutes"), "zonas": []}


def cargar(ancho: float, largo: float, alto: float) -> dict:
    """La placa en uso; si no hay ninguna guardada (o el archivo está roto), una nueva de esa medida."""
    try:
        d = json.loads(ruta().read_text(encoding="utf-8"))
        zonas = [z for z in d["zonas"] if all(isinstance(z.get(k), (int, float)) for k in ("x", "y", "ancho", "largo"))]
        return {"ancho": float(d["ancho"]), "largo": float(d["largo"]), "alto": float(d["alto"]),
                "creada": str(d.get("creada", "")), "zonas": zonas}
    except (OSError, ValueError, KeyError, TypeError):
        return nueva(ancho, largo, alto)


def guardar(placa: dict) -> None:
    r = ruta()
    r.parent.mkdir(parents=True, exist_ok=True)
    r.write_text(json.dumps(placa, indent=1, ensure_ascii=False), encoding="utf-8")


def misma_medida(placa: dict, ancho: float, largo: float, alto: float) -> bool:
    return (abs(placa["ancho"] - ancho) < 0.5 and abs(placa["largo"] - largo) < 0.5
            and abs(placa["alto"] - alto) < 0.5)


def anadir_tirada(placa: dict, huellas_mm: list[tuple[float, float, float, float]], tirada: str) -> dict:
    """Marca como gastadas las zonas (x, y, ancho, largo en mm) de los pies de una tirada."""
    fecha = datetime.now().isoformat(timespec="minutes")
    for x, y, w, l in huellas_mm:
        placa["zonas"].append({"x": round(x, 2), "y": round(y, 2), "ancho": round(w, 2), "largo": round(l, 2),
                               "tirada": tirada, "fecha": fecha})
    return placa


def tiradas(placa: dict) -> list[str]:
    """Nombres de las tiradas de la placa, en orden."""
    vistas: list[str] = []
    for z in placa["zonas"]:
        if z.get("tirada", "") not in vistas:
            vistas.append(z.get("tirada", ""))
    return vistas


def deshacer_ultima(placa: dict) -> str | None:
    """Libera las zonas de la última tirada (si se pulsó Inicio y no se llegó a fresar). Devuelve su nombre."""
    if not placa["zonas"]:
        return None
    ultima = placa["zonas"][-1].get("tirada", "")
    fecha = placa["zonas"][-1].get("fecha", "")
    placa["zonas"] = [z for z in placa["zonas"] if (z.get("tirada", ""), z.get("fecha", "")) != (ultima, fecha)]
    return ultima


def zonas_celdas(placa: dict, paso: float) -> list[tuple[int, int, int, int]]:
    """Las zonas gastadas en celdas de la rejilla (redondeadas hacia fuera: nunca se queda corto)."""
    out = []
    for z in placa["zonas"]:
        x0, y0 = math.floor(z["x"] / paso + 1e-9), math.floor(z["y"] / paso + 1e-9)
        x1 = math.ceil((z["x"] + z["ancho"]) / paso - 1e-9)
        y1 = math.ceil((z["y"] + z["largo"]) / paso - 1e-9)
        out.append((x0, y0, x1 - x0, y1 - y0))
    return out


def fraccion_usada(placa: dict) -> float:
    """Parte de la placa ya gastada (0..1), sin contar dos veces lo que se solapa."""
    if not placa["zonas"]:
        return 0.0
    import numpy as np

    paso = 2.0
    nx, ny = int(math.ceil(placa["ancho"] / paso)), int(math.ceil(placa["largo"] / paso))
    usada = np.zeros((ny, nx), bool)
    for x, y, w, l in zonas_celdas(placa, paso):
        usada[max(y, 0):max(y + l, 0), max(x, 0):max(x + w, 0)] = True
    return float(usada.mean())
