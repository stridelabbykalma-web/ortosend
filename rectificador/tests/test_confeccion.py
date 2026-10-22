"""Apartado «Confección» contra una web falsa que imita la API del taller de Ortosend."""

import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from interfaz import web as W

# Una foto de verdad (PNG de 1×1) para las miniaturas.
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


class WebFalsa:
    """La API /api/taller de la web, con su estado en memoria (como la de verdad, más simple)."""

    def __init__(self):
        self.materiales = [
            {"id": "eva", "nombre": "EVA 3 mm", "tipo": "BASE", "grosorMm": 3, "dureza": "45 Shore A",
             "planchaAnchoMm": 1000, "planchaLargoMm": 1500, "precioCents": 2500, "paresPorPlancha": 20,
             "activo": True, "orden": 10},
            {"id": "forro", "nombre": "Forro piel", "tipo": "FORRO", "grosorMm": 1, "dureza": None,
             "planchaAnchoMm": None, "planchaLargoMm": None, "precioCents": 1800, "paresPorPlancha": 18,
             "activo": True, "orden": 20},
        ]
        self.ajustes = {"precioHoraCents": 2000, "costeCncMinutoCents": 20, "costeMoldeCents": 300,
                        "minutosCnc": 30, "minutosConfeccion": 45}
        self.pedidos = {
            "c1": {"id": "c1", "numero": 101, "paciente": "Ana Ruiz", "clinica": "Clínica Sol", "estado": "FABRICACION",
                   "fase": "CONFECCION", "paso": "Confección", "lote": "L-03", "material": None,
                   "plazo": {"dia": 7, "nivel": "fuera", "texto": "Fuera de plazo (+2)"}, "rehacer": False,
                   "entrega": "CLINICA"},
            "c2": {"id": "c2", "numero": 102, "paciente": "Luis Gil", "clinica": "Clínica Sol", "estado": "FABRICACION",
                   "fase": "MECANIZADO", "paso": "Mecanizado CNC", "lote": None, "material": None,
                   "plazo": {"dia": 1, "nivel": "ok", "texto": "Día 1 de 5"}, "rehacer": False, "entrega": "DOMICILIO"},
        }
        self.hojas = {}
        # Materiales registrados con el móvil (trazabilidad).
        self.materiales_usados = {"c1": [
            {"id": "m1", "material": "EVA 3 mm", "lote": "EVA-7781", "caducidad": "2027-12-31", "pies": "par",
             "foto": "/api/media/x", "quien": "Rosa", "cuando": "2026-10-21T09:15:00Z", "anulado": None},
            {"id": "m2", "material": "Forro piel", "lote": "F-1", "caducidad": None, "pies": "I", "foto": None,
             "quien": "Rosa", "cuando": "2026-10-21T09:20:00Z",
             "anulado": {"quien": "Rosa", "motivo": "No era esa plancha", "cuando": "2026-10-21T09:21:00Z"}},
        ]}
        self.token = None
        self.con_expediente = True  # False = web antigua, sin el expediente
        self.revocado = False  # True = el paciente ha retirado los consentimientos
        self.archivos = {"/api/media/f1": (PNG, "image/png"), "/api/media/v1": (b"\x1aE\xdf\xa3", "video/webm"),
                         "/api/rx-pdf/c1": (b"%PDF-1.4 receta", "application/pdf")}
        self.peticiones = []
        self.maquinas_cnc = {}  # id → {id, nombre, placas: [{id, ancho, largo, alto, tiradas: [...]}]}
        self.servidor = ThreadingHTTPServer(("127.0.0.1", 0), self._manejador())
        threading.Thread(target=self.servidor.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.servidor.server_address[1]}"

    def cerrar(self):
        self.servidor.shutdown()

    def _detalle(self, id_):
        p = dict(self.pedidos[id_])
        p["pies"] = [{"pie": "I", "nombre": "Izquierdo", "pauta": "Skive medial 4 mm", "especifica": True, "datos": ["FPI-6 +8"]},
                     {"pie": "D", "nombre": "Derecho", "pauta": "EVA con relleno de arco", "especifica": False, "datos": []}]
        p["ficha"] = [["Talla de calzado (EU)", "39"]]
        p["hoja"] = self.hojas.get(id_)
        p["materiales"] = self.materiales_usados.get(id_, [])
        if not self.con_expediente:
            return p
        if self.revocado:
            p.update(receta=None, estudio=None, expediente=None, escaneo=None,
                     aviso="El paciente no tiene en vigor los consentimientos: no se puede ver su expediente.")
            return p
        p.update(
            diagnostico="Pie plano valgo",
            receta={"prescriptor": "Dra. Receta", "colegiado": "4321", "firmada": "2026-10-15T10:00:00Z",
                    "valoracion": "Pronación marcada en apoyo", "diagnostico": "Pie plano valgo",
                    "pauta": "EVA con relleno de arco", "pautaIzq": "Skive medial 4 mm", "pautaDcha": None,
                    "pautaUso": "Uso progresivo", "contacto": None, "pdf": f"/api/rx-pdf/{id_}"},
            estudio=[{"id": "v1", "tipo": "video", "etiqueta": "Marcha posterior (alejándose) — descalzo",
                      "url": "/api/media/v1", "mime": "video/webm", "segundos": 6,
                      "resumen": ["Retropié en apoyo: dcha. 9° · izq. 4° (+ eversión / − inversión)"]},
                     {"id": "f1", "tipo": "foto", "etiqueta": "Pies de cerca desde atrás (retropié) — en carga",
                      "url": "/api/media/f1", "mime": None, "segundos": None,
                      "resumen": ["Línea de Helbing (tendón de Aquiles): dcha. 7° valgo (orientativa)"]}],
            expediente=[{"titulo": "Cuestionario clínico", "filas": [["Motivo indicado al reservar", "Dolor de talón"]]},
                        {"titulo": "Exploración biomecánica y tests", "filas": [["FPI-6 izq.", "+8"]]}],
            escaneo={"proyecto": "Ana Ruiz 600111222", "clinica": "Clínica Sol"},
            aviso=None)
        return p

    def responder(self, metodo, ruta, cabeceras, cuerpo):
        self.peticiones.append((metodo, ruta))
        if ruta in self.archivos:  # vídeos, fotos y la receta en PDF (con el mismo token)
            if not self.token or cabeceras.get("Authorization") != f"Bearer {self.token}":
                return 401, {"error": "No autenticado"}
            return 200, self.archivos[ruta]
        if not ruta.startswith("/api/taller"):
            return 404, "<html>no</html>"
        ruta = ruta[len("/api/taller"):]
        if ruta == "/sesion" and metodo == "POST":
            if cuerpo.get("email") == "taller@ortosend.es" and cuerpo.get("password") == "clave":
                self.token = "tok-123"
                return 200, {"token": self.token, "nombre": "Toni Taller", "rol": "TALLER", "dias": 30}
            return 401, {"error": "Email o contraseña incorrectos"}
        if cabeceras.get("Authorization") != f"Bearer {self.token}" or not self.token:
            return 401, {"error": "Sesión caducada: vuelve a entrar con tu usuario de taller"}
        if ruta.startswith("/maquinas"):
            return self._maquinas(metodo, ruta, cuerpo)
        orden = sorted(self.pedidos.values(), key=lambda p: {"fuera": 0, "ajustado": 1, "ok": 2}[p["plazo"]["nivel"]])
        if ruta == "/pedidos":
            return 200, {"pedidos": orden}
        if ruta == "/materiales":
            if metodo == "PUT":
                self.materiales = [dict(m, id=m.get("id") or f"nuevo{i}") for i, m in enumerate(cuerpo["materiales"])]
            return 200, {"materiales": self.materiales}
        if ruta == "/ajustes":
            if metodo == "PUT":
                self.ajustes = cuerpo
            return 200, {"ajustes": self.ajustes}
        partes = ruta.strip("/").split("/")
        if partes[0] == "pedidos" and partes[1] in self.pedidos:
            id_ = partes[1]
            p = self.pedidos[id_]
            if len(partes) == 2:
                return 200, self._detalle(id_)
            if partes[2] == "hoja" and metodo == "PUT":
                self.hojas[id_] = dict(cuerpo)  # como la web con un usuario de taller: sin costes
                return 200, {"hoja": self.hojas[id_]}
            if partes[2] == "fresado":
                if p["fase"] != "MECANIZADO":
                    return 409, {"error": "El caso no está en mecanizado"}
                p.update(fase="CONFECCION", paso="Confección", lote=cuerpo.get("lote") or p["lote"])
                return 200, self._detalle(id_)
            if partes[2] == "confeccion":
                if p["fase"] != "CONFECCION":
                    return 409, {"error": "El caso no está en confección"}
                if not [m for m in self.materiales_usados.get(id_, []) if not m["anulado"]]:
                    return 409, {"error": "Registra antes los materiales usados"}
                p.update(estado="CALIDAD", material=cuerpo["material"])
                del self.pedidos[id_]
                return 200, {"ok": True, "numero": p["numero"], "estado": "CALIDAD"}
        return 404, {"error": "Caso no activo en taller"}

    def _maquina_json(self, m):
        p = m["placas"][-1] if m["placas"] else None
        return {"id": m["id"], "nombre": m["nombre"], "placa": None if p is None else {
            "id": p["id"], "ancho": p["ancho"], "largo": p["largo"], "alto": p["alto"], "puesta": "2026-10-22T10:00:00Z",
            "tiradas": [t for t in p["tiradas"] if not t.get("anulada")]}}

    def _maquinas(self, metodo, ruta, cuerpo):
        """Como /api/taller/maquinas de la web (idempotente por id)."""
        partes = ruta.strip("/").split("/")
        if len(partes) == 1:
            if metodo == "POST":
                if any(m["nombre"] == cuerpo["nombre"] for m in self.maquinas_cnc.values()):
                    return 409, {"error": "Ya hay una máquina con ese nombre"}
                mid = f"maq{len(self.maquinas_cnc) + 1}"
                self.maquinas_cnc[mid] = {"id": mid, "nombre": cuerpo["nombre"], "placas": []}
                return 200, {"maquina": self._maquina_json(self.maquinas_cnc[mid])}
            return 200, {"maquinas": [self._maquina_json(m) for m in self.maquinas_cnc.values()]}
        m = self.maquinas_cnc.get(partes[1])
        if m is None:
            return 404, {"error": "Máquina no encontrada"}
        if partes[2] == "placa":
            if not any(p["id"] == cuerpo["id"] for p in m["placas"]):
                m["placas"].append({**cuerpo, "tiradas": []})
        elif partes[2] == "tiradas" and len(partes) == 3:
            placa = next((p for p in m["placas"] if p["id"] == cuerpo["placaId"]), None)
            if placa is None:
                return 409, {"error": "Esa placa no es de esta máquina"}
            if not any(t["id"] == cuerpo["id"] for p in m["placas"] for t in p["tiradas"]):
                placa["tiradas"].append({"id": cuerpo["id"], "nombre": cuerpo["nombre"], "zonas": cuerpo["zonas"],
                                         "fecha": "2026-10-22T11:00:00Z", "quien": "Toni Taller"})
        elif partes[2] == "tiradas" and partes[4] == "anular":
            for p in m["placas"]:
                for t in p["tiradas"]:
                    if t["id"] == partes[3]:
                        t["anulada"] = True
        return 200, {"maquina": self._maquina_json(m)}

    def _manejador(self):
        falsa = self

        class M(BaseHTTPRequestHandler):
            def _atender(self, metodo):
                n = int(self.headers.get("Content-Length") or 0)
                cuerpo = json.loads(self.rfile.read(n) or b"{}") if n else {}
                status, datos = falsa.responder(metodo, self.path, dict(self.headers), cuerpo)
                if isinstance(datos, tuple):  # archivo: (contenido, tipo)
                    contenido, tipo = datos
                else:
                    contenido = (datos if isinstance(datos, str) else json.dumps(datos)).encode()
                    tipo = "text/html" if isinstance(datos, str) else "application/json"
                self.send_response(status)
                self.send_header("Content-Type", tipo)
                self.end_headers()
                self.wfile.write(contenido)

            def do_GET(self):
                self._atender("GET")

            def do_POST(self):
                self._atender("POST")

            def do_PUT(self):
                self._atender("PUT")

            def log_message(self, *a):
                pass

        return M


@pytest.fixture()
def falsa():
    f = WebFalsa()
    yield f
    f.cerrar()


def test_cliente(falsa):
    c = W.ClienteWeb(falsa.url)
    with pytest.raises(W.ErrorWeb) as e:
        c.pedidos()
    assert e.value.status == 401
    with pytest.raises(W.ErrorWeb, match="incorrectos"):
        c.entrar("taller@ortosend.es", "mal")
    assert c.entrar("taller@ortosend.es", "clave") == "Toni Taller"
    assert [p["numero"] for p in c.pedidos()] == [101, 102]  # el fuera de plazo primero
    assert c.pedido("c1")["pies"][0]["pauta"] == "Skive medial 4 mm"
    with pytest.raises(W.ErrorWeb, match="no está en mecanizado") as e:
        c.marcar_fresado("c1", "L-1")
    assert e.value.status == 409
    # Una web sin la API todavía (404 en HTML): se explica que falta publicarla.
    sin_api = W.ClienteWeb(falsa.url + "/otra", token="tok")
    with pytest.raises(W.ErrorWeb, match="falta publicar"):
        sin_api.pedidos()
    # Sin conexión.
    with pytest.raises(W.ErrorWeb, match="internet") as e:
        W.ClienteWeb("http://127.0.0.1:9", token="x", espera=2).pedidos()
    assert e.value.status == 0


def _ventana(falsa, monkeypatch):
    from PySide6.QtCore import QSettings
    from PySide6.QtWidgets import QApplication

    from interfaz.confeccion import PanelConfeccion
    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    ajustes = QSettings("Ortosend", "Rectificador")
    for k in ("web_token", "web_usuario", "web_cache", "web_email", "cnc_en_marcha", "apartado"):
        ajustes.remove(k)
    monkeypatch.setattr(PanelConfeccion, "SINCRONO", True)
    v = VentanaPrincipal()
    v.confeccion.web.url = falsa.url
    return app, v


def _limpiar(v):
    for k in ("web_token", "web_usuario", "web_cache", "web_email", "cnc_en_marcha", "apartado"):
        v.ajustes.remove(k)
    v.close()


def test_apartados_y_tablero_de_postits(falsa, tmp_path, monkeypatch):
    from PySide6.QtWidgets import QInputDialog

    from interfaz.confeccion import PanelConfeccion

    app, v = _ventana(falsa, monkeypatch)
    v.show()
    assert v.windowTitle() == "Ortosend Taller"
    # Dos apartados: Fresado (con su barra de herramientas) y Confección.
    assert v.apartados.currentIndex() == 0 and v.barra.isVisibleTo(v)
    c = v.abrir_confeccion()
    assert v.apartados.currentWidget() is c and not v.barra.isVisibleTo(v)
    assert v.botones_apartado["confeccion"].isChecked()
    assert c.boton_sesion.text() == "Entrar" and not c.postits
    assert c.entrar("taller@ortosend.es", "clave")
    assert "Toni Taller" in c.texto_sesion.text()
    # Post-its en su columna, en el orden de la web, con el color del plazo.
    assert c.columnas["confeccion"][0].text() == "EN CONFECCIÓN · 1"
    assert c.columnas["fresar"][0].text() == "POR FRESAR · 1"
    assert c.postits["c1"].papel == "#ffc9c9" and c.postits["c2"].papel == "#d3f9d8"
    # Sin costes ni precios en ningún sitio.
    assert not hasattr(c, "texto_coste") and c.tabla.columnCount() == 3
    # Clic en un post-it: su hoja; con ▶ / ◀ se pasa al siguiente.
    from PySide6.QtCore import QPoint, Qt
    from PySide6.QtTest import QTest

    QTest.mouseClick(c.postits["c2"], Qt.LeftButton, pos=QPoint(20, 20))
    assert c.pedido["id"] == "c2" and "Skive medial 4 mm" in c.texto_pauta.text()
    assert c.boton_fresado.isVisibleTo(c) and not c.boton_terminado.isVisibleTo(c)
    c.mover(1)
    assert c.pedido["id"] == "c1" and c.boton_terminado.isVisibleTo(c)
    c.mover(1)
    assert c.pedido["id"] == "c2"  # vuelve al principio
    c.mover(-1)
    assert c.pedido["id"] == "c1"
    # Hoja: capas, guardar e imprimir.
    c.anadir_capa({"materialId": "eva", "pies": "par"})
    c.anadir_capa({"materialId": "forro", "pies": "I", "notas": "negro"})
    c.botones_proceso["CAPAS"].setChecked(True)
    c.guardar_hoja()
    assert falsa.hojas["c1"]["proceso"] == "CAPAS" and falsa.hojas["c1"]["capas"][1] == {"materialId": "forro", "pies": "I", "notas": "negro"}
    pdf = tmp_path / "hoja.pdf"
    c.guardar_pdf(str(pdf))
    assert pdf.stat().st_size > 1000 and "€" not in c.html_hoja()
    # Materiales registrados con el móvil (trazabilidad), con el anulado tachado.
    texto = c.texto_materiales.text()
    assert "EVA-7781" in texto and "31/12/2027" in texto and "<s>" in texto and "No era esa plancha" in texto
    assert "Materiales usados (trazabilidad)" in c.html_hoja() and "EVA-7781" in c.html_hoja()
    assert "F-1" not in c.html_hoja()  # el anulado no va en la hoja impresa
    # Confección terminada → sale del tablero (sin preguntar el material: van los lotes registrados).
    c.marcar_terminado(preguntar=False)
    assert "c1" not in falsa.pedidos and "c1" not in c.postits and c.pedido is None
    # Sin internet: se ve la última lista guardada.
    c2 = PanelConfeccion(v)
    assert list(c2.postits) == ["c2"] and "guardada" in c2.texto_lista.text()
    # Sesión caducada: desconecta y pide entrar.
    falsa.token = "otro"
    monkeypatch.setattr("PySide6.QtWidgets.QMessageBox.warning", staticmethod(lambda *a, **k: None))
    c.actualizar()
    assert c.web.token is None and c.boton_sesion.text() == "Entrar"
    v.ir_a("fresado")
    assert v.apartados.currentIndex() == 0 and v.barra.isVisibleTo(v)
    _limpiar(v)


def test_aviso_de_fin_de_cnc(falsa, monkeypatch):
    from datetime import datetime, timedelta

    app, v = _ventana(falsa, monkeypatch)
    c = v.confeccion
    assert c.entrar("taller@ortosend.es", "clave")
    # La CNC empieza una tirada de 40 min con los pedidos 102 (por fresar) y 999 (no está).
    v.cnc_iniciar(40, "TIRADA 7", [102, 999], ["#102 LUIS · pie izquierdo", "#102 LUIS · pie derecho", "OTRO"])
    assert "quedan 40 min" in v.boton_cnc.text() and v.accion_cnc.isVisible() and not c.aviso_cnc.isVisibleTo(c)
    # Tiempo cumplido (también si el programa se cerró entretanto): sale el aviso en Confección.
    v.cnc_iniciar(40, "TIRADA 7", [102, 999], ["a", "b", "c"], inicio=datetime.now() - timedelta(minutes=41))
    v.show()
    v.ir_a("confeccion")
    assert c.aviso_cnc.isVisibleTo(c) and "TIRADA 7" in c.texto_aviso_cnc.text()
    assert "CNC terminada" in v.boton_cnc.text() and v.cnc_estado()["avisado"]
    assert c.boton_pasar.text() == "Pasar sus 2 pedidos a confección"
    c.pasar_tirada_a_confeccion()
    assert falsa.pedidos["c2"]["fase"] == "CONFECCION" and falsa.pedidos["c2"]["lote"] == "TIRADA 7"
    assert v.cnc_estado() is None and not c.aviso_cnc.isVisibleTo(c) and not v.accion_cnc.isVisible()
    _limpiar(v)


def test_inicio_desde_la_tirada(stl_sintetico, monkeypatch, tmp_path):
    """En Fresado, «Inicio» de la tirada pone en marcha el aviso con el tiempo estimado y los pedidos."""
    from PySide6.QtCore import QSettings
    from PySide6.QtWidgets import QApplication

    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    QSettings("Ortosend", "Rectificador").remove("cnc_en_marcha")
    v = VentanaPrincipal()
    ruta = tmp_path / "Ana Ruiz 600111222 caso 321.stl"
    ruta.write_bytes(stl_sintetico.read_bytes())
    v.abrir(str(ruta), esperar=True)
    assert v.proyecto.paciente["pedido"] == 321 and v.caja_pedido.text() == "321"  # del nombre del escaneo
    t = v.abrir_tirada()
    t.anadir_abierto()
    assert all(p.pedido == 321 and p.nombre.startswith("#321 ") for p in t.piezas)
    assert not t.boton_inicio.isEnabled()
    t.calcular(esperar=True)
    assert t.boton_inicio.isEnabled()
    t.iniciar("L-09")
    estado = v.cnc_estado()
    assert estado["pedidos"] == [321] and estado["lote"] == "L-09" and len(estado["moldes"]) == 2
    assert abs(estado["minutos"] - t.trabajo.tiempo_min) < 1e-6
    v.cnc_parar()
    t.close()
    v.close()


def test_materiales_sin_precios(falsa):
    from PySide6.QtWidgets import QApplication

    from interfaz.confeccion import DialogoMateriales

    app = QApplication.instance() or QApplication([])
    d = DialogoMateriales(None, falsa.materiales)
    assert d.tabla.rowCount() == 2
    assert not any("€" in d.tabla.horizontalHeaderItem(i).text() or "Pares" in d.tabla.horizontalHeaderItem(i).text()
                   for i in range(d.tabla.columnCount()))
    d.anadir()
    d.tabla.item(2, 0).setText("Corcho 3 mm")
    lista = d.materiales()
    assert lista[0]["id"] == "eva" and "precioCents" not in lista[0]
    assert lista[2]["nombre"] == "Corcho 3 mm" and "id" not in lista[2]
    assert lista[1]["dureza"] is None and lista[1]["planchaAnchoMm"] is None
    d.close()
    d.deleteLater()
    app.processEvents()


def test_expediente_del_pedido(falsa, monkeypatch):
    """Receta (qué hay que hacer), vídeos y fotos con su análisis, cuestionario y exploración."""
    from PySide6.QtWidgets import QApplication, QWidget

    from interfaz import expediente as E

    app = QApplication.instance() or QApplication([])
    monkeypatch.setattr(E.VentanaExpediente, "SINCRONO", True)
    abiertos = []
    monkeypatch.setattr(E.QDesktopServices, "openUrl", lambda u: abiertos.append(u.toLocalFile()) or True)
    cli = W.ClienteWeb(falsa.url)
    cli.entrar("taller@ortosend.es", "clave")
    assert cli.bajar("/api/media/f1") == (PNG, "image/png")
    assert cli.buscar_pedido(102) == "c2" and cli.buscar_pedido(999) is None
    padre = QWidget()
    v = E.abrir(padre, cli, "c1", "#101 · Ana Ruiz")
    app.processEvents()
    assert E.abrir(padre, cli, "c1") is v  # una sola ventana por pedido
    assert "#101 · Ana Ruiz" in v.windowTitle() and not v.aviso.isVisible()
    receta = v.texto_receta.toPlainText()
    for t in ("Skive medial 4 mm", "EVA con relleno de arco", "Pie plano valgo", "Pronación marcada", "Dra. Receta",
              "4321", "15/10/2026"):
        assert t in receta
    # La receta firmada en PDF: se baja y se abre con el visor del ordenador.
    assert v.boton_pdf.isEnabled()
    v.abrir_pdf()
    assert abiertos and abiertos[-1].endswith(".pdf") and open(abiertos[-1], "rb").read().startswith(b"%PDF")
    # Vídeos y fotos: la foto se baja ya (miniatura) y se ve con su análisis.
    assert v.lista.count() == 2 and "/api/media/f1" in v.archivos and "/api/media/v1" not in v.archivos
    v.lista.setCurrentRow(1)
    assert v.visor.currentIndex() == 0 and not v.imagen.pixmap().isNull()
    assert "Helbing" in v.texto_analisis.text() and v.boton_externo.isEnabled()
    v.lista.setCurrentRow(0)  # el vídeo se baja al elegirlo
    assert "/api/media/v1" in v.archivos and "Retropié" in v.texto_analisis.text()
    if E.QMediaPlayer is not None:
        assert v.visor.currentIndex() == 1
    v.abrir_externo()
    assert abiertos[-1].endswith(".webm")
    # Cuestionario, exploración y escaneo.
    texto = v.texto_expediente.toPlainText()
    assert "Dolor de talón" in texto and "FPI-6" in texto and "Ana Ruiz 600111222" in texto
    # Al cerrar se borra todo lo bajado (datos de salud).
    carpeta = v.carpeta
    assert any(carpeta.iterdir())
    v.close()
    app.processEvents()
    assert not carpeta.exists()
    # Sin consentimientos: no se ve nada clínico y se dice por qué.
    falsa.revocado = True
    v2 = E.abrir(padre, cli, "c2", "#102")
    assert "consentimientos" in v2.aviso.text() and v2.lista.count() == 1 and not v2.boton_pdf.isEnabled()
    v2.close()
    # Web antigua (sin el expediente): se avisa de que falta publicarla.
    falsa.revocado, falsa.con_expediente = False, False
    v3 = E.abrir(padre, cli, "c1", "#101")
    assert "falta publicar" in v3.aviso.text() and "Skive medial 4 mm" in v3.texto_receta.toPlainText()
    v3.close()
    padre.deleteLater()
    app.processEvents()


def test_ver_pedido_desde_fresado_y_confeccion(falsa, monkeypatch, stl_sintetico):
    from PySide6.QtWidgets import QMessageBox

    from interfaz import expediente as E

    app, v = _ventana(falsa, monkeypatch)
    monkeypatch.setattr(E.VentanaExpediente, "SINCRONO", True)
    mensajes = []
    monkeypatch.setattr(QMessageBox, "information", staticmethod(lambda *a, **k: mensajes.append(a[2])))
    v.abrir(str(stl_sintetico), esperar=True)
    assert not v.boton_ver_pedido.isEnabled()
    v.caja_pedido.setText("101")
    assert v.boton_ver_pedido.isEnabled()
    v.ver_pedido()  # sin haber entrado: se dice cómo
    assert "Confección" in mensajes[-1]
    c = v.confeccion
    assert c.entrar("taller@ortosend.es", "clave")
    v.ver_pedido()
    exp = v._expedientes["c1"]
    assert "Skive medial 4 mm" in exp.texto_receta.toPlainText()
    exp.close()
    v.caja_pedido.setText("999")
    v.ver_pedido()
    assert "999" in mensajes[-1]
    # En Confección: el diagnóstico en la hoja y el botón de la receta y el estudio.
    c.elegir("c2")
    assert "Pie plano valgo" in c.texto_pauta.text() and c.boton_expediente.isVisibleTo(c)
    c.ver_expediente()
    assert "c2" in v._expedientes
    v._expedientes["c2"].close()
    app.processEvents()
    _limpiar(v)


def test_placa_de_cada_maquina_en_la_web(falsa, monkeypatch, stl_sintetico):
    """La placa se guarda en la web por máquina: sin conexión se apunta y se manda al volver; desde otro
    ordenador se ve igual."""
    from interfaz.tirada import VentanaTirada
    from ortomolde import placa

    app, v = _ventana(falsa, monkeypatch)
    monkeypatch.setattr(VentanaTirada, "SINCRONO", True)
    v.taller["calculo"]["rejilla"] = 1.0
    v.abrir(str(stl_sintetico), esperar=True)
    t = v.abrir_tirada()
    assert "Solo en este ordenador" in t.texto_nube.text()
    assert v.confeccion.entrar("taller@ortosend.es", "clave")
    t.anadir_maquina("CNC taller")
    maq = falsa.maquinas_cnc["maq1"]
    assert t.estado["maquina"]["nombre"] == "CNC taller" and len(maq["placas"]) == 1  # su placa, subida
    assert "guardada en la web" in t.texto_nube.text()
    # Inicio: la tirada va a la web.
    t.anadir_abierto()
    t.calcular(esperar=True)
    t.iniciar("L-01")
    assert [x["nombre"] for x in maq["placas"][0]["tiradas"]] == ["L-01"]
    # Sin conexión: se apunta aquí y se manda al volver (sin duplicar).
    url = v.confeccion.web.url
    v.confeccion.web.url = "http://127.0.0.1:9"
    t.anadir_abierto()
    t.calcular(esperar=True)
    t.iniciar("L-02")
    assert len(t.estado["pendientes"]) == 1 and "sin enviar" in t.texto_nube.text()
    assert len(placa.cargar_estado(600, 500, 45)["pendientes"]) == 1  # guardado aunque se cierre el programa
    v.confeccion.web.url = url
    t.sincronizar()
    t.sincronizar()
    assert [x["nombre"] for x in maq["placas"][0]["tiradas"]] == ["L-01", "L-02"] and not t.estado["pendientes"]
    zonas = len(t.placa["zonas"])
    v.cnc_parar()
    t.close()
    # Otro ordenador (sin nada guardado): elige la máquina y ve la misma placa.
    placa.ruta().unlink()
    v.tirada = None
    t2 = v.abrir_tirada()
    t2.sincronizar()
    assert [t2.combo_maquina.itemText(i) for i in range(t2.combo_maquina.count())][1:] == ["CNC taller"]
    t2.elegir_maquina({"id": "maq1", "nombre": "CNC taller"})
    assert len(t2.placa["zonas"]) == zonas and t2._usadas()
    # Deshacer la última desde aquí: en la web queda anulada.
    t2.deshacer_ultima_tirada()
    assert [x["nombre"] for x in maq["placas"][0]["tiradas"] if not x.get("anulada")] == ["L-01"]
    t2.close()
    _limpiar(v)
