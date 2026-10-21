"""Conexión con la web de Ortosend para el apartado «Confección».

El programa entra con el usuario de TALLER de la web (la primera vez) y guarda un token de 30 días.
Con él lee los pedidos del taller (en el orden en que deben salir), su pauta y su hoja de confección,
guarda la hoja, cambia el estado (molde fresado, confección terminada) y edita la lista de materiales.
Todo va por la API `/api/taller/...` de la web (src/app/api/taller en la web). Los costes y precios no
llegan aquí: solo los ve el administrador en la web.
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
                return json.loads(r.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            texto = e.read().decode("utf-8", "replace")
            try:
                mensaje = json.loads(texto).get("error")
            except (ValueError, AttributeError):
                mensaje = None
            if mensaje is None and e.code in (404, 405):
                # La página existe pero no es la API: la web aún no tiene esta parte publicada.
                raise ErrorWeb("La web de Ortosend aún no tiene la conexión del taller (falta publicar su "
                               "actualización).", e.code) from e
            raise ErrorWeb(mensaje or f"La web ha contestado «{e.code} {e.reason}».", e.code) from e
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            raise ErrorWeb("No hay conexión con la web de Ortosend (¿hay internet?).", 0) from e
        except ValueError as e:
            raise ErrorWeb("La web ha contestado algo que no se entiende.", 0) from e

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

    def guardar_hoja(self, id_: str, hoja: dict) -> dict:
        return self._pedir("PUT", f"/pedidos/{id_}/hoja", hoja)["hoja"]

    def marcar_fresado(self, id_: str, lote: str) -> dict:
        return self._pedir("POST", f"/pedidos/{id_}/fresado", {"lote": lote})

    def marcar_confeccion(self, id_: str, material: str) -> dict:
        return self._pedir("POST", f"/pedidos/{id_}/confeccion", {"material": material})

    # ------------------------------------------------------------------ materiales y ajustes

    def materiales(self) -> list[dict]:
        return self._pedir("GET", "/materiales")["materiales"]

    def guardar_materiales(self, materiales: list[dict]) -> list[dict]:
        return self._pedir("PUT", "/materiales", {"materiales": materiales})["materiales"]
