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
from .entrada import cargar_malla
from .limpieza import InformeLimpieza, componer, limpiar
from .pies import Pie, detectar_pies
from . import piezas as piezas_mod
from . import recorte as recorte_mod
from .recorte import Recorte
from .referencias import Referencias, geometria, proponer
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
    lijado: float = 6.0  # mm, tamaño del taco de lija (ver ortomolde/suavizado.py)
    paciente: dict = field(default_factory=dict)  # nombre, fecha, notas
    bajada: float = 0.0  # mm quitados por abajo en el último cálculo para que quepa en el bloque
    _cache_lijado: tuple | None = field(default=None, repr=False)

    @property
    def fondo_molde(self) -> float:
        """La base del molde calculado (más baja si se ha tenido que bajar para que quepa)."""
        return max(self.fondo - self.bajada, 0.0)

    @classmethod
    def abrir(cls, ruta_stl: str | Path, taller: dict | None = None, tipo: str = "auto",
              lados: dict[int, str] | None = None, clinicos: dict | None = None,
              modo: str = "huellas") -> "Proyecto":
        """Abre un escaneo en bruto (lo limpia) o un recuadro ya limpio.

        Acepta STL, PLY, OBJ, el proyecto de Revo Scan (.revox) o un ZIP con cualquiera de ellos.
        `modo`: "huellas" (huella hundida en espuma) o "moldes" (molde ya hecho, pie en bulto).

        tipo = "auto" decide solo: si la malla es cerrada y mide lo que el recuadro, es un
        molde limpio; si no, se trata como escaneo en bruto.
        """
        taller = taller or config.taller()
        clinicos = clinicos or config.valores_clinicos()
        from . import referencias as _ref
        _ref.EJE_SIN_2_3 = clinicos.get("referencias", {}).get("eje_sin_2_3", _ref.EJE_SIN_2_3)
        ruta = Path(ruta_stl)
        malla = cargar_malla(ruta)
        rec = taller["recuadro"]
        if tipo == "auto":
            tam = malla.bounds[1] - malla.bounds[0]
            encaja = abs(tam[0] - rec["ancho_x"]) < 2 and abs(tam[1] - rec["largo_y"]) < 2
            tipo = "limpio" if (malla.is_watertight and encaja) else "bruto"
        if tipo == "bruto":
            campo, informe = limpiar(malla, taller, lados, modo=modo)
            fondo = taller["limpieza"]["base"]
        else:
            campo = malla_a_campo(malla, taller["calculo"]["rejilla"], (rec["ancho_x"], rec["largo_y"]))
            informe, fondo = None, detectar_fondo(campo.z)
        p = cls(ruta, campo, fondo, taller, clinicos, huella(ruta), tipo, informe,
                lijado=taller.get("lijado", {}).get("taco", 6.0))
        p.pies = detectar_pies(campo, fondo, taller["limpieza"]["pie_izquierdo_en"])
        for pie in p.pies:
            pie.recorte = Recorte.por_defecto(clinicos)
            pie.piezas = piezas_mod.por_defecto(clinicos)
        return p

    # ------------------------------------------------------------------ estado

    @property
    def avisos(self) -> list[str]:
        avisos = list(self.informe.avisos) if self.informe else []
        if self.bajada > 0.1:
            avisos.append(f"El molde pasa de {self.taller['recuadro']['alto_z']:.0f} mm de alto: se le quitan "
                          f"{self.bajada:.1f} mm por abajo (la planta queda igual).")
        return avisos

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
            p.recorte = viejo.recorte
            p.piezas = viejo.piezas

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

    def proponer_referencias(self, pie: Pie) -> None:
        """Coloca referencias aproximadas (proporciones típicas del pie) para corregir luego."""
        r = self.original.rejilla
        pie.referencias = proponer(pie.mascara, pie.lado, r.dx, r.dy, self.clinicos["referencias"],
                                   self.molde_lijado())

    def linea_recorte(self, pie: Pie) -> list | None:
        if not (pie.recorte.activo and pie.referencias.completas):
            return None
        r = self.original.rejilla
        # Se dibuja 1 mm por detrás del corte, sobre el molde que queda.
        return recorte_mod.linea_del_arco(pie.referencias, pie.recorte, pie.mascara, r.dx, r.dy, atras=1.0)

    def geometria(self, pie: Pie) -> dict | None:
        if not pie.referencias.completas:
            return None
        r = self.original.rejilla
        return geometria(pie.referencias, pie.mascara, r.dx, r.dy, self.clinicos["referencias"])

    # ------------------------------------------------------------------ resultado

    def medidas(self, pie: Pie) -> dict:
        """Medidas del pie en mm (sobre el molde sin recortar), para comprobar la escala.

        Largo = talón -> punta medido a lo largo del eje del pie (el de las referencias si están;
        si no, la dirección más larga de la huella). Anchos medidos en perpendicular al eje.
        """
        r = self.original.rejilla
        z = self.molde_lijado()
        huella = pie.mascara & (z - self.fondo > 1.5)  # contorno de la huella (sin el margen)
        jj, ii = np.nonzero(huella)
        pts = np.column_stack([ii * r.dx, jj * r.dy])
        sis = None
        if pie.referencias.completas:
            try:
                sis = pie.referencias.sistema()
            except ValueError:
                sis = None
        if sis is not None:
            eje, perp, origen = sis.eje, sis.medial, sis.origen
        else:
            origen = pts.mean(axis=0)
            _, _, vt = np.linalg.svd(pts - origen, full_matrices=False)
            eje = vt[0] if vt[0][1] > 0 else -vt[0]
            perp = np.array([-eje[1], eje[0]])
        u = (pts - origen) @ eje
        v = (pts - origen) @ perp
        largo = float(u.max() - u.min())

        def ancho_en(u0, banda=1.0):
            sel = np.abs(u - u0) <= banda
            return float(v[sel].max() - v[sel].min()) if sel.any() else 0.0

        franjas = np.arange(u.min(), u.max(), 2.0)
        anchos = [ancho_en(f) for f in franjas]
        m = {
            "largo": largo,
            "ancho_maximo": float(max(anchos)) if anchos else 0.0,
            "altura_maxima": float((z[huella] - self.fondo).max()) if huella.any() else 0.0,
        }
        refs = pie.referencias.puntos
        if sis is not None:
            m["ancho_talon"] = ancho_en(0.0)
            m1, m5 = np.array(refs["mtt1"]), np.array(refs["mtt5"])
            m["ancho_cabezas"] = ancho_en(float(((m1 + m5) / 2 - origen) @ eje))
            m["talon_mtt1"] = float(np.linalg.norm(m1 - origen))
            m["talon_mtt5"] = float(np.linalg.norm(m5 - origen))
            m["mtt1_mtt5"] = float(np.linalg.norm(m5 - m1))
        return m

    def mascara_pies(self) -> np.ndarray:
        m = np.zeros(self.original.z.shape, bool)
        for p in self.pies:
            m |= p.mascara
        return m

    def molde_lijado(self) -> np.ndarray:
        """Escaneo original lijado (se guarda en memoria: solo se recalcula si cambia algo)."""
        m = self.mascara_pies()
        clave = (self.lijado, id(self.original), m.tobytes().__hash__())
        if self._cache_lijado is None or self._cache_lijado[0] != clave:
            z = suavizar(self.original.z, self.fondo, m, self.original.rejilla.dx, self.lijado)
            self._cache_lijado = (clave, z)
        return self._cache_lijado[1]

    def calcular(self) -> Campo:
        """Resultado = original lijado + correcciones + recorte en arco, dentro del bloque.

        Siempre se parte del escaneo original: nada se acumula ni se pierde.
        """
        z = self.molde_lijado().copy()
        r = self.original.rejilla
        X, Y = r.malla()
        borde = self.clinicos.get("general", {}).get("suavizado_borde", 8.0)
        for pie in self.pies:
            if pie.piezas:
                z = piezas_mod.aplicar(z, self.fondo, pie.referencias, pie.piezas, pie.mascara, X, Y, r.dx, r.dy,
                                       self.clinicos["referencias"], borde)
        for pie in self.pies:
            z = recorte_mod.aplicar(z, self.fondo, pie.referencias, pie.recorte, pie.mascara, X, Y,
                                    self.original.rejilla.dx)
        # Si no cabe en el alto del bloque, se baja entero: lo que sobra se quita por abajo, nunca de la planta.
        alto = self.taller["recuadro"]["alto_z"]
        self.bajada = float(max(z.max() - alto, 0.0))
        z = np.clip(z - self.bajada, 0.0, alto)
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
            d = {"lado": p.lado, "referencias": p.referencias.a_dict(), "recorte_arco": p.recorte.a_dict(),
                 "piezas": {k: v.a_dict() for k, v in p.piezas.items()}}
            d["referencias_taller"] = {
                k: [round(c, 3) for c in self.a_taller(x, y, self.altura_en(x, y))]
                for k, (x, y) in p.referencias.puntos.items()
            }
            pies.append(d)
        return {
            "programa": "Rectificador de moldes Ortosend",
            "paciente": self.paciente,
            "version_programa": __version__,
            "version_receta": VERSION_RECETA,
            "escaneo": {"archivo": self.ruta_stl.name, "sha256": self.huella_stl, "tipo": self.tipo},
            "limpieza": self.informe.a_dict() if self.informe else None,
            "rejilla": self.original.rejilla.a_dict(),
            "desplazamiento_stl": [float(v) for v in self.original.desplazamiento],
            "fondo_mm": self.fondo,
            "lijado_mm": self.lijado,
            "pies": pies,
            "taller": self.taller,
            "valores_clinicos": self.clinicos,
        }


def _esquina(mascara: np.ndarray, campo: Campo) -> np.ndarray:
    jj, ii = np.nonzero(mascara)
    return np.array([ii.min() * campo.rejilla.dx, jj.min() * campo.rejilla.dy])
