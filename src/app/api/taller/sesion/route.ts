// Entrada del Rectificador (programa del taller) con el usuario de TALLER de la web.
// Devuelve un token de 30 días para la cabecera Authorization (ver src/lib/auth.ts).
import { prisma } from "@/lib/db";
import { createAppToken, verifyPassword, APP_DAYS } from "@/lib/auth";
import { audit } from "@/lib/cases";
import { normalizeIdentifier } from "@/lib/contacto";
import { cuerpo, responder } from "@/lib/api-taller";
import { ErrorTaller } from "@/lib/taller-ops";
import { claveIp, limitar, origenPeticion } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return responder(async () => {
    // Freno a la fuerza bruta contra las cuentas del taller: 10 por minuto y IP.
    const { ip, sinPeticion } = await origenPeticion();
    if (!sinPeticion && !(await limitar(claveIp("taller-sesion", ip), 10, 60)))
      throw new ErrorTaller("Demasiados intentos. Espera un minuto.", 429);
    const e = (await cuerpo(req)) as { email?: unknown; password?: unknown };
    // Igual que la entrada del equipo en la web: email o móvil.
    const id = typeof e.email === "string" && e.email.trim().length >= 3 ? normalizeIdentifier(e.email) : "";
    const password = typeof e.password === "string" ? e.password : "";
    const user = id ? await prisma.user.findFirst({ where: { OR: [{ email: id }, { phone: id }] } }) : null;
    const ok = !!user?.passwordHash && user.active && (await verifyPassword(password, user.passwordHash));
    if (!user || !ok) throw new ErrorTaller("Email o contraseña incorrectos", 401);
    if (user.role !== "TALLER" && user.role !== "ADMIN")
      throw new ErrorTaller("Este usuario no es del taller", 403);
    await audit(user.id, "app.login", "rectificador");
    return { token: await createAppToken(user), nombre: user.name, rol: user.role, dias: APP_DAYS };
  });
}
