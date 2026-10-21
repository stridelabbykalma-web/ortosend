"""Carga de los archivos de configuración (.toml) de la carpeta config/.

Los parámetros de la CNC que se cambian desde la app («Ajustes de la CNC») se guardan aparte, en un
archivo del usuario fuera de la carpeta del programa, para que la actualización automática no los borre.
`taller.toml` queda como «los de fábrica»."""

from __future__ import annotations

import json
import os
import tomllib
from pathlib import Path

CARPETA_CONFIG = Path(__file__).resolve().parent.parent / "config"

#: Parámetros de [cnc] que se pueden cambiar en la app: (mínimo, máximo).
CNC_EDITABLE: dict[str, tuple[float, float]] = {
    "revoluciones": (1000, 30000),
    "avance_desbaste": (100, 10000),
    "avance_entrada": (50, 10000),
    "avance_bajada": (20, 5000),
    "avance_acabado": (100, 10000),
    "bajada_por_pasada": (0.5, 20),
    "bajada_contorno": (0.5, 20),
    "paso_desbaste": (0.5, 25),
    "sobrante_desbaste": (0, 3),
    "rebaje_superior": (0, 10),
    "radio_helice": (0, 10),
    "rampa_grados": (0.5, 15),
    "paso_acabado": (0.2, 10),
    "altura_seguridad": (5, 50),
}


def _leer(nombre: str, carpeta: Path | None = None) -> dict:
    ruta = (carpeta or CARPETA_CONFIG) / nombre
    with open(ruta, "rb") as f:
        return tomllib.load(f)


def ruta_ajustes() -> Path:
    if os.environ.get("ORTOSEND_AJUSTES"):
        return Path(os.environ["ORTOSEND_AJUSTES"])
    if os.environ.get("APPDATA"):
        return Path(os.environ["APPDATA"]) / "Ortosend" / "ajustes_taller.json"
    return Path.home() / ".config" / "ortosend" / "ajustes_taller.json"


def _valido(clave: str, valor) -> bool:
    if clave not in CNC_EDITABLE or isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return False
    lo, hi = CNC_EDITABLE[clave]
    return lo <= valor <= hi


def ajustes_cnc() -> dict:
    """Los parámetros de la CNC cambiados en la app (solo los válidos). Sin archivo o roto: {}."""
    try:
        datos = json.loads(ruta_ajustes().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    cnc = datos.get("cnc") if isinstance(datos, dict) else None
    if not isinstance(cnc, dict):
        return {}
    return {k: float(v) for k, v in cnc.items() if _valido(k, v)}


def guardar_ajustes_cnc(cambios: dict) -> None:
    """Guarda los parámetros cambiados; con {} se vuelve a los de fábrica (se borra el archivo)."""
    ruta = ruta_ajustes()
    cambios = {k: float(v) for k, v in cambios.items() if _valido(k, v)}
    if not cambios:
        ruta.unlink(missing_ok=True)
        return
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps({"cnc": cambios}, indent=2, ensure_ascii=False), encoding="utf-8")


def cnc_de_fabrica(carpeta: Path | None = None) -> dict:
    return _leer("taller.toml", carpeta)["cnc"]


def aplicar_ajustes_cnc(cnc: dict, cambios: dict) -> None:
    """Pone en `cnc` los de fábrica y encima los cambiados (en el mismo dict, que lo comparten las ventanas)."""
    fabrica = cnc_de_fabrica()
    for k in CNC_EDITABLE:
        cnc[k] = cambios.get(k, fabrica[k])
    cnc["ajustes_propios"] = bool(cambios)


def taller(carpeta: Path | None = None) -> dict:
    datos = _leer("taller.toml", carpeta)
    cambios = ajustes_cnc()
    datos["cnc"].update(cambios)
    datos["cnc"]["ajustes_propios"] = bool(cambios)
    return datos


def valores_clinicos(carpeta: Path | None = None) -> dict:
    return _leer("valores_clinicos.toml", carpeta)
