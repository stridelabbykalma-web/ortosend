import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Flash, StatePill } from "@/components/ui";
import { ListaConsentimientos } from "@/components/consent/lista";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { REENVIABLE, auditar, destinatario, nombreCompleto, puedeVerFicha, tratamientoPermitido } from "@/lib/alta";
import { dniTitular } from "@/lib/acceso";
import { ESTADO_PACIENTE } from "@/lib/consent/estados";
import { fmtd, fmtdt } from "@/lib/format";
import { enviarAccesoAction, guardarDniAction, reenviarAction, revocarEnNombreAction } from "@/app/panel/alta-actions";

export const dynamic = "force-dynamic";

// Ficha del alta de un paciente en el panel del profesional: estado, envíos de
// WhatsApp, consentimientos, datos para el acceso y enlace a su ficha clínica.
export default async function PacientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "PROFESIONAL" && user.role !== "ADMIN_CLINICA" && user.role !== "ADMIN") redirect("/panel");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const p = await prisma.patient.findUnique({
    where: { id },
    include: {
      professional: { select: { name: true } },
      consentInvitations: { orderBy: { createdAt: "desc" }, take: 5 },
      cases: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!p || !puedeVerFicha(user, p)) notFound();
  await auditar(user.id, "patient.view", p.id);
  const dest = destinatario(p);
  const e = ESTADO_PACIENTE[p.status];
  const esClinica = user.role !== "ADMIN";
  const fichaAbierta = p.status === "ACEPTADO" || p.status === "REVOCADO" || p.cases.length > 0;
  const dni = dniTitular(p);

  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <div className="sp2" />
      <Flash ok={ok} error={error} />
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2>{nombreCompleto(p)}</h2>
        <span className={`pill ${e.color}`}>{e.texto}</span>
      </div>
      <div className="tiny">
        {p.birthDate ? `Nacimiento ${p.birthDate.toLocaleDateString("es-ES")} · ` : ""}
        Alta por {p.professional?.name ?? "—"} el {fmtd(p.createdAt)}
        {p.isMinor ? ` · menor: los mensajes van a su tutor, ${p.tutorName}` : ""}
      </div>
      <div className="sp" />

      <div className="card">
        <b>WhatsApp</b>
        <div className="muted">
          Destinatario: {dest.nombre} · {dest.telefono}
          {dest.email ? ` · ${dest.email}` : ""}
        </div>
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Envío</th>
              <th>Estado</th>
              <th>Caduca</th>
            </tr>
          </thead>
          <tbody>
            {p.consentInvitations.map((i) => (
              <tr key={i.id}>
                <td className="tiny">{fmtdt(i.sentAt ?? i.createdAt)}</td>
                <td className="tiny">
                  {i.sendStatus === "ERROR"
                    ? `Error: ${i.sendError ?? "desconocido"}`
                    : i.completedAt
                      ? `Aceptado ${fmtdt(i.completedAt)}`
                      : i.invalidatedAt
                        ? "Sustituido por un reenvío"
                        : i.startedAt
                          ? "Leyendo los documentos"
                          : "Enviado, sin abrir"}
                  {i.reminderSentAt ? " · recordatorio enviado" : ""}
                </td>
                <td className="tiny">{fmtdt(i.expiresAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {esClinica && REENVIABLE.includes(p.status) && (
          <form action={reenviarAction} style={{ marginTop: 10 }}>
            <input type="hidden" name="patientId" value={p.id} />
            <button type="submit" className="pri">
              {p.status === "REVOCADO" ? "Enviar una nueva invitación para volver a aceptar" : "Reenviar WhatsApp"}
            </button>
            <div className="tiny">El mensaje anterior deja de valer y empieza un nuevo plazo de 72 h.</div>
          </form>
        )}
      </div>
      <div className="sp" />

      <div className="card">
        <b>Ficha clínica</b>
        {!fichaAbierta ? (
          <div className="note a" style={{ marginTop: 8 }}>
            Bloqueada: se abrirá en cuanto {p.isMinor ? "el tutor acepte" : "el paciente acepte"} los cuatro documentos
            obligatorios por WhatsApp.
          </div>
        ) : (
          <>
            {!tratamientoPermitido(p) && (
              <div className="note r" style={{ marginTop: 8 }}>
                Solo lectura: el paciente no tiene en vigor todos los consentimientos obligatorios.
              </div>
            )}
            {p.cases.map((c) => (
              <div key={c.id} className="row" style={{ gap: 8, marginTop: 8 }}>
                <Link href={`/caso/${c.id}`} className="btn">
                  Abrir caso #{c.number}
                </Link>
                <StatePill state={c.state} />
              </div>
            ))}
            {esClinica && tratamientoPermitido(p) && (
              <form action={guardarDniAction} style={{ marginTop: 12 }}>
                <input type="hidden" name="patientId" value={p.id} />
                <div className="grid g2">
                  <div>
                    <label htmlFor="dni">DNI/NIE del paciente{p.isMinor ? " (si tiene)" : ""}</label>
                    <input id="dni" name="dni" defaultValue={p.dni ?? ""} autoComplete="off" />
                  </div>
                  {p.isMinor && (
                    <div>
                      <label htmlFor="tutorDni">DNI/NIE del tutor (su usuario de acceso)</label>
                      <input id="tutorDni" name="tutorDni" defaultValue={p.tutorDni ?? ""} autoComplete="off" />
                    </div>
                  )}
                </div>
                <button type="submit" style={{ marginTop: 8 }}>
                  Guardar
                </button>
              </form>
            )}
          </>
        )}
      </div>
      <div className="sp" />

      {p.status === "ACEPTADO" && esClinica && (
        <>
          <div className="card">
            <b>Acceso del paciente a su perfil</b>
            {p.ownerId ? (
              <div className="muted">Ya tiene cuenta y entra con su móvil y contraseña.</div>
            ) : (
              <>
                <div className="muted">
                  Cuando termines la ficha, envíale el acceso. Recibirá un WhatsApp para crear su contraseña en
                  ortosend.com/acceso con {p.isMinor ? "el DNI del tutor" : "su DNI"} y su móvil (más un código de
                  confirmación).
                </div>
                {p.accessSentAt && <div className="tiny">Último envío: {fmtdt(p.accessSentAt)}</div>}
                {!dni && <div className="note a" style={{ marginTop: 8 }}>Falta el DNI {p.isMinor ? "del tutor" : "del paciente"}.</div>}
                <form action={enviarAccesoAction} style={{ marginTop: 8 }}>
                  <input type="hidden" name="patientId" value={p.id} />
                  <button type="submit" className="pri" disabled={!dni}>
                    {p.accessSentAt ? "Reenviar acceso" : "Enviar acceso al paciente"}
                  </button>
                </form>
              </>
            )}
          </div>
          <div className="sp" />
        </>
      )}

      <h3>Consentimientos</h3>
      <div className="tiny" style={{ marginBottom: 8 }}>
        Registro inalterable: cada cambio es una fila nueva. Si el paciente te pide retirar uno, puedes registrarlo
        aquí en su nombre.
      </div>
      <ListaConsentimientos
        patientId={p.id}
        action={revocarEnNombreAction}
        ocultos={{}}
        enNombreDelPaciente
        soloLectura={!esClinica}
      />
      <div className="sp2" />
      <Link href="/panel?tab=altas">← Volver a las altas</Link>
    </div>
  );
}
