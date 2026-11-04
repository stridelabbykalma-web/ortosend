import Link from "next/link";
import { AudioPrimer } from "@/components/audio-primer";
import { nombreCompleto } from "@/lib/nombre";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/cases";
import { Flash, StatePill, Steps } from "@/components/ui";
import { Expediente, Historial } from "@/components/caso/expediente";
import { ContinuidadEstudio } from "@/components/caso/continuidad";
import { CapturaGuiada } from "@/components/caso/captura-guiada";
import { RxView } from "@/components/caso/rx-view";
import { TallerView } from "@/components/caso/taller-view";
import { unlockRxAction } from "@/app/panel/cliente-actions";
import { verifyDocToken } from "@/lib/doc-token";
import { fmtd } from "@/lib/format";
import { esCentral } from "@/lib/rx-route";
import { TALLER_STATES } from "@/lib/taller";
import { tratamientoPermitido } from "@/lib/alta";

export const dynamic = "force-dynamic";

export default async function CasoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string; doc?: string; paso?: string; elegir?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { error, ok, doc, paso, elegir } = await searchParams;
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
      hoja: true,
      consumos: { include: { lote: true, material: true }, orderBy: { createdAt: "asc" } },
      events: { orderBy: { at: "asc" } },
    },
  });
  if (!kase) notFound();
  const k = kase!;

  // Control de acceso por rol
  const isOwner = user.role === "CLIENTE" && k.patient.ownerId === user.id;
  const isClinicStaff =
    (user.role === "PROFESIONAL" || user.role === "ADMIN_CLINICA") && user.clinicId === k.clinicId;
  const central = esCentral(k); // lo valora Ortosend (enviado a Ortosend o para revisión)
  // El recetador central solo ve casos en valoración (o que ya recetó él);
  // el taller, solo desde que entra el pedido. Antes podían abrir cualquier caso.
  const isCentral =
    user.role === "RECETADOR" &&
    central &&
    (["EN_PRESCRIPCION", "EN_CONTACTO"].includes(k.state) || k.prescription?.prescriberId === user.id);
  const isTaller = user.role === "TALLER" && [...TALLER_STATES, "ENTREGADO", "CERRADO"].includes(k.state);
  const isAdmin = user.role === "ADMIN";
  if (!isOwner && !isClinicStaff && !isCentral && !isTaller && !isAdmin) redirect("/panel");

  // Registro de accesos a datos de salud (RGPD)
  if (!isOwner) await audit(user.id, "case.view", `case:${k.number}`, k.patientId);
  // Sin los consentimientos obligatorios en vigor (retirados o pendientes de
  // volver a aceptar) la ficha se ve pero no se edita ni avanza.
  const permitido = tratamientoPermitido(k.patient);

  const profile =
    isClinicStaff || isCentral
      ? await prisma.professionalProfile.findUnique({ where: { userId: user.id } })
      : null;
  const puedeRecetar = !!profile?.canPrescribe && !!profile.verifiedAt;
  const canPrescribeHere = puedeRecetar && (isCentral || (isClinicStaff && !central));
  // Las opciones de «receta propia» dependen de la clínica, no de quien rellena el
  // estudio: basta con que la clínica tenga un prescriptor con colegiación verificada
  // (lo puede enviar el administrador y firmarlo el prescriptor).
  const clinicaReceta =
    isClinicStaff &&
    (await prisma.professionalProfile.count({
      where: { canPrescribe: true, verifiedAt: { not: null }, user: { clinicId: k.clinicId, active: true } },
    })) > 0;
  const requestedBy = k.rxRequestedBy
    ? await prisma.user.findUnique({ where: { id: k.rxRequestedBy }, select: { name: true } })
    : null;

  const inCapture = ["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"].includes(k.state);
  const inRx = ["EN_PRESCRIPCION", "EN_CONTACTO"].includes(k.state);
  const inTaller = TALLER_STATES.includes(k.state);

  let inner: React.ReactNode;
  if (!permitido && !isOwner) {
    inner = (
      <>
        <Expediente kase={k} />
        <Historial events={k.events} />
      </>
    );
  } else if (isClinicStaff && inCapture) {
    const pasoNum = paso ? Number(paso) || undefined : undefined;
    inner = (
      <>
        {/* Desbloquea los pitidos del estudio con el primer toque: solo aquí,
            donde hacen falta — en el resto de la web no debe sonar nada. */}
        <AudioPrimer />
        <ContinuidadEstudio caseId={k.id} paso={pasoNum ?? 0} />
        <CapturaGuiada kase={k} paso={pasoNum} puedeRecetar={clinicaReceta} elegir={elegir === "1"} />
        {!pasoNum && <Historial events={k.events} />}
      </>
    );
  } else if (canPrescribeHere && inRx) {
    inner = (
      <>
        <Expediente kase={k} />
        <div className="sp" />
        <RxView
          kase={k}
          collegiateNum={profile?.collegiateNum ?? null}
          central={isCentral}
          requestedBy={requestedBy?.name ?? null}
        />
        <Historial events={k.events} />
      </>
    );
  } else if (isTaller && inTaller) {
    inner = (
      <div>
        <TallerView kase={k} />
        <div className="sp" />
        <details className="card" style={{ padding: "12px 20px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Expediente clínico completo (cuestionario, exploración, vídeos y fotos)</summary>
          <div className="sp" />
          <Expediente kase={k} />
        </details>
        <Historial events={k.events} />
      </div>
    );
  } else if (isOwner) {
    const showDoc = doc ? await verifyDocToken(doc, k.id) : false;
    inner = (
      <>
        <Steps state={k.state} />
        {k.prescription && !showDoc && (
          <form className="card px-lift pc-lock" action={unlockRxAction}>
            <div className="px-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
                <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
              </svg>
            </div>
            <b style={{ fontFamily: "var(--font-sora)", fontSize: 16 }}>Documento clínico</b>
            <p className="muted" style={{ margin: "6px 0" }}>
              Por seguridad, confirma tu contraseña para ver tu prescripción (documento clínico
              firmado, se conserva 5 años).
            </p>
            <input type="hidden" name="caseId" value={k.id} />
            <label>Contraseña</label>
            <input name="password" type="password" required />
            <div className="sp" />
            <button type="submit" className="pri wfull">
              Ver prescripción
            </button>
          </form>
        )}
        {k.prescription && showDoc && (
          <div className="card px-lift pc-doc">
            <div className="pc-doc-head">
              <h3>Prescripción</h3>
              <span className="logo">
                orto<b>send</b>
              </span>
            </div>
            <div className="pc-doc-meta">
              <div>
                <div className="pc-k">Paciente</div>
                <div>{nombreCompleto(k.patient)}</div>
              </div>
              <div>
                <div className="pc-k">Clínica del estudio</div>
                <div>{k.clinic.name}</div>
              </div>
              <div>
                <div className="pc-k">Prescriptor</div>
                <div>
                  {k.prescription.prescriberName} (col. {k.prescription.collegiateNum})
                </div>
              </div>
              <div>
                <div className="pc-k">Caso</div>
                <div>#{k.number} · firmado el {fmtd(k.prescription.signedAt)}</div>
              </div>
            </div>
            <div className="pc-doc-sec">
              <div className="pc-k">Diagnóstico / indicación</div>
              <div>{k.prescription.diagnosis}</div>
            </div>
            <div className="pc-doc-sec">
              <div className="pc-k">Pauta de uso</div>
              <div>{k.prescription.usageGuidelines}</div>
            </div>
            <div className="pc-doc-firma">
              <span className="tiny">
                Documento clínico firmado electrónicamente · se conserva 5 años
                {k.prescription.pdfSha256 && (
                  <>
                    {" "}· Huella SHA-256: {k.prescription.pdfSha256.slice(0, 24)}…
                  </>
                )}
              </span>
              {k.prescription.pdfSha256 && (
                <a className="btn pri" href={`/api/rx-pdf/${k.id}?t=${encodeURIComponent(doc!)}`} target="_blank" rel="noreferrer">
                  Descargar PDF firmado
                </a>
              )}
            </div>
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
          Caso #{k.number} — {nombreCompleto(k.patient)}
        </h2>
        <StatePill state={k.state} />
      </div>
      <div className="tiny">
        {k.clinic.name} · creado {fmtd(k.createdAt)} · flujo {k.flow}
      </div>
      <div className="sp" />
      {!permitido && (
        <div className="note r" style={{ marginBottom: 12 }}>
          {k.patient.status === "REVOCADO"
            ? "El paciente ha retirado un consentimiento obligatorio. La ficha se conserva por obligación legal, pero está en solo lectura: no se puede editar, prescribir ni fabricar."
            : "El paciente aún no ha aceptado los documentos obligatorios. La ficha está en solo lectura."}{" "}
          {isClinicStaff && <Link href={`/panel/paciente/${k.patientId}`}>Ver estado del paciente</Link>}
        </div>
      )}
      {inner}
      <div className="sp2" />
      <Link href="/panel">← Volver al panel</Link>
    </div>
  );
}
