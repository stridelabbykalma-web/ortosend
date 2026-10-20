"""Botón «Escanear»: abre Revo Scan y, cuando se exporta el escaneo a la carpeta de escaneos, lo abre solo.

Revo Scan no se puede manejar desde otro programa (no tiene órdenes ni API), así que se hace así:
1. se abre Revo Scan (se busca en Archivos de programa; si no aparece, se pregunta dónde está una vez);
2. se escanea y se exporta el STL (o PLY/OBJ) a la carpeta de escaneos;
3. el Rectificador ve el archivo nuevo, espera a que termine de escribirse y propone abrirlo.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from PySide6.QtCore import QFileSystemWatcher, QObject, QTimer, Signal

FORMATOS = (".stl", ".ply", ".obj")


def carpeta_por_defecto() -> Path:
    """Documentos\\Escaneos Rectificador (en Windows la carpeta se llama «Documents» aunque se vea «Documentos»)."""
    documentos = Path.home() / "Documents"
    return (documentos if documentos.exists() else Path.home()) / "Escaneos Rectificador"


def buscar_revo_scan(raices: list[Path] | None = None) -> Path | None:
    """El ejecutable de Revo Scan más reciente que se encuentre en las carpetas de programas."""
    if raices is None:
        raices = [Path(os.environ[v]) for v in ("ProgramFiles", "ProgramFiles(x86)", "ProgramW6432")
                  if os.environ.get(v)]
        if os.environ.get("LOCALAPPDATA"):
            raices.append(Path(os.environ["LOCALAPPDATA"]) / "Programs")
    candidatos = []
    for raiz in raices:
        if not raiz.is_dir():
            continue
        for patron in ("Revo*/Revo*Scan*.exe", "Revo*/*/Revo*Scan*.exe", "Revopoint*/*/Revo*Scan*.exe"):
            try:
                candidatos += [p for p in raiz.glob(patron) if p.is_file()]
            except OSError:
                continue
    if not candidatos:
        return None
    return max(candidatos, key=lambda p: p.stat().st_mtime)


def abrir_revo_scan(exe: Path) -> None:
    subprocess.Popen([str(exe)], cwd=str(exe.parent), close_fds=True)


class Vigilante(QObject):
    """Avisa (`nuevo`) cuando aparece un escaneo nuevo en la carpeta y ya ha terminado de escribirse."""

    nuevo = Signal(str)

    def __init__(self, carpeta: Path, parent=None, intervalo_ms: int = 1000):
        super().__init__(parent)
        self.carpeta = Path(carpeta)
        self.carpeta.mkdir(parents=True, exist_ok=True)
        self._vistos = set(self._escaneos())  # lo que ya estaba no se propone
        self._pendientes: dict[Path, int] = {}
        self._observador = QFileSystemWatcher([str(self.carpeta)], self)
        self._observador.directoryChanged.connect(self._mirar)
        self._reloj = QTimer(self)
        self._reloj.setInterval(intervalo_ms)
        self._reloj.timeout.connect(self._comprobar)

    def _escaneos(self) -> list[Path]:
        try:
            return [p for p in self.carpeta.iterdir() if p.is_file() and p.suffix.lower() in FORMATOS]
        except OSError:
            return []

    def _mirar(self, *_):
        for p in self._escaneos():
            if p not in self._vistos and p not in self._pendientes:
                self._pendientes[p] = -1
        if self._pendientes:
            self._reloj.start()

    def _comprobar(self):
        """Un archivo está listo cuando su tamaño no cambia entre dos miradas."""
        self._mirar()
        for p, antes in list(self._pendientes.items()):
            try:
                ahora = p.stat().st_size
            except OSError:
                del self._pendientes[p]  # se ha borrado o renombrado
                continue
            if ahora > 0 and ahora == antes:
                del self._pendientes[p]
                self._vistos.add(p)
                self.nuevo.emit(str(p))
            else:
                self._pendientes[p] = ahora
        if not self._pendientes:
            self._reloj.stop()
