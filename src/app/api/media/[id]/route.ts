// Servido autenticado de capturas (datos de salud): mismo control de acceso
// que el expediente + registro de acceso RGPD en AuditLog. Con la sesión de la web
// o con el token de Ortosend Taller (programa del taller).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { usuarioPeticion } from "@/lib/api-taller";
import { audit } from "@/lib/cases";
import { esCentral } from "@/lib/rx-route";
import { TALLER_STATES } from "@/lib/taller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await usuarioPeticion(req);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    include: {
      blob: true,
      capture: { include: { case: { include: { clinic: true, prescription: { select: { prescriberId: true } } } } } },
    },
  });
  if (!asset) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const kase = asset.capture.case;
  // Mismas ventanas que la ficha del caso y la receta en PDF: el recetador central mientras
  // valora (o si la receta es suya) y el taller desde que hay pedido; no cualquier caso.
  const allowed =
    user.role === "ADMIN" ||
    (user.role === "TALLER" && ([...TALLER_STATES, "ENTREGADO", "CERRADO"] as string[]).includes(kase.state)) ||
    ((user.role === "PROFESIONAL" || user.role === "ADMIN_CLINICA") &&
      user.clinicId === kase.clinicId) ||
    (user.role === "RECETADOR" &&
      esCentral(kase) &&
      (["EN_PRESCRIPCION", "EN_CONTACTO"].includes(kase.state) || kase.prescription?.prescriberId === user.id));
  if (!allowed) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  await audit(user.id, "media.view", `case:${kase.number}:${asset.kind}`, kase.patientId);

  if (!asset.blob) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return new NextResponse(Buffer.from(asset.blob.bytes), {
    headers: {
      "Content-Type": asset.blob.mime,
      "Content-Length": String(asset.blob.bytes.length),
      "Content-Disposition": `inline; filename="${asset.kind}"`,
      // Datos de salud: que no se queden en la caché del navegador (ordenadores compartidos) y
      // que nunca se interpreten como otra cosa que lo que son.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; media-src 'self'; img-src 'self'; sandbox",
    },
  });
}
