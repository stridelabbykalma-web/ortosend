"""Actualizaciones del programa desde GitHub.

Si el programa está instalado con `instalar.bat` (en `%LOCALAPPDATA%\\RectificadorOrtosend\\programa`), se
actualiza con un clic:
1. se descarga el ZIP de la rama publicada y se extrae SOLO la carpeta `rectificador` en
   `...\\actualizacion\\nueva` (comprobando que está completa y que es la versión anunciada);
2. el programa se cierra y un pequeño `.bat` cambia las carpetas (`programa` → `programa_anterior`,
   `nueva` → `programa`), reinstala lo de Python solo si ha cambiado `requirements.txt` y vuelve a abrirlo;
3. si algo falla, se vuelve a poner la versión de antes y se abre esa.
Las carpetas se cambian con el programa cerrado porque Windows no deja renombrar una carpeta en uso.

Si no está instalado así (p. ej. abierto con `arrancar.bat` desde otra carpeta), se ofrece descargar el ZIP.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

REPOSITORIO = "stridelabbykalma-web/ortosend"
RAMA = "claude/rectificador-moldes"
URL_BRUTO = f"https://raw.githubusercontent.com/{REPOSITORIO}/{RAMA}/rectificador"
URL_VERSION = f"{URL_BRUTO}/VERSION"
URL_NOVEDADES = f"{URL_BRUTO}/NOVEDADES.md"
URL_DESCARGA = f"https://codeload.github.com/{REPOSITORIO}/zip/refs/heads/{RAMA}"
NECESARIOS = ("interfaz/principal.py", "ortomolde/__init__.py", "requirements.txt", "VERSION", "config/taller.toml")


class ErrorActualizacion(RuntimeError):
    pass


def version(texto: str) -> tuple:
    return tuple(int(p) for p in texto.strip().split(".") if p.isdigit())


def _leer(url: str, espera: float) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=espera) as r:
            return r.read().decode("utf-8")
    except Exception:  # noqa: BLE001 - sin internet no pasa nada
        return None


def version_publicada(espera: float = 6.0) -> str | None:
    """La última versión publicada (o None si no hay internet)."""
    texto = _leer(URL_VERSION, espera)
    return texto.strip() if texto else None


def novedades_publicadas(espera: float = 6.0) -> str:
    return _leer(URL_NOVEDADES, espera) or ""


def novedades(texto: str, desde: str) -> str:
    """Las secciones de NOVEDADES.md («## 0.3.0 ...») de las versiones posteriores a `desde`."""
    trozos = re.split(r"(?m)^(?=## )", texto)
    elegidos = []
    for t in trozos:
        m = re.match(r"## +v?(\d+(?:\.\d+)*)", t)
        if m and version(m.group(1)) > version(desde):
            elegidos.append(t.strip())
    return "\n\n".join(elegidos)


def base_instalada(archivo: str | Path | None = None) -> Path | None:
    """`...\\RectificadorOrtosend` si este programa es el instalado con instalar.bat (solo en Windows)."""
    if not sys.platform.startswith("win") or not os.environ.get("LOCALAPPDATA"):
        return None
    base = Path(os.environ["LOCALAPPDATA"]) / "RectificadorOrtosend"
    programa = Path(archivo or __file__).resolve().parents[1]
    try:
        return base if programa == (base / "programa").resolve() else None
    except OSError:
        return None


def descargar(destino: Path, progreso=None) -> Path:
    """Descarga el ZIP de la rama publicada. `progreso(bajado, total)` se llama mientras tanto."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(URL_DESCARGA, timeout=30) as r, open(destino, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        bajado = 0
        while True:
            trozo = r.read(1 << 16)
            if not trozo:
                break
            f.write(trozo)
            bajado += len(trozo)
            if progreso:
                progreso(bajado, total)
    return destino


def preparar(zip_ruta: Path, nueva: Path, version_esperada: str) -> Path:
    """Extrae la carpeta `rectificador` del ZIP de GitHub en `nueva` y comprueba que está completa."""
    if nueva.exists():
        shutil.rmtree(nueva)
    try:
        with zipfile.ZipFile(zip_ruta) as z:
            nombres = z.namelist()
            versiones = [n for n in nombres if re.fullmatch(r"[^/]+/rectificador/VERSION", n)]
            if not versiones:
                raise ErrorActualizacion("La descarga no contiene el programa.")
            prefijo = versiones[0][: -len("VERSION")]
            for n in nombres:
                if not n.startswith(prefijo) or n.endswith("/"):
                    continue
                relativa = n[len(prefijo):]
                partes = Path(relativa).parts
                if not partes or partes[0] in ("tests", "__pycache__") or ".." in partes:
                    continue
                destino = nueva / relativa
                destino.parent.mkdir(parents=True, exist_ok=True)
                with z.open(n) as origen, open(destino, "wb") as f:
                    shutil.copyfileobj(origen, f)
    except zipfile.BadZipFile as e:
        raise ErrorActualizacion("La descarga está dañada.") from e
    try:
        faltan = [r for r in NECESARIOS if not (nueva / r).exists()]
        if faltan:
            raise ErrorActualizacion("A la descarga le faltan archivos: " + ", ".join(faltan))
        publicada = (nueva / "VERSION").read_text(encoding="utf-8").strip()
        if version(publicada) != version(version_esperada):
            raise ErrorActualizacion(f"Se esperaba la versión {version_esperada} y ha llegado la {publicada}.")
    except ErrorActualizacion:
        shutil.rmtree(nueva, ignore_errors=True)
        raise
    return nueva


def huella(ruta: Path) -> str:
    return hashlib.sha256(ruta.read_bytes()).hexdigest()


def requisitos_cambian(nueva: Path, entorno: Path) -> bool:
    guardada = entorno / "requisitos.sha"
    if not guardada.exists():
        return True
    return guardada.read_text(encoding="utf-8", errors="ignore").strip().lower() != huella(nueva / "requirements.txt")


def script_de_cambio(pid: int, nueva_version: str, reinstalar: bool, huella_nueva: str) -> str:
    """El .bat que cambia las carpetas con el programa ya cerrado (texto en ASCII y con fin de línea de Windows).

    Las rutas salen de %LOCALAPPDATA% (no se escriben): así vale aunque el nombre de usuario lleve tildes o eñes."""
    pyw = "%BASE%\\entorno\\Scripts\\pythonw.exe"
    py = "%BASE%\\entorno\\Scripts\\python.exe"
    lineas = [
        "@echo off",
        "rem Actualizacion del Rectificador de moldes - Ortosend (creado por el programa).",
        "setlocal",
        'set "BASE=%LOCALAPPDATA%\\RectificadorOrtosend"',
        'set "LOG=%BASE%\\instalacion.log"',
        f'echo Actualizacion a la version {nueva_version} %DATE% %TIME% >> "%LOG%"',
        "set /a ESPERA=0",
        ":esperar",
        f'tasklist /fi "PID eq {pid}" 2>nul | find " {pid} " >nul',
        "if not errorlevel 1 (",
        "    set /a ESPERA+=1",
        "    if %ESPERA% lss 60 (timeout /t 1 /nobreak >nul & goto esperar)",
        ")",
        'if exist "%BASE%\\programa_anterior" rmdir /s /q "%BASE%\\programa_anterior"',
        'move "%BASE%\\programa" "%BASE%\\programa_anterior" >> "%LOG%" 2>&1',
        "if errorlevel 1 goto fallo",
        'move "%BASE%\\actualizacion\\nueva" "%BASE%\\programa" >> "%LOG%" 2>&1',
        "if errorlevel 1 goto deshacer",
    ]
    if reinstalar:
        lineas += [
            f'"{py}" -m pip install -r "%BASE%\\programa\\requirements.txt" >> "%LOG%" 2>&1',
            "if errorlevel 1 goto deshacer",
            f'> "%BASE%\\entorno\\requisitos.sha" echo {huella_nueva}',
        ]
    lineas += [
        'rmdir /s /q "%BASE%\\programa_anterior"',
        'rmdir /s /q "%BASE%\\actualizacion"',
        'echo Actualizacion terminada >> "%LOG%"',
        f'start "" "{pyw}" "%BASE%\\programa\\interfaz\\principal.py" --actualizado',
        "exit /b 0",
        ":deshacer",
        'echo Algo ha fallado: se vuelve a la version anterior >> "%LOG%"',
        'if exist "%BASE%\\programa_anterior" (',
        '    if exist "%BASE%\\programa" rmdir /s /q "%BASE%\\programa"',
        '    move "%BASE%\\programa_anterior" "%BASE%\\programa" >> "%LOG%" 2>&1',
        ")",
        ":fallo",
        f'start "" "{pyw}" "%BASE%\\programa\\interfaz\\principal.py" --fallo-actualizacion',
        "exit /b 1",
    ]
    return "\r\n".join(lineas) + "\r\n"


def lanzar_cambio(base: Path, nueva_version: str) -> None:
    """Escribe el .bat y lo lanza en segundo plano (el programa debe cerrarse justo después)."""
    import subprocess

    nueva = base / "actualizacion" / "nueva"
    reinstalar = requisitos_cambian(nueva, base / "entorno")
    texto = script_de_cambio(os.getpid(), nueva_version, reinstalar, huella(nueva / "requirements.txt"))
    bat = base / "actualizar.bat"
    bat.write_bytes(texto.encode("ascii"))
    subprocess.Popen(["cmd", "/c", str(bat)], cwd=str(base),
                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
                     | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                     close_fds=True)
