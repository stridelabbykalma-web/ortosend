"""Apartado «Confección» contra una web falsa que imita la API del taller de Ortosend."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from interfaz import web as W


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
        self.token = None
        self.peticiones = []
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
        return p

    def responder(self, metodo, ruta, cabeceras, cuerpo):
        self.peticiones.append((metodo, ruta))
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
                c = W.coste(cuerpo, self.materiales, self.ajustes)
                self.hojas[id_] = dict(cuerpo, coste={k: c[k] for k in ("materialCents", "fresadoCents", "manoObraCents", "totalCents")})
                return 200, {"hoja": self.hojas[id_]}
            if partes[2] == "fresado":
                if p["fase"] != "MECANIZADO":
                    return 409, {"error": "El caso no está en mecanizado"}
                p.update(fase="CONFECCION", paso="Confección", lote=cuerpo.get("lote") or p["lote"])
                return 200, self._detalle(id_)
            if partes[2] == "confeccion":
                if p["fase"] != "CONFECCION":
                    return 409, {"error": "El caso no está en confección"}
                if not cuerpo.get("material", "").strip():
                    return 400, {"error": "Registra el material/lote para trazabilidad"}
                p.update(estado="CALIDAD", material=cuerpo["material"])
                del self.pedidos[id_]
                return 200, {"ok": True, "numero": p["numero"], "estado": "CALIDAD"}
        return 404, {"error": "Caso no activo en taller"}

    def _manejador(self):
        falsa = self

        class M(BaseHTTPRequestHandler):
            def _atender(self, metodo):
                n = int(self.headers.get("Content-Length") or 0)
                cuerpo = json.loads(self.rfile.read(n) or b"{}") if n else {}
                status, datos = falsa.responder(metodo, self.path, dict(self.headers), cuerpo)
                texto = datos if isinstance(datos, str) else json.dumps(datos)
                self.send_response(status)
                self.send_header("Content-Type", "text/html" if isinstance(datos, str) else "application/json")
                self.end_headers()
                self.wfile.write(texto.encode())

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


def test_coste_igual_que_la_web():
    m = [{"id": "eva", "precioCents": 2500, "paresPorPlancha": 20}, {"id": "forro", "precioCents": 1800, "paresPorPlancha": 18}]
    a = {"precioHoraCents": 2000, "costeCncMinutoCents": 20, "costeMoldeCents": 300}
    c = W.coste({"capas": [{"materialId": "eva", "pies": "par"}, {"materialId": "forro", "pies": "par"},
                           {"materialId": "eva", "pies": "I"}], "minutosCnc": 30, "minutosConfeccion": 45}, m, a)
    # Los mismos números que el test de la web (tests/unit/taller.test.ts).
    assert c["capas"] == [125, 100, 63] and c["materialCents"] == 288
    assert (c["fresadoCents"], c["manoObraCents"], c["totalCents"]) == (900, 1500, 2688)
    assert W.euros(268800) == "2.688,00 €"


def test_ventana_confeccion(falsa, tmp_path, monkeypatch):
    from PySide6.QtWidgets import QApplication, QInputDialog

    from interfaz.confeccion import VentanaConfeccion
    from interfaz.principal import VentanaPrincipal

    app = QApplication.instance() or QApplication([])
    v = VentanaPrincipal()
    for k in ("web_token", "web_usuario", "web_cache"):
        v.ajustes.remove(k)
    v.taller = {**v.taller, "web": {"url": falsa.url}}
    monkeypatch.setattr(VentanaConfeccion, "SINCRONO", True)
    c = v.abrir_confeccion()
    assert c.boton_sesion.text() == "Entrar" and c.lista.count() == 0
    assert c.entrar("taller@ortosend.es", "clave")
    assert "Toni Taller" in c.texto_sesion.text()
    # Lista en el orden de la web, con su semáforo.
    assert c.lista.count() == 2 and c.lista.item(0).text().startswith("#101  Ana Ruiz")
    assert "Fuera de plazo" in c.lista.item(0).text()
    c.botones_filtro["fresar"].setChecked(True)
    assert c.lista.count() == 1 and "#102" in c.lista.item(0).text()
    c.botones_filtro["todos"].setChecked(True)
    # Hoja del pedido 101: pauta por pie y coste en vivo.
    c.lista.setCurrentRow(0)
    assert c.pedido["id"] == "c1" and "Skive medial 4 mm" in c.texto_pauta.text()
    assert c.boton_terminado.isVisibleTo(c) and not c.boton_fresado.isVisibleTo(c)
    assert c.caja_cnc.value() == 30 and c.caja_confeccion.value() == 45  # los de por defecto
    c.anadir_capa({"materialId": "eva", "pies": "par"})
    c.anadir_capa({"materialId": "forro", "pies": "par", "notas": "negro"})
    c.botones_proceso["CAPAS"].setChecked(True)
    assert c.ultimo_coste["totalCents"] == 125 + 100 + 900 + 1500
    assert "26,25 €" in c.texto_coste.text()
    c.guardar_hoja()
    assert falsa.hojas["c1"]["proceso"] == "CAPAS" and falsa.hojas["c1"]["capas"][1]["notas"] == "negro"
    # Hoja impresa (PDF).
    pdf = tmp_path / "hoja.pdf"
    c.guardar_pdf(str(pdf))
    assert pdf.stat().st_size > 1000 and "Skive medial 4 mm" in c.html_hoja()
    # Confección terminada → sale de la lista (pasa a calidad en la web).
    monkeypatch.setattr(QInputDialog, "getText", staticmethod(lambda *a, **k: ("EVA lote M-9", True)))
    c.marcar_terminado()
    assert "c1" not in falsa.pedidos and c.lista.count() == 1 and c.pedido is None
    # Molde fresado (102) → confección, con su lote.
    c.lista.setCurrentRow(0)
    c.marcar_fresado("L-08")
    assert falsa.pedidos["c2"]["fase"] == "CONFECCION" and falsa.pedidos["c2"]["lote"] == "L-08"
    assert c.boton_terminado.isVisibleTo(c)
    # Sin internet: se ve la última lista guardada.
    c2 = VentanaConfeccion(v)
    assert c2.lista.count() == 1 and "guardada" in c2.texto_lista.text()
    # La sesión caducada (otro token en la web) desconecta y pide entrar.
    falsa.token = "otro"
    monkeypatch.setattr("PySide6.QtWidgets.QMessageBox.warning", staticmethod(lambda *a, **k: None))
    c.actualizar()
    assert c.web.token is None and c.boton_sesion.text() == "Entrar"
    for k in ("web_token", "web_usuario", "web_cache", "web_email"):
        v.ajustes.remove(k)
    v.close()


def test_materiales_editables(falsa, monkeypatch):
    from PySide6.QtWidgets import QApplication

    from interfaz.confeccion import DialogoMateriales

    app = QApplication.instance() or QApplication([])
    d = DialogoMateriales(None, falsa.materiales)
    assert d.tabla.rowCount() == 2
    d.tabla.cellWidget(0, 6).setValue(30.0)  # EVA a 30 €
    d.anadir()
    d.tabla.item(2, 0).setText("Corcho 3 mm")
    d.tabla.cellWidget(2, 7).setValue(10)
    lista = d.materiales()
    assert lista[0]["id"] == "eva" and lista[0]["precioCents"] == 3000
    assert lista[2]["nombre"] == "Corcho 3 mm" and "id" not in lista[2] and lista[2]["paresPorPlancha"] == 10
    assert lista[1]["dureza"] is None and lista[1]["planchaAnchoMm"] is None
