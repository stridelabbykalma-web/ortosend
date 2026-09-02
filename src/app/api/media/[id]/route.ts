// Servido autenticado de capturas (datos de salud): mismo control de acceso
// que el expediente + registro de acceso RGPD en AuditLog.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    include: {
      blob: true,
      capture: { include: { case: { include: { clinic: true } } } },
    },
  });
  if (!asset?.blob) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const kase = asset.capture.case;
  const allowed =
    user.role === "ADMIN" ||
    user.role === "TALLER" ||
    ((user.role === "PROFESIONAL" || user.role === "ADMIN_CLINICA") &&
      user.clinicId === kase.clinicId) ||
    (user.role === "RECETADOR" && !kase.clinic.hasPrescriber);
  if (!allowed) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  await audit(user.id, "media.view", `case:${kase.number}:${asset.kind}`);
  return new NextResponse(Buffer.from(asset.blob.bytes), {
    headers: {
      "Content-Type": asset.blob.mime,
      "Content-Length": String(asset.blob.bytes.length),
      "Content-Disposition": `inline; filename="${asset.kind}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
