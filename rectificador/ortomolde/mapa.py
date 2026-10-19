"""Mapa de la tirada de CNC: hoja (PNG y PDF) para tener al lado de la máquina.

Muestra la plancha vista desde arriba tal como se pone en la CNC (origen abajo a la izquierda,
el frente de la máquina abajo), cada pie con su número (el mismo orden en que se fresan y el mismo
«Pieza N» del archivo .nc), su nombre, hacia dónde quedan los dedos, por dónde pasa la fresa y
una tabla con la posición de cada uno en mm.
"""

from __future__ import annotations

import io
from datetime import datetime
from pathlib import Path

import numpy as np
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.figure import Figure
from matplotlib.patches import FancyArrow

from ortomolde.cnc import TrabajoCNC

NARANJA = "#e67e22"
ROJO = "#d63031"
COLORES = ["#0984e3", "#00b894", "#6c5ce7", "#e17055", "#fdcb6e", "#e84393", "#00cec9", "#2d3436"]


def _partes(nombre: str) -> tuple[str, str]:
    """«ADROGUER · pie izquierdo» → («ADROGUER», «izquierdo»)."""
    if " · pie " in nombre:
        a, b = nombre.split(" · pie ", 1)
        return a, b
    return nombre, ""


def figura(trabajo: TrabajoCNC, titulo: str = "", fresa: float | None = None,
           resaltar: int | None = None) -> Figure:
    """Hoja apaisada (A4) con la plancha a la izquierda y la tabla de pies a la derecha.

    `resaltar`: número del pie que se marca (el seleccionado en la lista de la ventana)."""
    ancho, largo, alto = trabajo.plancha
    paso = trabajo.paso
    fig = Figure(figsize=(11.69, 8.27), dpi=110)  # A4 apaisado
    fig.patch.set_facecolor("white")
    ax = fig.add_axes([0.05, 0.09, 0.55, 0.80])

    # Escayola: blanca sin tocar; lo fresado en grises (más oscuro = más hondo).
    h = np.where(trabajo.zona, trabajo.altura, np.nan)
    gris = LinearSegmentedColormap.from_list("escayola", ["#5a5a5a", "#f4f4f4"])
    ax.add_patch(_rect(0, 0, ancho, largo, "#ffffff", "#333333", 1.6))
    ax.imshow(h, origin="lower", extent=[-paso / 2, ancho + paso / 2, -paso / 2, largo + paso / 2],
              cmap=gris, vmin=0, vmax=alto, interpolation="bilinear", zorder=1)

    for f in trabajo.fichas:
        color = COLORES[(f.numero - 1) % len(COLORES)]
        if f.contorno is not None:
            ax.plot(f.contorno[:, 0], f.contorno[:, 1], color=NARANJA, lw=1.2, zorder=3,
                    ls="--" if trabajo.previa else "-")
            if f.numero == resaltar:
                ax.plot(f.contorno[:, 0], f.contorno[:, 1], color=color, lw=5, alpha=0.6, zorder=3)
        cx, cy = (f.x[0] + f.x[1]) / 2, (f.y[0] + f.y[1]) / 2
        # Flecha talón → dedos.
        dx, dy = f.dedos
        largo_f = 0.30 * max(f.x[1] - f.x[0], f.y[1] - f.y[0])
        ax.add_patch(FancyArrow(cx - dx * largo_f * 0.2, cy - dy * largo_f * 0.2, dx * largo_f, dy * largo_f,
                                width=2.5, head_width=10, head_length=10, color=color, alpha=0.85, zorder=4,
                                length_includes_head=True))
        ax.text(cx + dx * largo_f * 0.95, cy + dy * largo_f * 0.95 + (8 if dy >= 0 else -8), "dedos",
                ha="center", va="bottom" if dy >= 0 else "top", fontsize=7, color=color, zorder=5)
        # Número grande dentro de un círculo y el nombre debajo.
        ny = cy - dy * largo_f * 0.55
        nx_ = cx - dx * largo_f * 0.55
        ax.text(nx_, ny, str(f.numero), ha="center", va="center", fontsize=20, fontweight="bold", color="white",
                zorder=6, bbox=dict(boxstyle="circle,pad=0.3", fc=color, ec="white", lw=1.5))
        molde, pie = _partes(f.nombre)
        ax.text(nx_, ny - 22, f"{molde}\n{pie.upper()}", ha="center", va="top", fontsize=8, fontweight="bold",
                color="#222222", zorder=6, bbox=dict(boxstyle="round,pad=0.25", fc="white", ec=color, alpha=0.9))

    # Origen, frente de la máquina y rejilla en mm.
    ax.plot([0], [0], "o", ms=11, mfc=ROJO, mec="white", mew=1.5, zorder=7, clip_on=False)
    ax.annotate("ORIGEN X0 Y0 (Z0 = arriba)", (0, 0), xytext=(9, -9), textcoords="offset points",
                fontsize=7.5, fontweight="bold", color=ROJO, va="top", zorder=7)
    ax.set_xlim(-12, ancho + 12)
    ax.set_ylim(-28, largo + 12)
    ax.set_aspect("equal")
    paso_rejilla = 50 if max(ancho, largo) <= 800 else 100
    ax.set_xticks(np.arange(0, ancho + 1e-6, paso_rejilla))
    ax.set_yticks(np.arange(0, largo + 1e-6, paso_rejilla))
    ax.tick_params(labelsize=7)
    ax.grid(True, color="#bbbbbb", lw=0.4, ls=":", zorder=2)
    ax.set_xlabel("X (mm)", fontsize=8)
    ax.set_ylabel("Y (mm)", fontsize=8)
    ax.text(ancho * 0.6, -20, "▼  DELANTE (frente de la máquina)  ▼", ha="center", va="center", fontsize=8,
            color="#444444")
    for lado in ("top", "right", "bottom", "left"):
        ax.spines[lado].set_visible(False)

    # Cabecera.
    tit = titulo or "Tirada de CNC"
    fig.text(0.06, 0.955, ("VISTA PREVIA – " if trabajo.previa else "MAPA DE LA PLANCHA – ") + tit,
             fontsize=15, fontweight="bold", color="#b35900" if trabajo.previa else "black")
    fresa_txt = f"fresa de bola Ø{fresa:g} mm · " if fresa else ""
    tiempo_txt = ("todavía sin calcular las trayectorias" if trabajo.previa
                  else f"tiempo estimado {trabajo.tiempo_min:.0f} min")
    fig.text(0.06, 0.925, f"Plancha {ancho:.0f} × {largo:.0f} × {alto:.0f} mm · {fresa_txt}"
                          f"{len(trabajo.fichas)} pie(s) · {tiempo_txt} · "
                          f"{datetime.now():%d/%m/%Y %H:%M}", fontsize=9, color="#444444")

    # Tabla de la derecha.
    tx = 0.635
    fig.text(tx, 0.86, "Pies en el orden en que se fresan", fontsize=11, fontweight="bold")
    fig.text(tx, 0.835, "(el número es el de «Pieza N» del archivo .nc)", fontsize=7.5, color="#666666")
    y = 0.80
    cab = ["Nº", "Molde", "Pie", "X (mm)", "Y (mm)", "Alto", "Min"]
    cols = [0.0, 0.03, 0.135, 0.195, 0.25, 0.305, 0.338]
    for c, t in zip(cols, cab):
        fig.text(tx + c, y, t, fontsize=8, fontweight="bold")
    y -= 0.008
    fig.add_artist(_linea(fig, tx, y, 0.355))
    filas_max = 18
    for f in trabajo.fichas[:filas_max]:
        y -= 0.032
        color = COLORES[(f.numero - 1) % len(COLORES)]
        molde, pie = _partes(f.nombre)
        valores = [str(f.numero), molde[:14], pie, f"{f.x[0]:.0f}–{f.x[1]:.0f}", f"{f.y[0]:.0f}–{f.y[1]:.0f}",
                   f"{f.alto:.0f}", "–" if np.isnan(f.tiempo_min) else f"{f.tiempo_min:.0f}"]
        for k, (c, t) in enumerate(zip(cols, valores)):
            fig.text(tx + c, y, t, fontsize=8, color=color if k == 0 else "#222222",
                     fontweight="bold" if k < 2 else "normal")
    if len(trabajo.fichas) > filas_max:
        y -= 0.03
        fig.text(tx, y, f"… y {len(trabajo.fichas) - filas_max} más (ver la hoja .txt)", fontsize=8)

    # Leyenda y recordatorios.
    y = min(y - 0.06, 0.36)
    notas = [
        ("●", ROJO, "Origen: X0 Y0 en la esquina delantera izquierda; Z0 en la cara de arriba."),
        ("━", NARANJA, "Recorrido de la fresa alrededor de cada pie (contorno)"
                       + (", aproximado hasta calcular." if trabajo.previa else ".")),
        ("➜", COLORES[0], "Flecha: del talón hacia los dedos."),
        ("■", "#5a5a5a", "Gris: escayola que se fresa (más oscuro = más hondo)."),
        ("□", "#333333", "Blanco: escayola que no se toca."),
    ]
    for simbolo, color, texto in notas:
        fig.text(tx, y, simbolo, fontsize=10, color=color, va="center")
        fig.text(tx + 0.025, y, texto, fontsize=7.5, va="center", wrap=True)
        y -= 0.035
    y -= 0.01
    fig.text(tx, y, "Cada pie: 1) contorno  2) desbaste por capas  3) acabado.", fontsize=7.5, va="center")
    for av in trabajo.avisos:
        y -= 0.035
        fig.text(tx, y, "⚠ " + av, fontsize=7, color=ROJO, va="top", wrap=True)
    return fig


def _rect(x, y, w, h, fc, ec, lw):
    from matplotlib.patches import Rectangle
    return Rectangle((x, y), w, h, fc=fc, ec=ec, lw=lw, zorder=0)


def _linea(fig, x, y, w):
    from matplotlib.lines import Line2D
    return Line2D([x, x + w], [y, y], transform=fig.transFigure, color="#888888", lw=0.8)


def png(trabajo: TrabajoCNC, titulo: str = "", fresa: float | None = None, dpi: int = 110,
        resaltar: int | None = None) -> bytes:
    """El mapa como imagen PNG (para verlo en la ventana)."""
    fig = figura(trabajo, titulo, fresa, resaltar)
    FigureCanvasAgg(fig)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi)
    return buf.getvalue()


def guardar(trabajo: TrabajoCNC, ruta_base: str | Path, titulo: str = "", fresa: float | None = None) -> list[Path]:
    """Guarda `<ruta_base>_mapa.png` y `<ruta_base>_mapa.pdf` (para imprimir)."""
    ruta_base = Path(ruta_base)
    fig = figura(trabajo, titulo, fresa)
    FigureCanvasAgg(fig)
    rutas = [ruta_base.with_name(ruta_base.stem + "_mapa.png"), ruta_base.with_name(ruta_base.stem + "_mapa.pdf")]
    fig.savefig(rutas[0], dpi=150)
    fig.savefig(rutas[1])
    return rutas

