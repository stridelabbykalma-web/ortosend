import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { pushEvent } from "@/lib/cases";
import { CAPTURA_KINDS, PASOS_CAPTURA } from "@/lib/captura-pasos";

export const dynamic = "force-dynamic";

// Límite del cuerpo en funciones serverless de Vercel (~4,5 MB). La captura guiada
// graba a bitrate contenido para quedar por debajo.
const MAX_BYTES = 4 * 1024 * 1024;
const MIMES = ["image/jpeg", "image/png", "image/webp", "video/webm", "video/mp4"];

// Subida REAL del modo captura guiado: el check verde del wizard sale de la fila
// confirmada que crea esta ruta — sin subida no hay confirmación.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !["PROFESIONAL", "ADMIN_CLINICA"].includes(user.role) || !user.clinicId)
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id: caseId } = await ctx.params;
  const kase = await prisma.case.findUnique({ where: { id: caseId }, include: { capture: true } });
  if (!kase || kase.clinicId !== user.clinicId)
    return NextResponse.json({ error: "Caso no accesible" }, { status: 404 });
  if (!["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"].includes(kase.state))
    return NextResponse.json({ error: "El estudio no está en curso" }, { status: 409 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Subida no válida" }, { status: 400 });
  }
  const kind = String(form.get("kind") ?? "");
  const file = form.get("file");
  const paso = PASOS_CAPTURA.find((p) => p.kind === kind);
  if (!CAPTURA_KINDS.includes(kind) || !paso)
    return NextResponse.json({ error: "Elemento de captura desconocido" }, { status: 400 });
  if (!(file instanceof Blob) || file.size === 0)
    return NextResponse.json({ error: "Falta el archivo de la captura" }, { status: 400 });
  if (file.size > MAX_BYTES)
    return NextResponse.json(
      { error: "Captura demasiado grande (máx. 4 MB) — repite la toma" },
      { status: 413 }
    );
  const mime = file.type.split(";")[0] || (paso.modo === "foto" ? "image/jpeg" : "video/webm");
  if (!MIMES.includes(mime))
    return NextResponse.json({ error: `Formato no admitido (${mime})` }, { status: 415 });

  const capture = kase.capture ?? (await prisma.capture.create({ data: { caseId } }));
  if (kase.state === "CITA_RESERVADA") {
    await prisma.case.update({ where: { id: caseId }, data: { state: "ESTUDIO_EN_CURSO" } });
    await pushEvent(caseId, "Estudio iniciado en clínica", user.name);
  }

  const data = new Uint8Array(await file.arrayBuffer());
  // Repetir una toma sustituye la anterior (misma kind, un asset por elemento).
  await prisma.$transaction([
    prisma.mediaAsset.deleteMany({ where: { captureId: capture.id, kind } }),
    prisma.mediaAsset.create({
      data: {
        captureId: capture.id,
        kind,
        url: `/api/casos/${caseId}/media/${kind}`,
        sizeBytes: file.size,
        mime,
        data,
        confirmedAt: new Date(), // check verde SOLO con confirmación del servidor
      },
    }),
  ]);
  return NextResponse.json({ ok: true, kind });
}
