// Servido autenticado de capturas (datos de salud): mismo control de acceso
// que el expediente + registro de acceso RGPD en AuditLog.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/cases";
import { esCentral } from "@/lib/rx-route";
import { descargaDe } from "@/lib/escaneos";

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
  if (!asset) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const kase = asset.capture.case;
  const allowed =
    user.role === "ADMIN" ||
    user.role === "TALLER" ||
    ((user.role === "PROFESIONAL" || user.role === "ADMIN_CLINICA") &&
      user.clinicId === kase.clinicId) ||
    (user.role === "RECETADOR" && esCentral(kase));
  if (!allowed) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  await audit(user.id, "media.view", `case:${kase.number}:${asset.kind}`);

  // Escaneo de las espumas: el binario vive en R2 (redirección a URL firmada
  // de 10 min) o, sin R2, en la propia bandeja de escaneos.
  const uploadId = (asset.meta as { uploadId?: string } | null)?.uploadId;
  if (uploadId) {
    const d = await descargaDe(uploadId);
    if (!d) return NextResponse.json({ error: "Archivo no disponible" }, { status: 404 });
    if ("redirect" in d) return NextResponse.redirect(d.redirect, 302);
    return new NextResponse(new Uint8Array(d.bytes), {
      headers: {
        "Content-Type": d.mime,
        "Content-Length": String(d.bytes.length),
        "Content-Disposition": `attachment; filename="${d.filename}"`,
        "Cache-Control": "private, no-store",
        // Guardado comprimido: el navegador lo descomprime al descargar.
        ...(d.encoding ? { "Content-Encoding": d.encoding } : {}),
      },
    });
  }

  if (!asset.blob) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return new NextResponse(Buffer.from(asset.blob.bytes), {
    headers: {
      "Content-Type": asset.blob.mime,
      "Content-Length": String(asset.blob.bytes.length),
      "Content-Disposition": `inline; filename="${asset.kind}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
