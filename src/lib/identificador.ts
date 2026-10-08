// Localiza una cuenta por email o por móvil. El email es la identidad; el móvil
// puede compartirse (pareja, familia), así que solo identifica si es de una única cuenta.
import { prisma } from "@/lib/db";

export async function buscarCuenta(id: string) {
  const porEmail = await prisma.user.findUnique({ where: { email: id } });
  if (porEmail) return porEmail;
  const porMovil = await prisma.user.findMany({ where: { phone: id }, take: 2 });
  return porMovil.length === 1 ? porMovil[0] : null;
}
