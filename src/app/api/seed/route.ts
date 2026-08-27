// Carga los datos de demo en un despliegue nuevo con una sola visita.
// Solo funciona con la base de datos VACÍA (sin usuarios): en cuanto hay datos
// reales, responde 409 y queda inerte. Pensado para probar la plataforma
// recién desplegada sin necesidad de terminal.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
// Módulo CJS compartido con `npx prisma db seed`
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { seedDemo } = require("../../../../prisma/seed-data.js");

export const dynamic = "force-dynamic";

export async function GET() {
  const users = await prisma.user.count();
  if (users > 0) {
    return NextResponse.json(
      { error: "La base de datos ya tiene datos; el seed solo funciona en vacío." },
      { status: 409 }
    );
  }
  await seedDemo(prisma);
  return NextResponse.json({
    ok: true,
    mensaje: "Datos de demo cargados. Ya puedes entrar en /login.",
    cuentas: [
      "admin@ortosend.com",
      "clinica@ortosend.com",
      "profesionalreceta@ortosend.com",
      "profesionalnoreceta@ortosend.com",
      "tecnico.cassa@ortosend.com",
      "recetador@ortosend.com",
      "taller@ortosend.com",
      "jordi@demo.com",
      "pere@demo.com",
    ],
    contrasena: "ortosend123",
  });
}
