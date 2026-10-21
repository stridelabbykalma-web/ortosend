// Job diario (Vercel Cron u otro programador): caducidad de enlaces de pago (30 días)
// y recordatorios de pago (días 3/7/15). Proteger con CRON_SECRET en producción.
import { NextResponse } from "next/server";
import { runJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  // En producción el secreto es obligatorio: sin él no se ejecuta nada.
  if (!secret && process.env.NODE_ENV === "production")
    return NextResponse.json({ error: "CRON_SECRET sin configurar" }, { status: 503 });
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runJobs();
  return NextResponse.json(result);
}
