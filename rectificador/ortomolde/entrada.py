"""Lectura del escaneo en los formatos que maneja el taller.

- `.stl`, `.ply`, `.obj`: la malla tal cual.
- `.revox`: proyecto de Revo Scan. Es un índice (JSON) que dice dónde está la malla
  (normalmente `meshs/Mesh ....ply`, en la misma carpeta del proyecto). Se abre esa malla;
  las fotos y fotogramas del proyecto se ignoran.
- `.zip`: se busca dentro un `.revox` (con su malla), o si no un `.stl`, `.ply` u `.obj`.
  Solo se extrae lo necesario, aunque el ZIP sea muy grande.
"""

from __future__ import annotations

import json
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

import trimesh

FORMATOS_MALLA = (".stl", ".ply", ".obj")
FORMATOS = FORMATOS_MALLA + (".revox", ".zip")


class ErrorEntrada(ValueError):
    pass


def _cargar(ruta_o_archivo, tipo: str) -> trimesh.Trimesh:
    malla = trimesh.load(ruta_o_archivo, file_type=tipo.lstrip("."), force="mesh")
    if not isinstance(malla, trimesh.Trimesh) or len(malla.faces) == 0:
        raise ErrorEntrada("El archivo no contiene ninguna malla.")
    return malla


def _malla_del_revox(datos: dict) -> str:
    """Ruta relativa (con /) de la malla principal del proyecto: la de más caras."""
    mallas = [m for m in datos.get("meshes", []) if m.get("file")]
    if not mallas:
        raise ErrorEntrada("El proyecto de Revo Scan no tiene ninguna malla. "
                           "Haz primero la malla en Revo Scan (o exporta a STL).")
    principal = max(mallas, key=lambda m: m.get("face_count", 0))
    return principal["file"].replace("\\", "/")


def _leer_revox(texto: bytes) -> dict:
    try:
        return json.loads(texto.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ErrorEntrada("El archivo .revox no se puede leer (no es un proyecto de Revo Scan válido).") from e


def cargar_malla(ruta: str | Path) -> trimesh.Trimesh:
    """Abre el escaneo, sea STL/PLY/OBJ, proyecto de Revo Scan (.revox) o ZIP."""
    ruta = Path(ruta)
    ext = ruta.suffix.lower()
    if ext in FORMATOS_MALLA:
        return _cargar(ruta, ext)
    if ext == ".revox":
        relativa = _malla_del_revox(_leer_revox(ruta.read_bytes()))
        malla = ruta.parent / Path(*PurePosixPath(relativa).parts)
        if not malla.exists():
            raise ErrorEntrada(
                f"El proyecto de Revo Scan apunta a «{relativa}», pero ese archivo no está junto al "
                f".revox. Abre el .revox desde la carpeta completa del proyecto (o exporta a STL)."
            )
        return _cargar(malla, malla.suffix.lower())
    if ext == ".zip":
        return _cargar_zip(ruta)
    raise ErrorEntrada(f"No sé abrir archivos «{ext}». Formatos válidos: {', '.join(FORMATOS)}.")


def _cargar_zip(ruta: Path) -> trimesh.Trimesh:
    with zipfile.ZipFile(ruta) as z:
        nombres = [n for n in z.namelist() if not n.endswith("/")]
        revox = [n for n in nombres if n.lower().endswith(".revox")]
        if revox:
            base = PurePosixPath(revox[0]).parent
            relativa = _malla_del_revox(_leer_revox(z.read(revox[0])))
            buscada = str(base / relativa) if str(base) != "." else relativa
            candidata = next((n for n in nombres if n.replace("\\", "/").lower() == buscada.lower()), None)
            if candidata is None:
                raise ErrorEntrada(
                    f"El ZIP tiene el proyecto de Revo Scan ({PurePosixPath(revox[0]).name}) pero no la malla "
                    f"«{relativa}». Comprime también la carpeta «{PurePosixPath(relativa).parts[0]}» del proyecto."
                )
            return _extraer_y_cargar(z, candidata)
        for ext in FORMATOS_MALLA:
            mallas = [n for n in nombres if n.lower().endswith(ext)]
            if mallas:
                return _extraer_y_cargar(z, max(mallas, key=lambda n: z.getinfo(n).file_size))
        contenido = ", ".join(PurePosixPath(n).name for n in nombres[:8]) or "nada"
        raise ErrorEntrada(f"En el ZIP no hay ningún escaneo (.revox, .stl, .ply u .obj). Contiene: {contenido}.")


def _extraer_y_cargar(z: zipfile.ZipFile, nombre: str) -> trimesh.Trimesh:
    """Extrae solo ese archivo (con un nombre seguro) a una carpeta temporal y lo abre."""
    ext = PurePosixPath(nombre).suffix.lower()
    with tempfile.TemporaryDirectory(prefix="rectificador_") as tmp:
        destino = Path(tmp) / f"malla{ext}"
        with z.open(nombre) as origen, open(destino, "wb") as salida:
            while bloque := origen.read(1 << 20):
                salida.write(bloque)
        return _cargar(destino, ext)
