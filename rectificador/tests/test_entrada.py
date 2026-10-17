import json
import zipfile

import numpy as np
import pytest

from ortomolde.campo import malla_a_campo
from ortomolde.entrada import ErrorEntrada, cargar_malla
from ortomolde.sintetico import malla_sintetica

REVOX = {"meshes": [{"face_count": 10, "file": "meshs/Mesh 0920_1.ply", "name": "Mesh 0920_1"}],
         "need_rotate": 1}


@pytest.fixture(scope="module")
def malla():
    return malla_sintetica(paso=2.0)


@pytest.fixture
def proyecto_revo(tmp_path, malla):
    carpeta = tmp_path / "adroguer"
    (carpeta / "meshs").mkdir(parents=True)
    malla.export(carpeta / "meshs" / "Mesh 0920_1.ply")
    (carpeta / "adroguer.revox").write_text(json.dumps(REVOX, indent=4).replace("\n", "\r\n"), encoding="utf-8")
    (carpeta / "frames").mkdir()
    (carpeta / "frames" / "foto.jpg").write_bytes(b"\xff\xd8 no es una malla")
    return carpeta


def _mismo_molde(a, b):
    za = malla_a_campo(a, 2.0).z
    zb = malla_a_campo(b, 2.0).z
    return za.shape == zb.shape and np.abs(za - zb).max() < 1e-3


@pytest.mark.parametrize("ext", [".stl", ".ply", ".obj"])
def test_formatos_de_malla(tmp_path, malla, ext):
    ruta = tmp_path / f"escaneo{ext}"
    malla.export(ruta)
    assert _mismo_molde(cargar_malla(ruta), malla)


def test_revox_abre_su_malla(proyecto_revo, malla):
    assert _mismo_molde(cargar_malla(proyecto_revo / "adroguer.revox"), malla)


def test_revox_sin_su_malla_da_error_claro(proyecto_revo):
    (proyecto_revo / "meshs" / "Mesh 0920_1.ply").unlink()
    with pytest.raises(ErrorEntrada, match="no está junto al"):
        cargar_malla(proyecto_revo / "adroguer.revox")


def test_zip_de_la_carpeta_del_proyecto(proyecto_revo, malla, tmp_path):
    ruta = tmp_path / "proyecto.zip"
    with zipfile.ZipFile(ruta, "w") as z:
        for f in proyecto_revo.rglob("*"):
            if f.is_file():
                z.write(f, f.relative_to(proyecto_revo.parent).as_posix())
    assert _mismo_molde(cargar_malla(ruta), malla)


def test_zip_solo_con_revox_y_zip_sin_malla(proyecto_revo, tmp_path):
    solo = tmp_path / "solo.zip"
    with zipfile.ZipFile(solo, "w") as z:
        z.write(proyecto_revo / "adroguer.revox", "adroguer.revox")
    with pytest.raises(ErrorEntrada, match="Comprime también la carpeta «meshs»"):
        cargar_malla(solo)
    vacio = tmp_path / "vacio.zip"
    with zipfile.ZipFile(vacio, "w") as z:
        z.writestr("notas.txt", "hola")
    with pytest.raises(ErrorEntrada, match="no hay ningún escaneo"):
        cargar_malla(vacio)
