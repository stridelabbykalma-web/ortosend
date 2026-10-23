"""Carga de los archivos de configuración (.toml) de la carpeta config/.

Las velocidades y pasadas de la CNC dependen del material del molde ([materiales] en taller.toml: espuma
XPS, escayola celular…). El material elegido y lo que se cambie desde la app («Ajustes de la CNC») se
guardan aparte, en un archivo del usuario fuera de la carpeta del programa, para que la actualización
automática no los borre. `taller.toml` queda como «los de fábrica» de cada material."""

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
    "bajada_por_pasada": (0.5, 30),
    "bajada_contorno": (0.5, 30),
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


def materiales(carpeta: Path | None = None) -> dict[str, dict]:
    """Materiales del molde: clave → {nombre, plancha_alto, velocidades y pasadas}."""
    return {k: v for k, v in _leer("taller.toml", carpeta)["materiales"].items() if isinstance(v, dict)}


def _por_defecto(carpeta: Path | None = None) -> str:
    return _leer("taller.toml", carpeta)["materiales"]["por_defecto"]


def _archivo() -> dict:
    try:
        datos = json.loads(ruta_ajustes().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return datos if isinstance(datos, dict) else {}


def material_actual() -> str:
    """Clave del material elegido en la app (o el de fábrica)."""
    m = _archivo().get("material")
    return m if isinstance(m, str) and m in materiales() else _por_defecto()


def ajustes_cnc() -> dict:
    """Los parámetros cambiados en la app para el material elegido (solo los válidos). Si no hay o el
    archivo es de antes de poder elegir material (eran de la escayola): {}."""
    datos = _archivo()
    cnc = datos.get("cnc")
    if not isinstance(cnc, dict) or datos.get("material") != material_actual():
        return {}
    return {k: float(v) for k, v in cnc.items() if _valido(k, v)}


def guardar_ajustes_cnc(cambios: dict, material: str | None = None) -> None:
    """Guarda el material y los parámetros cambiados para él. Material de fábrica sin cambios: se borra
    el archivo (todo de fábrica)."""
    ruta = ruta_ajustes()
    material = material or material_actual()
    cambios = {k: float(v) for k, v in cambios.items() if _valido(k, v)}
    if not cambios and material == _por_defecto():
        ruta.unlink(missing_ok=True)
        return
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps({"material": material, "cnc": cambios}, indent=2, ensure_ascii=False), encoding="utf-8")


def cnc_de_fabrica(material: str | None = None, carpeta: Path | None = None) -> dict:
    """[cnc] con los valores de fábrica del material (y su nombre en `material`)."""
    datos = _leer("taller.toml", carpeta)
    clave = material or material_actual()
    m = datos["materiales"][clave]
    cnc = dict(datos["cnc"])
    cnc.update({k: v for k, v in m.items() if k not in ("nombre", "plancha_alto")})
    cnc["material"] = m["nombre"]
    cnc["material_clave"] = clave
    return cnc


def aplicar_ajustes_cnc(cnc: dict, cambios: dict, material: str | None = None) -> None:
    """Pone en `cnc` los de fábrica del material y encima los cambiados (en el mismo dict, que lo comparten
    las ventanas)."""
    fabrica = cnc_de_fabrica(material)
    for k in CNC_EDITABLE:
        cnc[k] = cambios.get(k, fabrica[k])
    cnc["material"] = fabrica["material"]
    cnc["material_clave"] = fabrica["material_clave"]
    cnc["ajustes_propios"] = bool(cambios)


def taller(carpeta: Path | None = None) -> dict:
    datos = _leer("taller.toml", carpeta)
    material = material_actual() if carpeta is None else datos["materiales"]["por_defecto"]
    cambios = ajustes_cnc() if carpeta is None else {}
    datos["cnc"] = cnc_de_fabrica(material, carpeta)
    datos["cnc"].update(cambios)
    datos["cnc"]["ajustes_propios"] = bool(cambios)
    datos["plancha"]["alto_z"] = float(datos["materiales"][material]["plancha_alto"])
    return datos


def valores_clinicos(carpeta: Path | None = None) -> dict:
    return _leer("valores_clinicos.toml", carpeta)
