// Latido del puente (cada minuto): deja constancia de que está en marcha y
// manda sus últimas líneas de actividad, que el panel enseña junto al puente.
// Así se sabe desde Ortosend si el PC del escáner va bien sin ir a mirarlo.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyScanToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LOG = 6000;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const agentId = token ? await verifyScanToken(token) : null;
  const agent = agentId ? await prisma.scanAgent.findUnique({ where: { id: agentId } }) : null;
  if (!agent || agent.revokedAt) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  let lineas: string[] = [];
  try {
    const body = (await req.json()) as { log?: unknown };
    if (Array.isArray(body.log)) lineas = body.log.filter((l) => typeof l === "string").map((l) => l.slice(0, 300));
  } catch {
    // sin cuerpo: solo latido
  }
  const texto = lineas.join("\n").slice(-MAX_LOG);
  await prisma.scanAgent.update({
    where: { id: agent.id },
    data: { lastSeenAt: new Date(), ...(texto ? { lastLog: texto } : {}) },
  });
  return NextResponse.json({ ok: true });
}
