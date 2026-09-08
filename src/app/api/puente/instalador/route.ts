// Instalador del puente para el PC del escáner, generado con el servidor y el
// token de este puente ya puestos. El administrador de la clínica lo descarga
// desde Panel → Puente de escaneo y lo ejecuta con doble clic en Windows: el
// .bat lanza public/puente/instalar.ps1, que instala Node, copia el puente,
// detecta la carpeta de Revo Scan y lo deja arrancando solo.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createScanToken, requireRole } from "@/lib/auth";
import { audit } from "@/lib/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let user;
  try {
    user = await requireRole("ADMIN_CLINICA");
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  const agent = await prisma.scanAgent.findUnique({ where: { id: url.searchParams.get("agent") ?? "" } });
  if (!agent || agent.clinicId !== user.clinicId || agent.revokedAt)
    return NextResponse.json({ error: "Puente desconocido" }, { status: 404 });

  const servidor = process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`;
  const token = await createScanToken(agent.id);
  await audit(user.id, "scanagent.installer", `agent:${agent.id}`);

  // CRLF y sin BOM: es lo que espera cmd.exe.
  const bat = [
    "@echo off",
    "title Ortosend - instalador del puente de escaneo",
    "echo Instalando el puente de escaneo de Ortosend en este PC...",
    "echo.",
    `set "SERVIDOR=${servidor}"`,
    `set "TOKEN=${token}"`,
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing '%SERVIDOR%/puente/instalar.ps1' -OutFile \\"$env:TEMP\\instalar-puente.ps1\\"; & \\"$env:TEMP\\instalar-puente.ps1\\" -Servidor '%SERVIDOR%' -Token '%TOKEN%'"`,
    "echo.",
    "pause",
    "",
  ].join("\r\n");

  return new NextResponse(bat, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="instalar-puente-ortosend-${agent.name.replace(/[^a-zA-Z0-9-]+/g, "_").slice(0, 30)}.bat"`,
      "Cache-Control": "private, no-store",
    },
  });
}
