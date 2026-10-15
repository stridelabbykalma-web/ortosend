"""Hace una imagen PNG de uno o varios STL (para revisar resultados sin abrir la interfaz).

    python herramientas/captura.py SALIDA.png A.stl [B.stl ...]
"""

import sys

import pyvista as pv

if __name__ == "__main__":
    salida, *stls = sys.argv[1:]
    n = len(stls)
    p = pv.Plotter(off_screen=True, shape=(1, n), window_size=(800 * n, 700))
    for k, ruta in enumerate(stls):
        p.subplot(0, k)
        m = pv.read(ruta)
        m["Z"] = m.points[:, 2]
        p.add_mesh(m, scalars="Z", cmap="viridis", smooth_shading=True, show_scalar_bar=False)
        p.add_text(f"{ruta.split('/')[-1]}  ({m.n_cells} triángulos)", font_size=10)
        p.camera_position = "iso"
        p.camera.elevation = 25
        p.reset_camera()
    p.screenshot(salida)
    print("Imagen:", salida)
