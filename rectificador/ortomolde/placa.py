"""La placa que hay ahora en la CNC: qué zonas se han fresado ya en tiradas anteriores.

Las placas son del tamaño de la mesa de la CNC. Si una tirada solo ocupa una parte, la siguiente se coloca
en lo que queda libre, siempre con el mismo origen (X0 Y0 = esquina delantera izquierda, el home de la
CNC). Una zona se da por gastada al pulsar «▶ Inicio» en la tirada. Con «Placa nueva» se empieza de cero.

Cada placa es de una máquina y se guarda en la web de Ortosend (así cualquier ordenador del taller la ve
igual, aunque se cierre el programa). Aquí queda una copia en un archivo del usuario y, si no hay conexión,
las operaciones pendientes de enviar (`pendientes`): se mandan solas cuando vuelve. Cada placa y tirada
lleva un id propio, así reenviar no duplica nada en la web.

Las zonas van en mm desde el home: el rectángulo de cada pie con el margen de su ranura de contorno (la
misma separación que entre dos pies de una tirada).
"""

from __future__ import annotations

import json
import math
import uuid
from datetime import datetime
from pathlib import Path

from . import config


def ruta() -> Path:
    return config.ruta_ajustes().with_name("placa_cnc.json")


def _id() -> str:
    return str(uuid.uuid4())


def nueva(ancho: float, largo: float, alto: float) -> dict:
    return {"id": _id(), "ancho": float(ancho), "largo": float(largo), "alto": float(alto),
            "creada": datetime.now().isoformat(timespec="minutes"), "zonas": []}


def _placa_valida(d: dict) -> dict:
    zonas = [z for z in d["zonas"] if all(isinstance(z.get(k), (int, float)) for k in ("x", "y", "ancho", "largo"))]
    return {"id": str(d.get("id") or _id()), "ancho": float(d["ancho"]), "largo": float(d["largo"]),
            "alto": float(d["alto"]), "creada": str(d.get("creada", "")), "zonas": zonas}


def cargar_estado(ancho: float, largo: float, alto: float) -> dict:
    """{maquina: {id, nombre} | None, placa, pendientes}. Sin archivo (o roto): placa nueva, sin máquina."""
    try:
        d = json.loads(ruta().read_text(encoding="utf-8"))
        if "placa" not in d:  # archivo de la 0.10.0: solo la placa
            d = {"maquina": None, "placa": d, "pendientes": []}
        maquina = d.get("maquina")
        if maquina is not None and not (isinstance(maquina, dict) and maquina.get("id")):
            maquina = None
        pendientes = [op for op in d.get("pendientes") or [] if isinstance(op, dict) and op.get("op")]
        return {"maquina": maquina, "placa": _placa_valida(d["placa"]), "pendientes": pendientes}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {"maquina": None, "placa": nueva(ancho, largo, alto), "pendientes": []}


def guardar_estado(estado: dict) -> None:
    r = ruta()
    r.parent.mkdir(parents=True, exist_ok=True)
    r.write_text(json.dumps(estado, indent=1, ensure_ascii=False), encoding="utf-8")


def cargar(ancho: float, largo: float, alto: float) -> dict:
    """Solo la placa en uso (copia de este ordenador)."""
    return cargar_estado(ancho, largo, alto)["placa"]


def misma_medida(placa: dict, ancho: float, largo: float, alto: float) -> bool:
    return (abs(placa["ancho"] - ancho) < 0.5 and abs(placa["largo"] - largo) < 0.5
            and abs(placa["alto"] - alto) < 0.5)


def anadir_tirada(placa: dict, huellas_mm: list[tuple[float, float, float, float]], tirada: str) -> dict:
    """Marca como gastadas las zonas (x, y, ancho, largo en mm) de los pies de una tirada. Devuelve la
    operación para la web: {op: "tirada", id, placaId, nombre, zonas}."""
    fecha = datetime.now().isoformat(timespec="minutes")
    tid = _id()
    zonas = [{"x": round(x, 2), "y": round(y, 2), "ancho": round(w, 2), "largo": round(l, 2)}
             for x, y, w, l in huellas_mm]
    for z in zonas:
        placa["zonas"].append({**z, "tirada": tirada, "fecha": fecha, "tiradaId": tid})
    return {"op": "tirada", "id": tid, "placaId": placa["id"], "nombre": tirada, "zonas": zonas}


def tiradas(placa: dict) -> list[str]:
    """Nombres de las tiradas de la placa, en orden."""
    vistas: list[str] = []
    for z in placa["zonas"]:
        if z.get("tirada", "") not in vistas:
            vistas.append(z.get("tirada", ""))
    return vistas


def _clave(z: dict):
    return z.get("tiradaId") or (z.get("tirada", ""), z.get("fecha", ""))


def deshacer_ultima(placa: dict) -> tuple[str, str | None] | None:
    """Libera las zonas de la última tirada (si se pulsó Inicio y no se llegó a fresar).
    Devuelve (nombre, id de la tirada) o None si no había ninguna."""
    if not placa["zonas"]:
        return None
    ultima = placa["zonas"][-1]
    clave = _clave(ultima)
    placa["zonas"] = [z for z in placa["zonas"] if _clave(z) != clave]
    return ultima.get("tirada", ""), ultima.get("tiradaId")


def desde_web(m: dict) -> dict | None:
    """La placa de una máquina tal como la devuelve la web (o None si aún no tiene)."""
    p = m.get("placa")
    if not p:
        return None
    zonas = [{**z, "tirada": t["nombre"], "fecha": t.get("fecha", "")[:16], "tiradaId": t["id"]}
             for t in p.get("tiradas") or [] for z in t.get("zonas") or []]
    return {"id": p["id"], "ancho": float(p["ancho"]), "largo": float(p["largo"]), "alto": float(p["alto"]),
            "creada": p.get("puesta", "")[:16], "zonas": zonas}


def operaciones_para_subir(placa: dict) -> list[dict]:
    """Para una máquina que aún no tiene placa en la web: la placa de este ordenador y sus tiradas."""
    ops = [{"op": "placa", "id": placa["id"], "ancho": placa["ancho"], "largo": placa["largo"], "alto": placa["alto"]}]
    grupos: dict = {}
    for z in placa["zonas"]:
        grupos.setdefault(_clave(z), []).append(z)
    for clave, zs in grupos.items():
        tid = zs[0].get("tiradaId") or _id()
        for z in zs:
            z["tiradaId"] = tid
        ops.append({"op": "tirada", "id": tid, "placaId": placa["id"], "nombre": zs[0].get("tirada", "") or "tirada",
                    "zonas": [{k: z[k] for k in ("x", "y", "ancho", "largo")} for z in zs]})
    return ops


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
