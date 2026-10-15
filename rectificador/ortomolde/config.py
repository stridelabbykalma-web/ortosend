"""Carga de los archivos de configuración (.toml) de la carpeta config/."""

from __future__ import annotations

import tomllib
from pathlib import Path

CARPETA_CONFIG = Path(__file__).resolve().parent.parent / "config"


def _leer(nombre: str, carpeta: Path | None = None) -> dict:
    ruta = (carpeta or CARPETA_CONFIG) / nombre
    with open(ruta, "rb") as f:
        return tomllib.load(f)


def taller(carpeta: Path | None = None) -> dict:
    return _leer("taller.toml", carpeta)


def valores_clinicos(carpeta: Path | None = None) -> dict:
    return _leer("valores_clinicos.toml", carpeta)
