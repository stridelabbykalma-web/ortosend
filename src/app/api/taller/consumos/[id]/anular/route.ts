// Anula un material registrado por error (no se borra: queda quién, cuándo y por qué).
import { cuerpo, responder, usuarioApp } from "@/lib/api-taller";
import { anularConsumo } from "@/lib/taller-ops";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    const u = await usuarioApp(req);
    const e = (await cuerpo(req)) as { motivo?: unknown };
    await anularConsumo((await params).id, u, typeof e.motivo === "string" ? e.motivo : "");
    return { ok: true };
  });
}
