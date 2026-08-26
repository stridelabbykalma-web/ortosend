import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/cases";
import { Flash, StatePill, Steps } from "@/components/ui";
import { Expediente, Historial } from "@/components/caso/expediente";
import { Wizard } from "@/components/caso/wizard";
import { RxView } from "@/components/caso/rx-view";
import { TallerView } from "@/components/caso/taller-view";
import { unlockRxAction } from "@/app/panel/cliente-actions";
import { verifyDocToken } from "@/app/panel/cliente-actions";
import { fmtd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CasoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string; doc?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { error, ok, doc } = await searchParams;
  const kase = await prisma.case.findUnique({
    where: { id },
    include: {
      patient: { include: { owner: true } },
      clinic: true,
      capture: { include: { media: true } },
      prescription: true,
      payment: true,
      shipment: true,
      incidents: true,
      events: { orderBy: { at: "asc" } },
    },
  });
  if (!kase) notFound();
  const k = kase!;

  // Control de acceso por rol
  const isOwner = user.role === "CLIENTE" && k.patient.ownerId === user.id;
  const isClinicStaff =
    (user.role === "PROFESIONAL" || user.role === "ADMIN_CLINICA") && user.clinicId === k.clinicId;
  const isCentral = user.role === "RECETADOR" && !k.clinic.hasPrescriber;
  const isTaller = user.role === "TALLER";
  const isAdmin = user.role === "ADMIN";
  if (!isOwner && !isClinicStaff && !isCentral && !isTaller && !isAdmin) redirect("/panel");

  // Registro de accesos a datos de salud (RGPD)
  if (!isOwner) await audit(user.id, "case.view", `case:${k.number}`);

  const profile =
    isClinicStaff || isCentral
      ? await prisma.professionalProfile.findUnique({ where: { userId: user.id } })
      : null;
  const canPrescribeHere =
    !!profile?.canPrescribe &&
    !!profile.verifiedAt &&
    (isCentral || (isClinicStaff && k.clinic.hasPrescriber));

  const inCapture = ["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"].includes(k.state);
  const inRx = ["EN_PRESCRIPCION", "EN_CONTACTO"].includes(k.state);
  const inTaller = ["ENTRADA_TALLER", "DISENO", "FABRICACION", "CALIDAD", "ENVIADO"].includes(k.state);

  let inner: React.ReactNode;
  if (isClinicStaff && inCapture) {
    inner = (
      <>
        <Wizard kase={k} />
        <Historial events={k.events} />
      </>
    );
  } else if (canPrescribeHere && inRx) {
    inner = (
      <>
        <Expediente kase={k} />
        <div className="sp" />
        <RxView kase={k} collegiateNum={profile?.collegiateNum ?? null} />
        <Historial events={k.events} />
      </>
    );
  } else if (isTaller && inTaller) {
    inner = (
      <div>
        <TallerView kase={k} />
        <div className="sp" />
        <Expediente kase={k} />
        <Historial events={k.events} />
      </div>
    );
  } else if (isOwner) {
    const showDoc = doc ? await verifyDocToken(doc, k.id) : false;
    inner = (
      <>
        <Steps state={k.state} />
        {k.prescription && !showDoc && (
          <form className="card" action={unlockRxAction} style={{ maxWidth: 480 }}>
            <b>Documento clínico</b>
            <p className="muted" style={{ margin: "6px 0" }}>
              Por seguridad, confirma tu contraseña para ver tu prescripción (documento clínico
              firmado, se conserva 5 años).
            </p>
            <input type="hidden" name="caseId" value={k.id} />
            <label>Contraseña</label>
            <input name="password" type="password" required />
            <div className="sp" />
            <button type="submit" className="pri">
              Ver prescripción
            </button>
          </form>
        )}
        {k.prescription && showDoc && (
          <div className="card">
            <h3>Prescripción — caso #{k.number}</h3>
            <div className="tiny">Documento clínico firmado electrónicamente · se conserva 5 años</div>
            <div className="sp" />
            <p>
              <b>Paciente:</b> {k.patient.name} · <b>Clínica del estudio:</b> {k.clinic.name}
            </p>
            <p>
              <b>Prescriptor:</b> {k.prescription.prescriberName} (col. {k.prescription.collegiateNum})
            </p>
            <p>
              <b>Diagnóstico / indicación:</b> {k.prescription.diagnosis}
            </p>
            <p>
              <b>Pauta de uso:</b> {k.prescription.usageGuidelines}
            </p>
            <p className="tiny">Firmado: {fmtd(k.prescription.signedAt)} · {k.prescription.prescriberName}</p>
          </div>
        )}
        {!k.prescription && (
          <div className="muted">Aquí verás tus documentos cuando tu valoración esté completa.</div>
        )}
      </>
    );
  } else {
    inner = (
      <>
        <Expediente kase={k} />
        <Historial events={k.events} />
      </>
    );
  }

  return (
    <div className="wrap">
      <div className="sp2" />
      <Flash error={error} ok={ok} />
      <div className="row between">
        <h2>
          Caso #{k.number} — {k.patient.name}
        </h2>
        <StatePill state={k.state} />
      </div>
      <div className="tiny">
        {k.clinic.name} · creado {fmtd(k.createdAt)} · flujo {k.flow}
      </div>
      <div className="sp" />
      {inner}
      <div className="sp2" />
      <Link href="/panel">← Volver al panel</Link>
    </div>
  );
}
