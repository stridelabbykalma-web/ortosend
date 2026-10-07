// Estado en vivo de las altas de la clínica (el panel lo consulta cada 3 s).
// Solo estados y progreso: ningún dato de salud.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { estadoPanel } from "@/lib/alta";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = await getSessionUser();
  if (!u || (u.role !== "PROFESIONAL" && u.role !== "ADMIN_CLINICA") || !u.clinicId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ids = new URL(req.url).searchParams.get("ids");
  const pacientes = await estadoPanel(u.clinicId, ids ? ids.split(",").slice(0, 100) : undefined);
  return NextResponse.json({ pacientes }, { headers: { "Cache-Control": "no-store" } });
}
