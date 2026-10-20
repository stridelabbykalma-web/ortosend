"""Actualizaciones del programa desde GitHub.

Si el programa está instalado con `instalar.bat` (en `%LOCALAPPDATA%\\RectificadorOrtosend\\programa`), se
actualiza con un clic:
1. se descargan los archivos de la versión publicada en `...\\actualizacion\\nueva`, uno a uno desde
   raw.githubusercontent.com (el mismo sitio del que se lee la versión) según `MANIFIESTO.txt`, comprobando
   la huella de cada uno; si eso falla, se prueba con el ZIP de la rama (codeload.github.com). En los dos
   casos se comprueba que está completa y que es la versión anunciada;
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
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

REPOSITORIO = "stridelabbykalma-web/ortosend"
RAMA = "claude/rectificador-moldes"
URL_BRUTO = f"https://raw.githubusercontent.com/{REPOSITORIO}/{RAMA}/rectificador"
URL_VERSION = f"{URL_BRUTO}/VERSION"
URL_NOVEDADES = f"{URL_BRUTO}/NOVEDADES.md"
URL_MANIFIESTO = f"{URL_BRUTO}/MANIFIESTO.txt"
MANIFIESTO = "MANIFIESTO.txt"
URL_DESCARGA = f"https://codeload.github.com/{REPOSITORIO}/zip/refs/heads/{RAMA}"
NECESARIOS = ("interfaz/principal.py", "ortomolde/__init__.py", "requirements.txt", "VERSION", "config/taller.toml")


class ErrorActualizacion(RuntimeError):
    pass


def version(texto: str) -> tuple:
    return tuple(int(p) for p in texto.strip().split(".") if p.isdigit())


def _sin_cache(url: str) -> str:
    """raw.githubusercontent.com guarda cada archivo 5 minutos: con una marca distinta en cada petición se
    lee siempre lo último publicado."""
    if not url.startswith(URL_BRUTO):
        return url
    import time

    return f"{url}?v={time.time_ns()}"


def _leer(url: str, espera: float) -> str | None:
    try:
        with urllib.request.urlopen(_sin_cache(url), timeout=espera) as r:
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


def explicar(error: Exception) -> str:
    """El error en palabras sencillas (texto plano, sin «<...>»)."""
    if isinstance(error, urllib.error.HTTPError):
        return f"el servidor ha contestado «{error.code} {error.reason}»"
    if isinstance(error, urllib.error.URLError):
        motivo = error.reason
        return f"no se ha podido conectar ({motivo})" if motivo else "no se ha podido conectar"
    if isinstance(error, TimeoutError):
        return "la conexión ha tardado demasiado"
    return str(error) or error.__class__.__name__


def _bajar(url: str, espera: float = 60.0, intentos: int = 3) -> bytes:
    ultimo = None
    for _ in range(intentos):
        try:
            with urllib.request.urlopen(_sin_cache(url), timeout=espera) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code < 500:
                raise
            ultimo = e
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            ultimo = e
    raise ultimo


# ------------------------------------------------------------------ manifiesto (lista de archivos con su huella)

def _contenido_publicado(ruta: Path) -> bytes:
    """Los bytes tal como los guarda GitHub (los .bat con fin de línea LF; en el disco van con CRLF)."""
    datos = ruta.read_bytes()
    return datos.replace(b"\r\n", b"\n") if ruta.suffix.lower() == ".bat" else datos


def generar_manifiesto(carpeta: Path, archivos: list[str]) -> str:
    """Una línea por archivo: «huella tamaño ruta» (rutas relativas a `rectificador/`)."""
    lineas = []
    for r in sorted(archivos):
        datos = _contenido_publicado(carpeta / r)
        lineas.append(f"{hashlib.sha256(datos).hexdigest()} {len(datos)} {r}")
    return "\n".join(lineas) + "\n"


def leer_manifiesto(texto: str) -> list[tuple[str, int, str]]:
    filas = []
    for linea in texto.splitlines():
        if not linea.strip():
            continue
        huella_, tam, ruta = linea.split(" ", 2)
        partes = Path(ruta).parts
        if ruta.startswith(("/", "\\")) or ".." in partes or ":" in ruta:
            raise ErrorActualizacion(f"Ruta no válida en la lista de archivos: {ruta}")
        filas.append((huella_, int(tam), ruta))
    if not filas:
        raise ErrorActualizacion("La lista de archivos está vacía.")
    return filas


def descargar_archivos(nueva: Path, version_esperada: str, progreso=None) -> Path:
    """Baja cada archivo de la versión publicada (según MANIFIESTO.txt) y comprueba su huella."""
    if nueva.exists():
        shutil.rmtree(nueva)
    try:
        filas = leer_manifiesto(_bajar(URL_MANIFIESTO).decode("utf-8"))
        total = sum(t for _, t, _ in filas)
        bajado = 0
        for huella_, tam, ruta in filas:
            datos = _bajar(f"{URL_BRUTO}/{urllib.parse.quote(ruta)}")
            if hashlib.sha256(datos).hexdigest() != huella_:
                raise ErrorActualizacion(f"{ruta} ha llegado distinto de lo publicado (prueba dentro de unos minutos).")
            if ruta.lower().endswith(".bat"):
                datos = datos.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
            destino = nueva / ruta
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(datos)
            bajado += tam
            if progreso:
                progreso(bajado, total)
        _comprobar(nueva, version_esperada)
    except Exception:
        shutil.rmtree(nueva, ignore_errors=True)
        raise
    return nueva


def obtener(base: Path, version_esperada: str, progreso=None) -> Path:
    """Deja la versión nueva en `base/actualizacion/nueva`: archivo a archivo y, si falla, con el ZIP."""
    carpeta = base / "actualizacion"
    nueva = carpeta / "nueva"
    try:
        return descargar_archivos(nueva, version_esperada, progreso)
    except Exception as e1:  # noqa: BLE001 - se prueba el otro camino
        primero = explicar(e1)
    try:
        zipf = descargar(carpeta / "descarga.zip", progreso)
        return preparar(zipf, nueva, version_esperada)
    except Exception as e2:  # noqa: BLE001
        raise ErrorActualizacion(f"{primero}; con el ZIP: {explicar(e2)}") from e2


def descargar(destino: Path, progreso=None) -> Path:
    """Descarga el ZIP de la rama publicada. `progreso(bajado, total)` se llama mientras tanto."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(URL_DESCARGA, timeout=60) as r, open(destino, "wb") as f:
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
        _comprobar(nueva, version_esperada)
    except ErrorActualizacion:
        shutil.rmtree(nueva, ignore_errors=True)
        raise
    return nueva


def _comprobar(nueva: Path, version_esperada: str) -> None:
    faltan = [r for r in NECESARIOS if not (nueva / r).exists()]
    if faltan:
        raise ErrorActualizacion("A la descarga le faltan archivos: " + ", ".join(faltan))
    publicada = (nueva / "VERSION").read_text(encoding="utf-8").strip()
    if version(publicada) != version(version_esperada):
        raise ErrorActualizacion(f"Se esperaba la versión {version_esperada} y ha llegado la {publicada}.")


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
