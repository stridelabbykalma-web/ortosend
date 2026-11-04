// Alta en la lista de espera de zonas sin cobertura (desde el buscador en vivo).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { permitirPublico } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (!(await permitirPublico("waitlist")))
    return NextResponse.json({ error: "Demasiadas peticiones. Espera un minuto." }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { zone?: string; contact?: string; web_alternativa?: string } | null;
  // Campo trampa: una persona no lo rellena.
  if (body?.web_alternativa) return NextResponse.json({ ok: true });
  const contact = body?.contact?.trim().slice(0, 160);
  if (!contact) return NextResponse.json({ error: "Escribe un contacto" }, { status: 400 });
  await prisma.waitlistEntry.create({
    data: { zone: (body?.zone?.trim() || "sin especificar").slice(0, 120), contact },
  });
  return NextResponse.json({ ok: true });
}
