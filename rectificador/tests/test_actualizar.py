import zipfile

import pytest

from interfaz import actualizar as A


def _zip_de_github(ruta, version="1.2.3", quitar=()):
    """Un ZIP con la misma forma que el que da GitHub de la rama."""
    archivos = {
        "ortosend-claude-rectificador-moldes/README.md": "web",
        "ortosend-claude-rectificador-moldes/src/app.ts": "web",
        "ortosend-claude-rectificador-moldes/rectificador/VERSION": version + "\n",
        "ortosend-claude-rectificador-moldes/rectificador/requirements.txt": "numpy\n",
        "ortosend-claude-rectificador-moldes/rectificador/interfaz/principal.py": "# programa",
        "ortosend-claude-rectificador-moldes/rectificador/ortomolde/__init__.py": "__version__ = '1.2.3'",
        "ortosend-claude-rectificador-moldes/rectificador/config/taller.toml": "",
        "ortosend-claude-rectificador-moldes/rectificador/tests/test_x.py": "pruebas",
    }
    with zipfile.ZipFile(ruta, "w") as z:
        z.writestr("ortosend-claude-rectificador-moldes/", "")
        for n, t in archivos.items():
            if not any(n.endswith(q) for q in quitar):
                z.writestr(n, t)
    return ruta


def test_preparar_extrae_solo_el_programa(tmp_path):
    nueva = A.preparar(_zip_de_github(tmp_path / "d.zip"), tmp_path / "nueva", "1.2.3")
    assert (nueva / "interfaz" / "principal.py").read_text() == "# programa"
    assert not (nueva / "README.md").exists() and not (nueva / "src").exists()  # nada de la web
    assert not (nueva / "tests").exists()


@pytest.mark.parametrize("quitar, version, mensaje", [
    (("interfaz/principal.py",), "1.2.3", "faltan"),
    ((), "9.9.9", "esperaba"),
])
def test_preparar_rechaza_una_descarga_mala(tmp_path, quitar, version, mensaje):
    with pytest.raises(A.ErrorActualizacion, match=mensaje):
        A.preparar(_zip_de_github(tmp_path / "d.zip", quitar=quitar), tmp_path / "nueva", version)
    assert not (tmp_path / "nueva").exists()  # no deja nada a medias


def test_preparar_zip_danado(tmp_path):
    malo = tmp_path / "d.zip"
    malo.write_bytes(b"no es un zip")
    with pytest.raises(A.ErrorActualizacion):
        A.preparar(malo, tmp_path / "nueva", "1.0")


def test_novedades_solo_las_nuevas():
    texto = "# Novedades\n\n## 0.4.0\n- d\n\n## 0.3.0\n- c\n\n## 0.2.0\n- b\n"
    assert A.novedades(texto, "0.2.0") == "## 0.4.0\n- d\n\n## 0.3.0\n- c"
    assert A.novedades(texto, "0.4.0") == ""
    assert A.version("0.10.0") > A.version("0.9.3")


def test_requisitos_cambian(tmp_path):
    nueva, entorno = tmp_path / "nueva", tmp_path / "entorno"
    nueva.mkdir()
    entorno.mkdir()
    (nueva / "requirements.txt").write_text("numpy\n")
    assert A.requisitos_cambian(nueva, entorno)  # sin huella guardada: reinstalar
    (entorno / "requisitos.sha").write_text(A.huella(nueva / "requirements.txt").upper() + " \r\n")
    assert not A.requisitos_cambian(nueva, entorno)  # (como la escribe instalar.bat)
    (nueva / "requirements.txt").write_text("numpy\nscipy\n")
    assert A.requisitos_cambian(nueva, entorno)


@pytest.mark.parametrize("reinstalar", [True, False])
def test_script_de_cambio(reinstalar):
    t = A.script_de_cambio(4242, "1.2.3", reinstalar, "abc123")
    t.encode("ascii")  # solo letras sencillas (las rutas salen de %LOCALAPPDATA%)
    assert "\r\n" in t and "PID eq 4242" in t
    assert '"%BASE%\\programa"' in t and "programa_anterior" in t
    assert ("pip install" in t) == reinstalar and ("abc123" in t) == reinstalar
    # Si algo falla, vuelve a poner la versión anterior y la abre.
    deshacer = t[t.index(":deshacer"):]
    assert 'move "%BASE%\\programa_anterior" "%BASE%\\programa"' in deshacer and "--fallo-actualizacion" in deshacer
    assert "--actualizado" in t[:t.index(":deshacer")]


def test_no_instalado_fuera_de_windows():
    assert A.base_instalada() is None


def _publicado(version="1.2.3"):
    """Archivos «publicados» (como los sirve raw.githubusercontent.com) y su manifiesto."""
    import hashlib

    archivos = {
        "VERSION": f"{version}\n".encode(),
        "requirements.txt": b"numpy\n",
        "interfaz/principal.py": b"# programa",
        "ortomolde/__init__.py": b"__version__ = '1.2.3'",
        "config/taller.toml": b"",
        "instalar.bat": b"@echo off\necho hola\n",
    }
    manifiesto = "".join(f"{hashlib.sha256(d).hexdigest()} {len(d)} {r}\n" for r, d in archivos.items())
    return archivos, manifiesto


def _servidor(monkeypatch, archivos, manifiesto, estropear=None):
    def bajar(url, *a, **k):
        if url == A.URL_MANIFIESTO:
            return manifiesto.encode()
        ruta = url[len(A.URL_BRUTO) + 1:]
        if ruta == estropear:
            return b"otra cosa"
        return archivos[ruta]
    monkeypatch.setattr(A, "_bajar", bajar)


def test_descarga_archivo_a_archivo(tmp_path, monkeypatch):
    archivos, manifiesto = _publicado()
    _servidor(monkeypatch, archivos, manifiesto)
    avances = []
    nueva = A.descargar_archivos(tmp_path / "nueva", "1.2.3", lambda b, t: avances.append((b, t)))
    assert (nueva / "interfaz" / "principal.py").read_bytes() == b"# programa"
    assert (nueva / "instalar.bat").read_bytes() == b"@echo off\r\necho hola\r\n"  # los .bat, como en Windows
    assert avances[-1][0] == avances[-1][1]


def test_archivo_distinto_no_se_instala_y_se_prueba_el_zip(tmp_path, monkeypatch):
    archivos, manifiesto = _publicado()
    _servidor(monkeypatch, archivos, manifiesto, estropear="interfaz/principal.py")
    with pytest.raises(A.ErrorActualizacion, match="distinto"):
        A.descargar_archivos(tmp_path / "nueva", "1.2.3")
    assert not (tmp_path / "nueva").exists()
    # Con `obtener` se pasa al ZIP.
    monkeypatch.setattr(A, "descargar", lambda destino, progreso=None: _zip_de_github(destino))
    nueva = A.obtener(tmp_path, "1.2.3")
    assert nueva == tmp_path / "actualizacion" / "nueva" and (nueva / "VERSION").exists()


def test_si_todo_falla_el_error_se_entiende(tmp_path, monkeypatch):
    import urllib.error

    def sin_red(*a, **k):
        raise urllib.error.URLError("timed out")
    monkeypatch.setattr(A, "_bajar", sin_red)
    monkeypatch.setattr(A, "descargar", sin_red)
    with pytest.raises(A.ErrorActualizacion) as e:
        A.obtener(tmp_path, "1.2.3")
    texto = A.explicar(e.value)
    assert "no se ha podido conectar (timed out)" in texto and "<" not in texto


def test_manifiesto_rechaza_rutas_raras():
    for mala in ("../fuera.py", "/etc/x", "C:/x"):
        with pytest.raises(A.ErrorActualizacion):
            A.leer_manifiesto(f"{'0' * 64} 1 {mala}\n")


def test_manifiesto_al_dia():
    """MANIFIESTO.txt tiene que coincidir con los archivos: si falla, `python herramientas/manifiesto.py`."""
    import shutil
    import sys
    from pathlib import Path

    if not shutil.which("git"):
        pytest.skip("sin git")
    carpeta = Path(A.__file__).resolve().parents[1]
    sys.path.insert(0, str(carpeta / "herramientas"))
    import manifiesto

    assert (carpeta / A.MANIFIESTO).read_text(encoding="utf-8") == manifiesto.texto()
