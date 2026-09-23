import Link from "next/link";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { Flash } from "@/components/ui";
import { ReservaForm } from "@/components/reserva-form";
import { HOLD_COOKIE } from "@/lib/reserva";
import { fmtdt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReservaPage({
  params,
  searchParams,
}: {
  params: Promise<{ clinicId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { clinicId } = await params;
  const { error } = await searchParams;
  const now = new Date();
  const holdKey = (await cookies()).get(HOLD_COOKIE)?.value ?? null;
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    include: {
      // Huecos libres: sin caso y sin bloqueo vigente de otro navegador.
      slots: {
        where: {
          caseId: null,
          startsAt: { gt: now },
          OR: [{ holdUntil: null }, { holdUntil: { lt: now } }, ...(holdKey ? [{ holdKey }] : [])],
        },
        orderBy: { startsAt: "asc" },
      },
    },
  });
  if (!clinic || clinic.status !== "ACTIVA") {
    return (
      <div className="wrap">
        <div className="sp2" />
        <p>Clínica no encontrada.</p>
      </div>
    );
  }
  const user = await getSessionUser();
  const cuenta =
    user?.role === "CLIENTE"
      ? {
          nombre: user.name,
          personas: (
            await prisma.patient.findMany({
              where: { ownerId: user.id },
              orderBy: [{ isMinor: "asc" }, { name: "asc" }],
              select: { id: true, name: true, isMinor: true },
            })
          ).map((p) => ({ id: p.id, name: p.name, isMinor: p.isMinor })),
        }
      : null;

  return (
    <div className="wrap" style={{ maxWidth: 640 }}>
      <div className="sp2" />
      <h2>Reserva tu cita — {clinic.name}</h2>
      <div className="muted">
        {clinic.address} · La cita y el estudio son gratuitos. Solo pagarás si un profesional
        prescribe tu tratamiento.
      </div>
      <div className="sp" />
      <Flash error={error} />
      {user && user.role !== "CLIENTE" ? (
        <div className="note a">
          Has iniciado sesión con una cuenta profesional ({user.name}). Cierra sesión para reservar
          una cita como cliente.
        </div>
      ) : (
        <>
          {!user && (
            <div className="tiny" style={{ marginBottom: 10 }}>
              ¿Ya tienes cuenta en Ortosend?{" "}
              <Link href={`/login?next=${encodeURIComponent(`/reserva/${clinic.id}`)}`}>Inicia sesión</Link>{" "}
              y reserva sin volver a registrarte (también para un menor a tu cargo).
            </div>
          )}
          <ReservaForm
            clinicId={clinic.id}
            slots={clinic.slots.map((s) => ({ id: s.id, label: fmtdt(s.startsAt) }))}
            cuenta={cuenta}
          />
        </>
      )}
      <div className="sp2" />
    </div>
  );
}
