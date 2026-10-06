"use server";

// /acceso: el paciente (o su tutor) crea su contraseña con DNI + móvil + código de WhatsApp.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { borrarAccesoPendiente, createSession, guardarAccesoPendiente, leerAccesoPendiente } from "@/lib/auth";
import { crearCuentaConCodigo, solicitarCodigo } from "@/lib/acceso";
import { enviarVerificacionEmail } from "@/lib/cuenta";
import { normalizeDni, normalizePhone } from "@/lib/contacto";
import { claveIp, limitar, origenPeticion } from "@/lib/rate-limit";

function fail(msg: string, paso = ""): never {
  redirect(`/acceso?${paso ? `paso=${paso}&` : ""}error=` + encodeURIComponent(msg));
}

async function frenar(prefijo: string, max: number) {
  const { ip } = await origenPeticion();
  if (!(await limitar(claveIp(prefijo, ip), max, 600))) fail("Demasiados intentos. Espera unos minutos.");
}

export async function solicitarCodigoAction(formData: FormData) {
  await frenar("acceso-codigo", 10);
  const dni = normalizeDni(String(formData.get("dni") ?? ""));
  const telefono = normalizePhone(String(formData.get("telefono") ?? ""));
  const r = await solicitarCodigo(dni, telefono);
  if (!r.ok) fail(r.error ?? "Revisa los datos");
  await guardarAccesoPendiente(dni, telefono);
  redirect("/acceso?paso=codigo");
}

export async function crearCuentaAction(formData: FormData) {
  await frenar("acceso-cuenta", 20);
  const pendiente = await leerAccesoPendiente();
  if (!pendiente) fail("Han pasado más de 15 minutos. Vuelve a escribir tu DNI y tu móvil.");
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("password2") ?? "")) fail("Las contraseñas no coinciden", "codigo");
  const r = await crearCuentaConCodigo(pendiente!.dni, pendiente!.telefono, String(formData.get("codigo") ?? ""), password);
  if (!r.ok) fail(r.error, "codigo");
  await borrarAccesoPendiente();
  if (!r.nueva)
    redirect(
      "/login?ok=" +
        encodeURIComponent("Ya tenías una cuenta con ese móvil: hemos añadido el perfil a ella. Entra con tu contraseña de siempre.")
    );
  const user = await prisma.user.findUniqueOrThrow({ where: { id: r.userId } });
  if (user.email) await enviarVerificacionEmail(user);
  await createSession(user.id);
  redirect("/panel?ok=" + encodeURIComponent("Contraseña creada. Ya puedes entrar con tu móvil y tu contraseña."));
}
