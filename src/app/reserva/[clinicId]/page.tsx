import { prisma } from "@/lib/db";
import { Flash } from "@/components/ui";
import { reservaAction } from "@/app/publico-actions";
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
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    include: { slots: { where: { caseId: null, startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } } },
  });
  if (!clinic || clinic.status !== "ACTIVA") {
    return (
      <div className="wrap">
        <div className="sp2" />
        <p>Clínica no encontrada.</p>
      </div>
    );
  }
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
      <form action={reservaAction}>
        <input type="hidden" name="clinicId" value={clinic.id} />
        <div className="card">
          <b>1. Elige tu hora</b>
          <div className="grid g4" style={{ marginTop: 10 }}>
            {clinic.slots.map((s) => (
              <label key={s.id} className="slotlabel">
                <input type="radio" name="slotId" value={s.id} required />
                {fmtdt(s.startsAt)}
              </label>
            ))}
          </div>
          {clinic.slots.length === 0 && (
            <div className="note a" style={{ marginTop: 8 }}>
              Esta clínica no tiene huecos publicados ahora mismo.
            </div>
          )}
        </div>
        <div className="sp" />
        <div className="card">
          <b>2. Tus datos</b>
          <label>Nombre y apellidos</label>
          <input name="name" required />
          <div className="grid g2">
            <div>
              <label>Móvil (será tu vía de contacto por WhatsApp)</label>
              <input name="phone" required />
            </div>
            <div>
              <label>Email</label>
              <input name="email" type="email" required />
            </div>
          </div>
          <div className="grid g2">
            <div>
              <label>Fecha de nacimiento</label>
              <input name="birth" type="date" />
            </div>
            <div>
              <label>Motivo (opcional)</label>
              <select name="motivo" defaultValue="Dolor">
                <option>Dolor</option>
                <option>Deporte</option>
                <option>Prevención / revisión</option>
                <option>Renovación de plantillas</option>
              </select>
            </div>
          </div>
          <label>Crea tu contraseña (para seguir tu tratamiento en tu panel)</label>
          <input name="password" type="password" minLength={8} required />
          <label className="chk">
            <input type="checkbox" name="consentSalud" required /> Consiento el tratamiento de mis
            datos de salud para la prestación del servicio (RGPD).
          </label>
          <label className="chk">
            <input type="checkbox" name="consentWhatsApp" /> Acepto recibir comunicaciones del
            servicio por WhatsApp.
          </label>
        </div>
        <div className="sp" />
        <button type="submit" className="pri wfull" disabled={clinic.slots.length === 0}>
          Confirmar reserva gratuita
        </button>
      </form>
      <div className="sp2" />
    </div>
  );
}
