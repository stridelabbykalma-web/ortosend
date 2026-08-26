import Link from "next/link";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { StatePill } from "@/components/ui";
import { fmtd, fmtdt } from "@/lib/format";
import { addSlotAction, delSlotAction, newCaseBAction } from "@/app/panel/clinica-actions";
import { openCaseAction } from "@/app/panel/rx-actions";

export async function PanelClinica({ user, tab }: { user: User; tab?: string }) {
  const clinic = await prisma.clinic.findUnique({
    where: { id: user.clinicId! },
    include: { slots: { where: { caseId: null, startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } } },
  });
  if (!clinic) return <div className="note r">Usuario sin clínica asignada.</div>;
  const profile = await prisma.professionalProfile.findUnique({ where: { userId: user.id } });
  const isPrescriber = !!profile?.canPrescribe && !!profile.verifiedAt && clinic.hasPrescriber;

  const tabsDef: [string, string][] = [
    ["agenda", "Agenda"],
    ["casos", "Mis casos"],
    ...(isPrescriber ? ([["rx", "Prescripciones"]] as [string, string][]) : []),
    ["disp", "Disponibilidad"],
    ...(user.role === "ADMIN_CLINICA"
      ? ([
          ["prof", "Profesionales"],
          ["liq", "Liquidaciones"],
        ] as [string, string][])
      : []),
  ];
  const t = tab && tabsDef.some(([k]) => k === tab) ? tab : "agenda";
  const cases = await prisma.case.findMany({
    where: { clinicId: clinic.id },
    include: { patient: true },
    orderBy: { createdAt: "desc" },
  });

  let body: React.ReactNode = null;
  if (t === "agenda") {
    const agenda = cases.filter((c) =>
      ["CITA_RESERVADA", "ESTUDIO_EN_CURSO", "DEVUELTO_CLINICA"].includes(c.state)
    );
    body = (
      <>
        <div className="row between">
          <h3>Citas y estudios pendientes</h3>
        </div>
        <div className="sp" />
        <div className="card">
          {agenda.length ? (
            <table>
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Paciente</th>
                  <th>Cita</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {agenda.map((c) => (
                  <tr key={c.id}>
                    <td>#{c.number}</td>
                    <td>{c.patient.name}</td>
                    <td>{c.appointmentAt ? fmtdt(c.appointmentAt) : "Flujo B"}</td>
                    <td>
                      <StatePill state={c.state} />
                    </td>
                    <td>
                      <Link href={`/caso/${c.id}`} className="btn">
                        {c.state === "DEVUELTO_CLINICA" ? "Repetir prueba" : "Abrir estudio"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted">Sin citas pendientes. Los pacientes que reserven online aparecerán aquí.</div>
          )}
        </div>
        <div className="sp" />
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Nuevo caso (Flujo B — paciente en clínica)</summary>
          <form action={newCaseBAction}>
            <label>Nombre y apellidos del paciente</label>
            <input name="name" required />
            <div className="grid g2">
              <div>
                <label>Móvil (recibirá la invitación de cuenta, 72 h)</label>
                <input name="phone" required />
              </div>
              <div>
                <label>Email (opcional)</label>
                <input name="email" type="email" />
              </div>
            </div>
            <label>Fecha de nacimiento</label>
            <input name="birth" type="date" />
            <div className="sp" />
            <button type="submit" className="pri">
              Crear caso e invitar al paciente
            </button>
            <div className="tiny" style={{ marginTop: 8 }}>
              El consentimiento RGPD se recoge en clínica. El paciente activa su cuenta desde el
              enlace de invitación (WhatsApp).
            </div>
          </form>
        </details>
      </>
    );
  }
  if (t === "casos") {
    body = (
      <>
        <h3>Todos los casos de la clínica</h3>
        <div className="sp" />
        <div className="card">
          {cases.length ? (
            <table>
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Paciente</th>
                  <th>Creado</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/caso/${c.id}`}>#{c.number}</Link>
                    </td>
                    <td>{c.patient.name}</td>
                    <td>{fmtd(c.createdAt)}</td>
                    <td>
                      <StatePill state={c.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted">Sin casos todavía.</div>
          )}
        </div>
        <div className="note" style={{ marginTop: 12 }}>
          Recuerda: la clínica nunca cobra al paciente ni envía enlaces de pago. Todo pago se
          gestiona desde Ortosend.
        </div>
      </>
    );
  }
  if (t === "rx" && isPrescriber) {
    const queue = cases.filter((c) => ["EN_PRESCRIPCION", "EN_CONTACTO"].includes(c.state));
    body = (
      <>
        <h3>Casos pendientes de tu prescripción</h3>
        <div className="sp" />
        <div className="card">
          {queue.length ? (
            <table>
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Paciente</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {queue.map((c) => (
                  <tr key={c.id}>
                    <td>#{c.number}</td>
                    <td>{c.patient.name}</td>
                    <td>
                      <StatePill state={c.state} />
                    </td>
                    <td>
                      <form action={openCaseAction}>
                        <input type="hidden" name="caseId" value={c.id} />
                        <button type="submit" className="pri">
                          Valorar
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted">Nada pendiente de prescribir.</div>
          )}
        </div>
      </>
    );
  }
  if (t === "disp") {
    body = (
      <>
        <h3>Huecos publicados en la web</h3>
        <div className="muted">
          Franjas que tu clínica destina a reservas online (Flujo A). Máximo 5 activos.
        </div>
        <div className="sp" />
        <div className="card">
          <div className="grid g4">
            {clinic.slots.map((s) => (
              <div className="row" key={s.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13 }}>{fmtdt(s.startsAt)}</span>
                <form action={delSlotAction}>
                  <input type="hidden" name="slotId" value={s.id} />
                  <button type="submit" style={{ color: "var(--red)", border: "none", padding: "0 4px" }}>
                    ×
                  </button>
                </form>
              </div>
            ))}
            {clinic.slots.length === 0 && <div className="muted">Sin huecos publicados.</div>}
          </div>
          <form className="row" style={{ marginTop: 12 }} action={addSlotAction}>
            <input name="startsAt" type="datetime-local" style={{ maxWidth: 220 }} required />
            <button type="submit" disabled={clinic.slots.length >= 5}>
              Añadir hueco
            </button>
          </form>
        </div>
      </>
    );
  }
  if (t === "prof" && user.role === "ADMIN_CLINICA") {
    const pros = await prisma.user.findMany({
      where: { clinicId: clinic.id, role: { in: ["PROFESIONAL", "ADMIN_CLINICA"] } },
      include: { professional: { include: { training: true } } },
    });
    body = (
      <>
        <h3>Profesionales de la clínica</h3>
        <div className="muted">
          Las cuentas las crea Ortosend tras validar la ficha (colegiación incluida si prescribe).
        </div>
        <div className="sp" />
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Formación</th>
              </tr>
            </thead>
            <tbody>
              {pros.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    {p.role === "ADMIN_CLINICA"
                      ? "Admin clínica"
                      : p.professional?.canPrescribe
                        ? "Prescriptor"
                        : "Técnico"}
                  </td>
                  <td>
                    <span className={`pill ${(p.professional?.training.length ?? 0) >= 5 ? "g" : "a"}`}>
                      {p.professional?.training.length ?? 0}/5 módulos
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  if (t === "liq" && user.role === "ADMIN_CLINICA") {
    const settlements = await prisma.settlement.findMany({ where: { clinicId: clinic.id }, orderBy: { period: "desc" } });
    body = (
      <>
        <h3>Liquidaciones mensuales</h3>
        <div className="sp" />
        <div className="card">
          {settlements.length ? (
            <table>
              <thead>
                <tr>
                  <th>Periodo</th>
                  <th>Importe</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id}>
                    <td>{s.period}</td>
                    <td>{s.amountCents ? (s.amountCents / 100).toFixed(2) + " €" : "pendiente de definir"}</td>
                    <td>{s.paidAt ? <span className="pill g">Pagada</span> : <span className="pill a">Pendiente</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted">
              Aquí verás la compensación mensual por los estudios realizados y podrás subir tu
              factura. Los importes están pendientes de definir por Ortosend.
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="row between">
        <h2>{clinic.name}</h2>
        <span className={`pill ${clinic.hasPrescriber ? "g" : "b"}`}>
          {clinic.hasPrescriber ? "Con prescriptor propio" : "Prescripción central Ortosend"}
        </span>
      </div>
      <div className="sp" />
      <div className="tabs">
        {tabsDef.map(([k, label]) => (
          <Link key={k} href={`/panel?tab=${k}`} className={t === k ? "on" : ""}>
            {label}
          </Link>
        ))}
      </div>
      {body}
    </>
  );
}
