// Utilidades de la API del taller para Ortosend Taller (programa del taller): sesión por
// token (cabecera Authorization: Bearer) solo para usuarios TALLER o ADMIN, y respuestas
// JSON con el mensaje de error en español.
import type { User } from "@prisma/client";
import { verifyAppToken } from "./auth";
import { ErrorTaller } from "./taller-ops";

export async function usuarioApp(req: Request): Promise<User> {
  const cabecera = req.headers.get("authorization") ?? "";
  const token = cabecera.startsWith("Bearer ") ? cabecera.slice(7).trim() : "";
  const user = token ? await verifyAppToken(token) : null;
  if (!user) throw new ErrorTaller("Sesión caducada: vuelve a entrar con tu usuario de taller", 401);
  if (user.role !== "TALLER" && user.role !== "ADMIN") throw new ErrorTaller("Sin permiso", 403);
  return user;
}

export function json(datos: unknown, status = 200) {
  return Response.json(datos, { status, headers: { "Cache-Control": "no-store" } });
}

// Ejecuta el manejador y convierte los errores en respuestas JSON.
export async function responder(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (e) {
    if (e instanceof ErrorTaller) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Error interno del servidor" }, 500);
  }
}

export async function cuerpo(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ErrorTaller("El cuerpo de la petición no es JSON", 400);
  }
}
