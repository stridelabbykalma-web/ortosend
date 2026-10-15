"""Estado completo de un molde y recálculo no destructivo.

Estado = escaneo original (nunca se modifica) + parámetros (lados, referencias, piezas...).
El resultado se recalcula siempre desde el original, así que cualquier cambio se puede
deshacer o editar en cualquier orden. La receta JSON guarda todo lo necesario para
regenerar exactamente el mismo resultado.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import trimesh

from . import __version__, config
from .campo import Campo, detectar_fondo, malla_a_campo
from .limpieza import InformeLimpieza, componer, limpiar
from .pies import Pie, detectar_pies
from .referencias import Referencias, geometria
from .suavizado import suavizar

VERSION_RECETA = 1


def huella(ruta: str | Path) -> str:
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


@dataclass
class Proyecto:
    ruta_stl: Path
    original: Campo
    fondo: float
    taller: dict = field(default_factory=config.taller)
    clinicos: dict = field(default_factory=config.valores_clinicos)
    huella_stl: str = ""
    tipo: str = "limpio"  # "bruto" (escaneo del Revopoint) o "limpio" (recuadro ya preparado)
    informe: InformeLimpieza | None = None  # solo si tipo == "bruto"
    pies: list[Pie] = field(default_factory=list)
    suavizado: float = 3.0  # mm (ver ortomolde/suavizado.py)

    @classmethod
    def abrir(cls, ruta_stl: str | Path, taller: dict | None = None, tipo: str = "auto",
              lados: dict[int, str] | None = None, clinicos: dict | None = None) -> "Proyecto":
        """Abre un escaneo en bruto (lo limpia) o un recuadro ya limpio.

        tipo = "auto" decide solo: si la malla es cerrada y mide lo que el recuadro, es un
        molde limpio; si no, se trata como escaneo en bruto.
        """
        taller = taller or config.taller()
        clinicos = clinicos or config.valores_clinicos()
        ruta = Path(ruta_stl)
        malla = trimesh.load(ruta, force="mesh")
        rec = taller["recuadro"]
        if tipo == "auto":
            tam = malla.bounds[1] - malla.bounds[0]
            encaja = abs(tam[0] - rec["ancho_x"]) < 2 and abs(tam[1] - rec["largo_y"]) < 2
            tipo = "limpio" if (malla.is_watertight and encaja) else "bruto"
        if tipo == "bruto":
            campo, informe = limpiar(malla, taller, lados)
            fondo = taller["limpieza"]["base"]
        else:
            campo = malla_a_campo(malla, taller["calculo"]["rejilla"], (rec["ancho_x"], rec["largo_y"]))
            informe, fondo = None, detectar_fondo(campo.z)
        p = cls(ruta, campo, fondo, taller, clinicos, huella(ruta), tipo, informe,
                suavizado=taller.get("suavizado", {}).get("radio", 3.0))
        p.pies = detectar_pies(campo, fondo, taller["limpieza"]["pie_izquierdo_en"])
        return p

    # ------------------------------------------------------------------ estado

    @property
    def avisos(self) -> list[str]:
        return list(self.informe.avisos) if self.informe else []

    def pie(self, lado: str) -> Pie | None:
        return next((p for p in self.pies if p.lado == lado), None)

    def pie_en(self, x: float, y: float) -> Pie | None:
        """El pie que hay bajo el punto (x, y), si hay alguno."""
        return next((p for p in self.pies if p.contiene(self.original, x, y)), None)

    def intercambiar_lados(self) -> None:
        """Cambia izquierdo <-> derecho.

        Si el molde viene de la limpieza, cada pie pasa a la otra mitad del recuadro y sus
        referencias se mueven con él. Si es un recuadro ya limpio, solo cambian los nombres.
        """
        otro = {"izquierdo": "derecho", "derecho": "izquierdo"}
        if self.informe is None:
            for p in self.pies:
                p.lado = otro[p.lado]
            return
        antes = {p.lado: (p, _esquina(p.mascara, self.original)) for p in self.pies}
        for b in self.informe.bloques:
            b.lado = otro[b.lado]
        self.original = componer(self.informe, self.taller)
        self.pies = detectar_pies(self.original, self.fondo, self.taller["limpieza"]["pie_izquierdo_en"])
        for p in self.pies:
            viejo, esquina_vieja = antes.get(otro[p.lado], (None, None))
            if viejo is None:
                continue
            dx, dy = _esquina(p.mascara, self.original) - esquina_vieja
            p.referencias = Referencias({k: (x + dx, y + dy) for k, (x, y) in viejo.referencias.puntos.items()})

    def poner_referencia(self, x: float, y: float, nombre: str | None = None) -> tuple[Pie, str] | None:
        """Marca una referencia en el pie que hay bajo (x, y).

        Sin `nombre`, marca la siguiente que falte (1.er MTT, 5.º MTT, talón) o, si ya
        están todas, mueve la más cercana. Devuelve (pie, nombre) o None si no hay pie ahí.
        """
        pie = self.pie_en(x, y)
        if pie is None:
            return None
        refs = pie.referencias
        if nombre is None:
            nombre = refs.siguiente()
        if nombre is None:  # todas marcadas: mover la más cercana
            nombre = min(refs.puntos, key=lambda k: np.hypot(refs.puntos[k][0] - x, refs.puntos[k][1] - y))
        refs.puntos[nombre] = (float(x), float(y))
        return pie, nombre

    def geometria(self, pie: Pie) -> dict | None:
        if not pie.referencias.completas:
            return None
        r = self.original.rejilla
        return geometria(pie.referencias, pie.mascara, r.dx, r.dy, self.clinicos["referencias"])

    # ------------------------------------------------------------------ resultado

    def mascara_pies(self) -> np.ndarray:
        m = np.zeros(self.original.z.shape, bool)
        for p in self.pies:
            m |= p.mascara
        return m

    def calcular(self) -> Campo:
        """Resultado = original suavizado + correcciones (de momento ninguna), dentro del bloque.

        Siempre se parte del escaneo original: nada se acumula ni se pierde.
        """
        z = suavizar(self.original.z, self.fondo, self.mascara_pies(), self.original.rejilla.dx, self.suavizado)
        z = np.clip(z, 0.0, self.taller["recuadro"]["alto_z"])
        return self.original.copia(z)

    def altura_en(self, x: float, y: float) -> float:
        r = self.original.rejilla
        i = int(np.clip(round(x / r.dx), 0, r.nx - 1))
        j = int(np.clip(round(y / r.dy), 0, r.ny - 1))
        return float(self.original.z[j, i])

    def a_taller(self, x: float, y: float, z: float) -> tuple[float, float, float]:
        """Coordenadas de taller: X0 Y0 esquina delantera-izquierda, Z0 cara superior del bloque."""
        return x, y, z - self.taller["recuadro"]["alto_z"]

    def receta(self) -> dict:
        pies = []
        for p in self.pies:
            d = {"lado": p.lado, "referencias": p.referencias.a_dict()}
            d["referencias_taller"] = {
                k: [round(c, 3) for c in self.a_taller(x, y, self.altura_en(x, y))]
                for k, (x, y) in p.referencias.puntos.items()
            }
            pies.append(d)
        return {
            "programa": "Rectificador de moldes Ortosend",
            "version_programa": __version__,
            "version_receta": VERSION_RECETA,
            "escaneo": {"archivo": self.ruta_stl.name, "sha256": self.huella_stl, "tipo": self.tipo},
            "limpieza": self.informe.a_dict() if self.informe else None,
            "rejilla": self.original.rejilla.a_dict(),
            "desplazamiento_stl": [float(v) for v in self.original.desplazamiento],
            "fondo_mm": self.fondo,
            "suavizado_mm": self.suavizado,
            "pies": pies,
            "taller": self.taller,
            "valores_clinicos": self.clinicos,
        }


def _esquina(mascara: np.ndarray, campo: Campo) -> np.ndarray:
    jj, ii = np.nonzero(mascara)
    return np.array([ii.min() * campo.rejilla.dx, jj.min() * campo.rejilla.dy])
