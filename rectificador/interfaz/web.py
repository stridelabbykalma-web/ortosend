"""Conexión con la web de Ortosend para el apartado «Confección».

El programa entra con el usuario de TALLER de la web (la primera vez) y guarda un token de 30 días.
Con él lee los pedidos del taller (en el orden en que deben salir), su pauta y su hoja de confección,
guarda la hoja, cambia el estado (molde fresado, confección terminada) y edita la lista de materiales.
Todo va por la API `/api/taller/...` de la web (src/app/api/taller en la web). Los costes y precios no
llegan aquí: solo los ve el administrador en la web. Los vídeos, fotos y la receta firmada (PDF) del
expediente se bajan con `bajar` (rutas /api/media/… y /api/rx-pdf/… de la web, con el mismo token).
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request


class ErrorWeb(RuntimeError):
    """Error con mensaje para la persona (en español) y el código HTTP (0 = sin conexión)."""

    def __init__(self, mensaje: str, status: int = 0):
        super().__init__(mensaje)
        self.status = status


class ClienteWeb:
    def __init__(self, url: str, token: str | None = None, espera: float = 20.0):
        self.url = url.rstrip("/")
        self.token = token
        self.espera = espera

    # ------------------------------------------------------------------ peticiones

    def _pedir(self, metodo: str, ruta: str, datos=None, con_sesion: bool = True) -> dict:
        cuerpo = None if datos is None else json.dumps(datos).encode("utf-8")
        cabeceras = {"Accept": "application/json"}
        if cuerpo is not None:
            cabeceras["Content-Type"] = "application/json"
        if con_sesion:
            if not self.token:
                raise ErrorWeb("Entra con tu usuario de taller de la web.", 401)
            cabeceras["Authorization"] = f"Bearer {self.token}"
        peticion = urllib.request.Request(f"{self.url}/api/taller{ruta}", data=cuerpo, headers=cabeceras,
                                          method=metodo)
        try:
            with urllib.request.urlopen(peticion, timeout=self.espera) as r:
                tipo = r.headers.get("Content-Type", "")
                texto = r.read().decode("utf-8", errors="replace")
                if "html" in tipo or texto.lstrip().startswith("<"):
                    # Una página en vez de datos: esa parte aún no está en la web publicada. Como un
                    # fallo pasajero (503): lo pendiente se guarda y se manda cuando la web la tenga.
                    raise ErrorWeb("La web de Ortosend aún no tiene esta parte: falta publicar su "
                                   "actualización.", 503)
                return json.loads(texto or "{}")
        except ValueError as e:
            raise ErrorWeb("La web ha contestado algo que no se entiende.", 0) from e
        except Exception as e:  # noqa: BLE001 - se traduce a un mensaje para la persona
            raise self._error(e) from e

    @staticmethod
    def _error(e: Exception) -> Exception:
        """El error de la petición con un mensaje claro (o el mismo error si no es de conexión)."""
        if isinstance(e, urllib.error.HTTPError):
            texto = e.read().decode("utf-8", "replace")
            try:
                mensaje = json.loads(texto).get("error")
            except (ValueError, AttributeError):
                mensaje = None
            if mensaje is None and e.code in (404, 405):
                # La página existe pero no es la API: la web aún no tiene esta parte publicada.
                return ErrorWeb("La web de Ortosend aún no tiene la conexión del taller (falta publicar su "
                                "actualización).", e.code)
            return ErrorWeb(mensaje or f"La web ha contestado «{e.code} {e.reason}».", e.code)
        if isinstance(e, (urllib.error.URLError, TimeoutError, ConnectionError, OSError)):
            return ErrorWeb("No hay conexión con la web de Ortosend (¿hay internet?).", 0)
        return e

    def bajar(self, ruta: str) -> tuple[bytes, str]:
        """Un archivo del expediente (vídeo, foto o la receta firmada en PDF): (contenido, tipo)."""
        if not self.token:
            raise ErrorWeb("Entra con tu usuario de taller de la web.", 401)
        url = ruta if ruta.startswith("http") else f"{self.url}{ruta}"
        peticion = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}"})
        try:
            with urllib.request.urlopen(peticion, timeout=max(self.espera, 60.0)) as r:
                return r.read(), r.headers.get_content_type()
        except Exception as e:  # noqa: BLE001 - se traduce a un mensaje para la persona
            error = self._error(e)
            if isinstance(error, ErrorWeb) and error.status == 404:
                error = ErrorWeb("Ese archivo ya no está en la web.", 404)
            elif isinstance(error, ErrorWeb) and error.status == 401:
                error = ErrorWeb("Sesión caducada: vuelve a entrar con tu usuario de taller", 401)
            raise error from e

    # ------------------------------------------------------------------ sesión

    def entrar(self, email: str, contrasena: str) -> str:
        """Devuelve el nombre del usuario y deja el token en `self.token`."""
        r = self._pedir("POST", "/sesion", {"email": email, "password": contrasena}, con_sesion=False)
        self.token = r["token"]
        return r.get("nombre", "")

    # ------------------------------------------------------------------ pedidos

    def pedidos(self) -> list[dict]:
        return self._pedir("GET", "/pedidos")["pedidos"]

    def pedido(self, id_: str) -> dict:
        return self._pedir("GET", f"/pedidos/{id_}")

    def buscar_pedido(self, numero: int) -> str | None:
        """El id del pedido con ese número (de los que están en el taller), o None."""
        return next((p["id"] for p in self.pedidos() if p.get("numero") == numero), None)

    def guardar_hoja(self, id_: str, hoja: dict) -> dict:
        return self._pedir("PUT", f"/pedidos/{id_}/hoja", hoja)["hoja"]

    def marcar_fresado(self, id_: str, lote: str) -> dict:
        return self._pedir("POST", f"/pedidos/{id_}/fresado", {"lote": lote})

    def marcar_confeccion(self, id_: str, material: str) -> dict:
        return self._pedir("POST", f"/pedidos/{id_}/confeccion", {"material": material})

    # ------------------------------------------------------------------ máquinas CNC y su placa

    def maquinas(self) -> list[dict]:
        return self._pedir("GET", "/maquinas")["maquinas"]

    def crear_maquina(self, nombre: str) -> dict:
        return self._pedir("POST", "/maquinas", {"nombre": nombre})["maquina"]

    def enviar_operacion(self, maquina_id: str, op: dict) -> dict:
        """Una operación de la placa (placa nueva, tirada o deshacer). Devuelve la máquina actualizada."""
        if op["op"] == "placa":
            datos = {k: op[k] for k in ("id", "ancho", "largo", "alto")}
            return self._pedir("POST", f"/maquinas/{maquina_id}/placa", datos)["maquina"]
        if op["op"] == "tirada":
            datos = {k: op[k] for k in ("id", "placaId", "nombre", "zonas")}
            return self._pedir("POST", f"/maquinas/{maquina_id}/tiradas", datos)["maquina"]
        if op["op"] == "anular":
            return self._pedir("POST", f"/maquinas/{maquina_id}/tiradas/{op['tiradaId']}/anular", {})["maquina"]
        raise ValueError(f"Operación desconocida: {op['op']}")

    # ------------------------------------------------------------------ materiales y ajustes

    def materiales(self) -> list[dict]:
        return self._pedir("GET", "/materiales")["materiales"]

    def guardar_materiales(self, materiales: list[dict]) -> list[dict]:
        return self._pedir("PUT", "/materiales", {"materiales": materiales})["materiales"]
