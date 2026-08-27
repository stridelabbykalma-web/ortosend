// Alta en la lista de espera de zonas sin cobertura (desde el buscador en vivo).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { zone?: string; contact?: string } | null;
  const contact = body?.contact?.trim();
  if (!contact) return NextResponse.json({ error: "Escribe un contacto" }, { status: 400 });
  await prisma.waitlistEntry.create({
    data: { zone: body?.zone?.trim() || "sin especificar", contact },
  });
  return NextResponse.json({ ok: true });
}
