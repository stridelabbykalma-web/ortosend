// Reserva online (Flujo A) con calendario real de la clínica.
// - Visitante: elige hueco, crea su cuenta y su caso queda en CITA_RESERVADA.
// - Cliente con sesión: reserva para sí mismo o para otro paciente a su cargo,
//   o cambia la cita de un caso suyo (?caso=…).
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { Flash } from "@/components/ui";
import { Calendario } from "@/components/reserva/calendario";
import { reservaAction, reservaClienteAction } from "@/app/publico-actions";
import { reprogramarCitaAction } from "@/app/panel/cliente-actions";
import { activeAppointmentOf } from "@/lib/agenda-db";
import { fmtdt } from "@/lib/format";
import { APPOINTMENT_KIND_LABEL } from "@/lib/agenda";

export const dynamic = "force-dynamic";

export default async function ReservaPage({
  params,
  searchParams,
}: {
  params: Promise<{ clinicId: string }>;
  searchParams: Promise<{ error?: string; caso?: string }>;
}) {
  const { clinicId } = await params;
  const { error, caso } = await searchParams;
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
  if (!clinic || clinic.status !== "ACTIVA") {
    return (
      <div className="wrap">
        <div className="sp2" />
        <p>Clínica no encontrada.</p>
      </div>
    );
  }
  const user = await getSessionUser();

  const cabecera = (
    <>
      <div className="sp2" />
      <h2>Reserva tu cita — {clinic.name}</h2>
      <div className="muted">
        {clinic.address} · La cita y el estudio son gratuitos. Solo pagarás si un profesional
        prescribe tu tratamiento. Duración aproximada: {clinic.slotMinutes} min.
      </div>
      <div className="sp" />
      <Flash error={error} />
    </>
  );

  if (!clinic.onlineBooking) {
    return (
      <div className="wrap" style={{ maxWidth: 720 }}>
        {cabecera}
        <div className="note a">
          Esta clínica no admite reservas online por ahora. Contacta con ella directamente o{" "}
          <Link href="/buscar">elige otra clínica cercana</Link>.
        </div>
      </div>
    );
  }

  // Personal de clínica u otros roles: la reserva se hace desde el panel.
  if (user && user.role !== "CLIENTE") {
    return (
      <div className="wrap" style={{ maxWidth: 720 }}>
        {cabecera}
        <div className="note">
          Has iniciado sesión como personal. Las citas de tus pacientes se dan desde la{" "}
          <Link href="/panel?tab=agenda">agenda del panel</Link>.
        </div>
      </div>
    );
  }

  // --- Cliente con sesión: cambiar la cita de un caso suyo ---
  if (user && caso) {
    const kase = await prisma.case.findUnique({ where: { id: caso }, include: { patient: true } });
    const mine = kase && kase.patient.ownerId === user.id && kase.clinicId === clinic.id;
    const puede = mine && ["CITA_RESERVADA", "DEVUELTO_CLINICA"].includes(kase.state);
    if (!puede) {
      return (
        <div className="wrap" style={{ maxWidth: 720 }}>
          {cabecera}
          <div className="note r">Este caso no admite cambiar la cita desde aquí.</div>
        </div>
      );
    }
    const actual = await activeAppointmentOf(prisma, kase.id);
    const kind = kase.state === "DEVUELTO_CLINICA" ? "REPETICION" : "ESTUDIO";
    return (
      <div className="wrap" style={{ maxWidth: 820 }}>
        {cabecera}
        <form action={reprogramarCitaAction}>
          <input type="hidden" name="caseId" value={kase.id} />
          <div className="card">
            <b>{actual ? "Elige la nueva hora" : "Elige tu hora"}</b>
            <div className="muted" style={{ marginBottom: 10 }}>
              {APPOINTMENT_KIND_LABEL[kind]} para {kase.patient.name}
              {actual && <> · cita actual: {fmtdt(actual.startsAt)}</>}
            </div>
            <Calendario clinicId={clinic.id} />
          </div>
          <div className="sp" />
          <button type="submit" className="pri wfull">
            {actual ? "Cambiar mi cita" : "Confirmar cita"}
          </button>
        </form>
        <div className="sp2" />
      </div>
    );
  }

  // --- Cliente con sesión: nueva reserva para sí mismo o para otro paciente ---
  if (user) {
    const patients = await prisma.patient.findMany({ where: { ownerId: user.id }, orderBy: { name: "asc" } });
    return (
      <div className="wrap" style={{ maxWidth: 820 }}>
        {cabecera}
        <form action={reservaClienteAction}>
          <input type="hidden" name="clinicId" value={clinic.id} />
          <div className="card">
            <b>1. Elige tu hora</b>
            <div style={{ marginTop: 10 }}>
              <Calendario clinicId={clinic.id} />
            </div>
          </div>
          <div className="sp" />
          <div className="card">
            <b>2. ¿Para quién es la cita?</b>
            <label>Paciente</label>
            <select name="patientId" defaultValue={patients[0]?.id ?? "nuevo"}>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="nuevo">Otra persona a mi cargo (hijo/a, familiar)</option>
            </select>
            <div className="grid g2">
              <div>
                <label>Nombre y apellidos (solo si es otra persona)</label>
                <input name="newName" />
              </div>
              <div>
                <label>Fecha de nacimiento</label>
                <input name="newBirth" type="date" />
              </div>
            </div>
            <label className="chk">
              <input type="checkbox" name="consentSalud" required /> Consiento de forma explícita el
              tratamiento de los datos de salud del paciente para este estudio, incluida la grabación de
              vídeos de la marcha y fotografías de los pies. Si es un menor, declaro ser su padre, madre o
              tutor legal.
            </label>
          </div>
          <div className="sp" />
          <button type="submit" className="pri wfull">
            Confirmar reserva gratuita
          </button>
        </form>
        <div className="sp2" />
      </div>
    );
  }

  // --- Visitante: reserva + alta de cuenta ---
  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      {cabecera}
      <form action={reservaAction}>
        <input type="hidden" name="clinicId" value={clinic.id} />
        <div className="card">
          <b>1. Elige tu hora</b>
          <div style={{ marginTop: 10 }}>
            <Calendario clinicId={clinic.id} />
          </div>
        </div>
        <div className="sp" />
        <div className="card">
          <b>2. Tus datos</b>
          <div className="tiny" style={{ marginTop: 4 }}>
            ¿Ya tienes cuenta? <Link href={`/login?next=/reserva/${clinic.id}`}>Inicia sesión</Link> y reserva
            en dos clics.
          </div>
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
            <input type="checkbox" name="consentSalud" required /> Consiento de forma explícita el
            tratamiento de mis datos de salud para la prestación del servicio, incluida la
            grabación de vídeos de mi marcha y fotografías de mis pies durante el estudio. Si
            reservo para un menor de edad, declaro ser su padre, madre o tutor legal y consentir
            en su nombre.
          </label>
          <label className="chk">
            <input type="checkbox" name="consentWhatsApp" /> Acepto recibir los avisos del
            servicio por WhatsApp (solo avisos y enlaces, nunca contenido clínico).
          </label>
        </div>
        <div className="tiny" style={{ marginTop: 10 }}>
          Responsable: Ortosend. Finalidad: gestionar tu cita, estudio y tratamiento. Derechos de
          acceso, rectificación y supresión en la <a href="/legal/privacidad">política de privacidad</a>.
        </div>
        <div className="sp" />
        <button type="submit" className="pri wfull">
          Confirmar reserva gratuita
        </button>
      </form>
      <div className="sp2" />
    </div>
  );
}
