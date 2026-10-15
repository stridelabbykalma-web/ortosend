"""Visor 3D del molde (PyVista dentro de Qt) y dibujo de referencias encima."""

from __future__ import annotations

import numpy as np
import pyvista as pv
from pyvistaqt import QtInteractor

from ortomolde.campo import Campo
from ortomolde.pies import Pie
from ortomolde.referencias import NOMBRES, ORDEN

COLORES = {"mtt1": "#e4572e", "mtt5": "#2e86de", "talon": "#2ecc71"}
COLOR_EJE = "#f1c40f"
COLOR_METATARSAL = "#ff9f43"
COLOR_ARCO = "#00d2d3"
ELEVACION = 1.0  # las líneas se dibujan un poco por encima de la superficie


def superficie(campo: Campo) -> pv.StructuredGrid:
    X, Y = campo.rejilla.malla()
    malla = pv.StructuredGrid(X, Y, campo.z)
    malla.point_data["Altura (mm)"] = campo.z.ravel(order="F")
    return malla


class Visor(QtInteractor):
    """Visor del molde. Llama a `al_hacer_clic(x, y, z)` con el clic derecho sobre la superficie."""

    def __init__(self, parent=None, al_hacer_clic=None):
        super().__init__(parent)
        self.set_background("#2b2d31", top="#3d4148")
        self.al_hacer_clic = al_hacer_clic
        self.campo: Campo | None = None
        self._actores_pie: dict[str, list[str]] = {}
        self.enable_surface_point_picking(
            callback=self._clic, show_message=False, show_point=False, left_clicking=False,
            clear_on_no_selection=False, pickable_window=False,
        )

    # ---------------------------------------------------------------- molde

    def mostrar_molde(self, campo: Campo, reiniciar_camara: bool = True) -> None:
        self.campo = campo
        self.add_mesh(superficie(campo), name="molde", color="#d8c3a0",  # color espuma
                      smooth_shading=True, pickable=True, specular=0.15, ambient=0.2, diffuse=0.85)
        if reiniciar_camara:
            self.vista_inicial()

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

    def dibujar_pie(self, clave: str, pie: Pie, geom: dict | None) -> None:
        """Referencias marcadas y, si están las 3, el eje, la línea metatarsal y el arco."""
        self.borrar_pie(clave)
        nombres = []

        def poner(nombre, malla, **kw):
            actor = f"{clave}_{nombre}"
            self.add_mesh(malla, name=actor, pickable=False, render=False, **kw)
            nombres.append(actor)

        for k in ORDEN:
            if k in pie.referencias.puntos:
                x, y = pie.referencias.puntos[k]
                z = float(self._z(x, y))
                poner(k, pv.Sphere(radius=3.0, center=(x, y, z + 1.5)), color=COLORES[k])
                actor = f"{clave}_{k}_texto"
                self.add_point_labels([[x, y, z + 6]], [NOMBRES[k]], name=actor, font_size=12,
                                      text_color="white", shape_color=COLORES[k], shape_opacity=0.8,
                                      show_points=False, always_visible=True, render=False)
                nombres.append(actor)
        if geom:
            lineas = dict(line_width=4, render_lines_as_tubes=True)
            poner("eje", self._linea(geom["eje"]), color=COLOR_EJE, **lineas)
            poner("metatarsal", self._linea(geom["linea_metatarsal"]), color=COLOR_METATARSAL, **lineas)
            poner("arco", self._linea(geom["zona_arco"], cerrada=True), color=COLOR_ARCO, **lineas)
            for k in ("talon_medial", "talon_lateral"):
                x, y = geom[k]
                poner(k, pv.Sphere(radius=1.8, center=(x, y, float(self._z(x, y)) + 1.0)), color=COLORES["talon"])
        # Rótulo del lado, más allá de los dedos.
        jj, ii = np.nonzero(pie.mascara)
        r = self.campo.rejilla
        actor = f"{clave}_rotulo"
        self.add_point_labels([[ii.mean() * r.dx, min(jj.max() * r.dy + 10, r.largo - 2), 2]],
                              [f"PIE {pie.lado.upper()}"], name=actor, font_size=18, text_color="white",
                              shape_color="#444444", shape_opacity=0.7, show_points=False,
                              always_visible=True, render=False)
        nombres.append(actor)
        self._actores_pie[clave] = nombres
        self.render()

    # ---------------------------------------------------------------- clics

    def _clic(self, punto, *args):
        if punto is not None and self.al_hacer_clic and self.campo is not None:
            self.al_hacer_clic(float(punto[0]), float(punto[1]), float(punto[2]))
