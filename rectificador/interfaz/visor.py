"""Visor 3D del molde (PyVista dentro de Qt) y dibujo de referencias encima."""

from __future__ import annotations

from contextlib import contextmanager

import numpy as np
import pyvista as pv
import vtk
from PySide6.QtCore import Qt
from pyvistaqt import QtInteractor

from ortomolde.campo import Campo
from ortomolde.pies import Pie
from ortomolde.referencias import NOMBRES, ORDEN

COLORES = {"mtt1": "#e4572e", "mtt2": "#f39c12", "mtt3": "#d4ac0d", "mtt4": "#8e44ad",
           "mtt5": "#2e86de", "talon": "#2ecc71"}
COLOR_EJE = "#f1c40f"
COLOR_METATARSAL = "#ff9f43"
COLOR_ARCO = "#00d2d3"
COLOR_RECORTE = "#ff3b30"
ELEVACION = 1.0  # las líneas se dibujan un poco por encima de la superficie
RADIO_AGARRE = 15  # píxeles: a esta distancia de un punto se puede coger con el ratón


def superficie(campo: Campo) -> pv.StructuredGrid:
    X, Y = campo.rejilla.malla()
    malla = pv.StructuredGrid(X, Y, campo.z)
    malla.point_data["Altura (mm)"] = campo.z.ravel(order="F")
    return malla


def normales(campo: Campo) -> np.ndarray:
    """Normales de la superficie z(x, y) (para el sombreado suave), en el orden de los puntos de la malla.

    Van hacia abajo, en el mismo sentido que el orden de los triángulos de la malla (así las ilumina VTK
    igual que con sus propias normales)."""
    r = campo.rejilla
    gy, gx = np.gradient(campo.z, r.dy, r.dx)
    n = np.dstack([gx, gy, -np.ones_like(campo.z)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return np.column_stack([n[..., k].ravel(order="F") for k in range(3)])


class Visor(QtInteractor):
    """Visor del molde.

    - Clic derecho sobre la superficie -> `al_hacer_clic(x, y, z)`.
    - Botón izquierdo sobre un punto de referencia y arrastrar -> el punto se mueve pegado al
      molde: `al_arrastrar(clave, nombre, x, y)` mientras se mueve y `al_soltar(...)` al soltar.
      Lejos de los puntos, el botón izquierdo gira la vista como siempre.
    """

    def __init__(self, parent=None, al_hacer_clic=None, al_arrastrar=None, al_soltar=None, al_pasar=None):
        # Sin redibujo automático (por defecto pyvistaqt redibuja 5 veces por segundo aunque no cambie
        # nada, y eso hace que todo el programa vaya a tirones): se redibuja solo cuando algo cambia.
        super().__init__(parent, auto_update=False)
        from interfaz.estilo import C
        self.set_background(C["visor_abajo"], top=C["visor_arriba"])
        self.al_hacer_clic = al_hacer_clic
        self.al_pasar = al_pasar  # (x, y, z) del molde bajo el ratón, o None
        self.reglas = True
        self.al_arrastrar = al_arrastrar
        self.al_soltar = al_soltar
        self.campo: Campo | None = None
        self._actores_pie: dict[str, list[str]] = {}
        # (clave del pie, nombre) -> (x, y, z) de cada punto que se puede coger con el ratón.
        self.puntos_arrastrables: dict[tuple[str, str], tuple[float, float, float]] = {}
        self._arrastrando: tuple[str, str] | None = None
        self._ultimo_xy: tuple[float, float] | None = None
        self._picker = vtk.vtkCellPicker()
        self._picker.SetTolerance(0.0005)
        self._picker.PickFromListOn()
        self._malla: pv.StructuredGrid | None = None  # superficie del molde (se actualiza sin rehacerla)
        self._limites_reglas = None
        self._lote = 0  # >0: los render() se juntan en uno solo al final
        self._centros: dict[tuple[str, str], tuple[float, float, float]] = {}  # dónde se creó cada bola
        self._render_pendiente = False
        self.enable_surface_point_picking(
            callback=self._clic, show_message=False, show_point=False, left_clicking=False,
            clear_on_no_selection=False, pickable_window=False,
        )
        # Los observadores van en el propio interactor con prioridad alta: cuando cogemos un
        # punto se corta el evento y la cámara no gira.
        iren = self.iren.interactor
        self._tags = {}
        for evento, funcion in (("LeftButtonPressEvent", self._pulsar), ("MouseMoveEvent", self._mover),
                                ("LeftButtonReleaseEvent", self._soltar)):
            self._tags[evento] = iren.AddObserver(evento, funcion, 10.0)

    # ---------------------------------------------------------------- molde

    # ---------------------------------------------------------------- redibujo

    def render(self, *args, **kwargs):
        if getattr(self, "_lote", 0):  # (al crear el visor aún no existe)
            self._render_pendiente = True
            return None
        if getattr(self, "_rendered", False) and self.isVisible():
            # Ya se ha dibujado alguna vez: basta con pedir a Qt que repinte (una sola vez, en el
            # siguiente fotograma). Dibujar aquí además haría el trabajo dos veces.
            self.update()
            return None
        return super().render(*args, **kwargs)

    @contextmanager
    def lote(self):
        """Junta todos los redibujos de dentro en uno solo al final (mucho más rápido)."""
        self._lote += 1
        try:
            yield
        finally:
            self._lote -= 1
            if self._lote == 0 and self._render_pendiente:
                self._render_pendiente = False
                self.render()

    # ---------------------------------------------------------------- molde

    # Cómo se pinta el molde según lo que se quiera ver: (nombre del dato, colores, límites).
    PINTURAS = {
        # mm de escayola que la fresa no puede quitar: color espuma (0) a rojo (2 mm o más).
        "no_llega": ("No llega (mm)", ["#d8c3a0", "#ffa94d", "#e03131"], (0, 2)),
        # mm que cambian las correcciones: azul = se quita escayola (bulto en la plantilla),
        # rojo = se añade (hueco en la plantilla); espuma = sin cambio.
        "correcciones": ("Corrección (mm)", ["#1c7ed6", "#74c0fc", "#d8c3a0", "#ff8787", "#e03131"], (-4, 4)),
    }

    def mostrar_molde(self, campo: Campo, reiniciar_camara: bool = True, colores: np.ndarray | None = None,
                      pintura: str = "no_llega") -> None:
        """Muestra el molde. Si solo han cambiado las alturas, se actualiza la superficie que ya hay
        (sin rehacerla): así cada cambio se ve casi al momento.

        `colores`: un valor por punto que se pinta según `pintura` (ver PINTURAS)."""
        coloreado = pintura if colores is not None else False
        mismo = (self._malla is not None and self.campo is not None and not reiniciar_camara
                 and self.campo.z.shape == campo.z.shape and self.campo.rejilla.dx == campo.rejilla.dx
                 and coloreado == getattr(self, "_coloreado", False))
        self._coloreado = coloreado
        self.campo = campo
        if mismo:
            puntos = np.array(self._malla.points)
            puntos[:, 2] = campo.z.ravel(order="F")
            self._malla.points = puntos
            self._malla.point_data["Normals"] = normales(campo)
            self._malla.point_data.active_normals_name = "Normals"
            if coloreado:
                self._malla.point_data[self.PINTURAS[pintura][0]] = colores.ravel(order="F")
            self._malla.Modified()
            self._localizador.ForceBuildLocator()  # las alturas han cambiado
        else:
            malla = superficie(campo)
            malla.point_data["Normals"] = normales(campo)
            malla.point_data.active_normals_name = "Normals"
            self._malla = malla
            if coloreado:
                from matplotlib.colors import LinearSegmentedColormap

                dato, tonos, limites = self.PINTURAS[pintura]
                malla.point_data[dato] = colores.ravel(order="F")
                mapa = LinearSegmentedColormap.from_list(pintura, tonos)
                actor = self.add_mesh(malla, name="molde", scalars=dato, cmap=mapa, clim=limites,
                                      show_scalar_bar=False, pickable=True, specular=0.15, ambient=0.2,
                                      diffuse=0.85, render=False)
            else:
                actor = self.add_mesh(malla, name="molde", color="#d8c3a0",  # color espuma
                                      pickable=True, specular=0.15, ambient=0.2, diffuse=0.85, render=False)
            actor.GetProperty().SetInterpolationToPhong()
            self._picker.InitializePickList()
            self._picker.AddPickList(actor)
            # Buscador rápido de celdas: saber qué punto del molde hay bajo el ratón sin recorrerlo entero.
            localizador = vtk.vtkStaticCellLocator()
            localizador.SetDataSet(malla)
            localizador.BuildLocator()
            self._picker.RemoveAllLocators()
            self._picker.AddLocator(localizador)
            self._localizador = localizador
        limites = (campo.rejilla.ancho, campo.rejilla.largo, round(float(campo.z.max())))
        if limites != self._limites_reglas:
            self.mostrar_reglas(self.reglas)
        if reiniciar_camara:
            self.vista_inicial()
        self.render()

    def mostrar_reglas(self, mostrar: bool) -> None:
        """Reglas en mm alrededor del recuadro (X, Y y altura)."""
        self.reglas = mostrar
        self.remove_bounds_axes()
        self._limites_reglas = None
        if mostrar and self.campo is not None:
            r = self.campo.rejilla
            self.show_grid(bounds=(0, r.ancho, 0, r.largo, 0, float(max(self.campo.z.max(), 1.0))),
                           xtitle="X (mm)", ytitle="Y (mm)", ztitle="Altura (mm)", fmt="%.0f",
                           n_xlabels=7, n_ylabels=8, n_zlabels=4, font_size=10, color="#bfc3c9",
                           location="outer", ticks="outside", minor_ticks=True)
            self._limites_reglas = (r.ancho, r.largo, round(float(self.campo.z.max())))
        self.render()

    def dibujar_medida(self, a, b) -> None:
        """Línea entre dos puntos del molde con su distancia en mm."""
        a, b = np.asarray(a, float), np.asarray(b, float)
        # La línea va pegada a la superficie del molde (se ve entera aunque haya relieve).
        self.add_mesh(self._linea([a[:2], b[:2]]), name="medida_linea", color="white",
                      line_width=4, render_lines_as_tubes=True, pickable=False, render=False)
        self.add_mesh(pv.PolyData(np.vstack([a, b]) + [0, 0, 1.5]), name="medida_puntos", color="white",
                      point_size=12, render_points_as_spheres=True, pickable=False, render=False)
        d3 = float(np.linalg.norm(b - a))
        dp = float(np.linalg.norm((b - a)[:2]))
        medio = (a + b) / 2
        medio[2] = float(self._z(medio[0], medio[1])) + 8
        self.add_point_labels([medio], [f"{dp:.1f} mm"], name="medida_texto",
                              font_size=16, text_color="black", shape_color="white", shape_opacity=0.9,
                              show_points=False, always_visible=True, render=False)
        self.render()
        return dp, d3

    def borrar_medida(self) -> None:
        for n in ("medida_linea", "medida_puntos", "medida_texto"):
            self.remove_actor(n, render=False)
        self.render()

    def vista_inicial(self) -> None:
        r = self.campo.rejilla
        centro = (r.ancho / 2, r.largo / 2, 0.0)
        self.camera_position = [(r.ancho / 2, -0.75 * r.largo, 1.6 * r.largo), centro, (0, 0, 1)]
        self.reset_camera_clipping_range()

    def vista_planta(self) -> None:
        self.view_xy()

    # ---------------------------------------------------------------- dibujo

    def _z(self, x, y):
        r = self.campo.rejilla
        i = np.clip(np.round(np.asarray(x) / r.dx).astype(int), 0, r.nx - 1)
        j = np.clip(np.round(np.asarray(y) / r.dy).astype(int), 0, r.ny - 1)
        return self.campo.z[j, i]

    def _linea(self, puntos_xy, cerrada=False) -> pv.PolyData:
        """Línea apoyada sobre la superficie, muestreada cada ~1 mm."""
        p = np.asarray(puntos_xy, float)
        if cerrada:
            p = np.vstack([p, p[:1]])
        trozos = []
        for a, b in zip(p[:-1], p[1:]):
            n = max(2, int(np.linalg.norm(b - a)))
            trozos.append(np.linspace(a, b, n, endpoint=False))
        trozos.append(p[-1:])
        q = np.vstack(trozos)
        pts = np.column_stack([q, self._z(q[:, 0], q[:, 1]) + ELEVACION])
        return pv.MultipleLines(pts)

    def borrar_pie(self, clave: str) -> None:
        for nombre in self._actores_pie.pop(clave, []):
            self.remove_actor(nombre, render=False)
        for k in [k for k in self.puntos_arrastrables if k[0] == clave]:
            del self.puntos_arrastrables[k]

    def dibujar_pie(self, clave: str, pie: Pie, geom: dict | None, recorte: list | None = None,
                    piezas: list | None = None, nombres_visibles: bool = True) -> None:
        """Referencias marcadas y, si están las 3, el eje, la línea metatarsal y el arco. `piezas`: lista de
        (tipo, color, contorno, centro) de las correcciones activas: su contorno y una bola para moverlas."""
        with self.lote():
            self.borrar_pie(clave)
            nombres = []
            for tipo, color, contorno, centro in piezas or []:
                if contorno:
                    actor = f"{clave}_pieza_{tipo}_contorno"
                    self.add_mesh(self._linea(contorno, cerrada=True), name=actor, color=color, line_width=3,
                                  pickable=False, render=False)
                    nombres.append(actor)
                if centro:
                    x, y = centro
                    z = float(self._z(x, y)) + 2.0
                    k = f"pieza:{tipo}"
                    self.puntos_arrastrables[(clave, k)] = (x, y, z)
                    self._centros[(clave, k)] = (x, y, z)
                    actor = f"{clave}_{k}"
                    self.add_mesh(pv.Cube(center=(x, y, z), x_length=4.5, y_length=4.5, z_length=4.5), name=actor,
                                  color=color, pickable=False, render=False)
                    nombres.append(actor)
            for k in ORDEN:
                if k in pie.referencias.puntos:
                    x, y = pie.referencias.puntos[k]
                    z = float(self._z(x, y))
                    self.puntos_arrastrables[(clave, k)] = (x, y, z + 1.5)
                    self._centros[(clave, k)] = (x, y, z + 1.5)
                    grande = k in ("mtt1", "mtt5", "talon")
                    actor = f"{clave}_{k}"
                    self.add_mesh(pv.Sphere(radius=3.0 if grande else 2.3, center=(x, y, z + 1.5)), name=actor,
                                  color=COLORES[k], pickable=False, render=False)
                    nombres.append(actor)
                    if not nombres_visibles:
                        continue
                    actor = f"{clave}_{k}_texto"
                    texto = NOMBRES[k] if grande else k[-1] + ".º"
                    self.add_point_labels([[x, y, z + 6]], [texto], name=actor, font_size=12 if grande else 10,
                                          text_color="white", shape_color=COLORES[k], shape_opacity=0.8,
                                          show_points=False, always_visible=True, render=False)
                    nombres.append(actor)
            self._poner_lineas(clave, geom, recorte, nombres)
            # Rótulo del lado, más allá de los dedos.
            if not nombres_visibles:
                self._actores_pie[clave] = nombres
                self.render()
                return
            jj, ii = np.nonzero(pie.mascara)
            r = self.campo.rejilla
            actor = f"{clave}_rotulo"
            self.add_point_labels([[ii.mean() * r.dx, min(jj.max() * r.dy + 10, r.largo - 2), 2]],
                                  [f"PIE {pie.lado.upper()}"], name=actor, font_size=18, text_color="white",
                                  shape_color="#25272b", shape_opacity=0.8, show_points=False,
                                  always_visible=True, render=False)
            nombres.append(actor)
            self._actores_pie[clave] = nombres
            self.render()

    LINEAS = ("eje", "metatarsal", "arco", "talon_medial", "talon_lateral", "recorte")

    def _poner_lineas(self, clave: str, geom: dict | None, recorte: list | None, nombres: list) -> None:
        def poner(nombre, malla, **kw):
            actor = f"{clave}_{nombre}"
            self.add_mesh(malla, name=actor, pickable=False, render=False, **kw)
            nombres.append(actor)

        if geom:
            lineas = dict(line_width=4, render_lines_as_tubes=True)
            poner("eje", self._linea(geom["eje"]), color=COLOR_EJE, **lineas)
            poner("metatarsal", self._linea(geom["linea_metatarsal"]), color=COLOR_METATARSAL, **lineas)
            if geom.get("zona_arco"):
                poner("arco", self._linea(geom["zona_arco"], cerrada=True), color=COLOR_ARCO, **lineas)
            for k in ("talon_medial", "talon_lateral"):
                x, y = geom[k]
                poner(k, pv.Sphere(radius=1.8, center=(x, y, float(self._z(x, y)) + 1.0)), color=COLORES["talon"])
        if recorte and len(recorte) > 1:
            poner("recorte", self._linea(recorte), color=COLOR_RECORTE, line_width=5, render_lines_as_tubes=True)

    def dibujar_contorno_pieza(self, clave: str, tipo: str, color: str, contorno: list | None) -> None:
        """Solo el contorno de una pieza (mientras se arrastra)."""
        actor = f"{clave}_pieza_{tipo}_contorno"
        self.remove_actor(actor, render=False)
        if contorno:
            self.add_mesh(self._linea(contorno, cerrada=True), name=actor, color=color, line_width=3,
                          pickable=False, render=False)
            nombres = self._actores_pie.setdefault(clave, [])
            if actor not in nombres:
                nombres.append(actor)
        self.render()

    def dibujar_lineas(self, clave: str, geom: dict | None, recorte: list | None) -> None:
        """Solo el eje, la línea metatarsal, el arco y el recorte (mientras se arrastra un punto)."""
        with self.lote():
            nombres = self._actores_pie.setdefault(clave, [])
            for n in self.LINEAS:
                actor = f"{clave}_{n}"
                self.remove_actor(actor, render=False)
                if actor in nombres:
                    nombres.remove(actor)
            self._poner_lineas(clave, geom, recorte, nombres)
            self.render()

    def mover_punto(self, clave: str, nombre: str, x: float, y: float) -> None:
        """Mueve la bola de una referencia (o de una pieza) sin rehacerla (su rótulo se oculta hasta soltarla)."""
        centro = self._centros.get((clave, nombre))
        bola = self.renderer.actors.get(f"{clave}_{nombre}")
        if centro is None or bola is None:
            return
        z = float(self._z(x, y)) + (2.0 if nombre.startswith("pieza:") else 1.5)
        bola.SetPosition(x - centro[0], y - centro[1], z - centro[2])
        rotulo = self.renderer.actors.get(f"{clave}_{nombre}_texto")
        if rotulo is not None:
            rotulo.SetVisibility(False)
        self.puntos_arrastrables[(clave, nombre)] = (x, y, z)

    # ---------------------------------------------------------------- arrastrar puntos

    def a_pantalla(self, x: float, y: float, z: float) -> tuple[float, float]:
        ren = self.renderer
        ren.SetWorldPoint(x, y, z, 1.0)
        ren.WorldToDisplay()
        px, py, _ = ren.GetDisplayPoint()
        return px, py

    def punto_bajo(self, px: float, py: float) -> tuple[str, str] | None:
        """El punto de referencia más cercano a la posición de pantalla, si está a mano."""
        mejor, dist = None, RADIO_AGARRE
        for clave, (x, y, z) in self.puntos_arrastrables.items():
            sx, sy = self.a_pantalla(x, y, z)
            d = float(np.hypot(sx - px, sy - py))
            if d <= dist:
                mejor, dist = clave, d
        return mejor

    def superficie_en(self, px: float, py: float) -> tuple[float, float, float] | None:
        """Punto del molde bajo la posición de pantalla."""
        if self.campo is None or not self._picker.Pick(px, py, 0, self.renderer):
            return None
        return tuple(self._picker.GetPickPosition())

    def _cortar(self, evento: str) -> None:
        self.iren.interactor.GetCommand(self._tags[evento]).SetAbortFlag(1)

    def _pulsar(self, iren, evento):
        px, py = iren.GetEventPosition()
        cogido = self.punto_bajo(px, py)
        if cogido is None:
            return  # sigue el giro normal de la cámara
        self._arrastrando = cogido
        self._ultimo_xy = None
        self.setCursor(Qt.ClosedHandCursor)
        self._cortar(evento)

    def _mover(self, iren, evento):
        px, py = iren.GetEventPosition()
        if self._arrastrando is None:
            # Solo cambia el cursor si pasa por encima de un punto.
            if self.punto_bajo(px, py) is not None:
                self.setCursor(Qt.OpenHandCursor)
            else:
                self.unsetCursor()
            if self.al_pasar:
                self.al_pasar(self.superficie_en(px, py))
            return
        self._cortar(evento)
        p = self.superficie_en(px, py)
        if p is None:
            return
        self._ultimo_xy = (p[0], p[1])
        if self.al_arrastrar:
            self.al_arrastrar(self._arrastrando[0], self._arrastrando[1], p[0], p[1])

    def _soltar(self, iren, evento):
        if self._arrastrando is None:
            return
        self._cortar(evento)
        clave, nombre = self._arrastrando
        self._arrastrando = None
        self.unsetCursor()
        if self._ultimo_xy is not None and self.al_soltar:
            self.al_soltar(clave, nombre, *self._ultimo_xy)

    # ---------------------------------------------------------------- clics

    def _clic(self, punto, *args):
        if punto is not None and self.al_hacer_clic and self.campo is not None:
            self.al_hacer_clic(float(punto[0]), float(punto[1]), float(punto[2]))
