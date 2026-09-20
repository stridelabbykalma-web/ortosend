import Link from "next/link";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { StatePill } from "@/components/ui";
import { fmtd } from "@/lib/format";
import { requestProfessionalAction } from "@/app/panel/clinica-actions";
import { ClinicaAgenda } from "./clinica-agenda";
import { ClinicaDisponibilidad } from "./clinica-disponibilidad";
import { openCaseAction } from "@/app/panel/rx-actions";
import { REVISION_PREFIJO, esCentral } from "@/lib/rx-route";

export async function PanelClinica({
  user,
  tab,
  semana,
  pro,
  caso,
  anuladas,
}: {
  user: User;
  tab?: string;
  semana?: string;
  pro?: string;
  caso?: string;
  anuladas?: string;
}) {
  const clinic = await prisma.clinic.findUnique({ where: { id: user.clinicId! } });
  if (!clinic) return <div className="note r">Usuario sin clínica asignada.</div>;
  const profile = await prisma.professionalProfile.findUnique({ where: { userId: user.id } });
  // Cualquier prescriptor verificado de la clínica ve la cola de los casos que la clínica se quedó
  const isPrescriber = !!profile?.canPrescribe && !!profile.verifiedAt;

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
    body = <ClinicaAgenda clinic={clinic} user={user} semana={semana} pro={pro} caso={caso} anuladas={anuladas} />;
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
    const queue = cases.filter(
      (c) => ["EN_PRESCRIPCION", "EN_CONTACTO"].includes(c.state) && !esCentral({ rxRoute: c.rxRoute, clinic })
    );
    const enOrtosend = cases.filter(
      (c) => ["EN_PRESCRIPCION", "EN_CONTACTO"].includes(c.state) && esCentral({ rxRoute: c.rxRoute, clinic })
    );
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
                      <StatePill state={c.state} />{" "}
                      {c.rxDraft?.startsWith(REVISION_PREFIJO) && (
                        <span className="pill g">Segunda opinión de Ortosend recibida</span>
                      )}
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
        {enOrtosend.length > 0 && (
          <div className="tiny" style={{ marginTop: 10 }}>
            En manos de Ortosend ahora mismo:{" "}
            {enOrtosend
              .map((c) => `#${c.number}${c.rxRoute === "REVISION" ? " (revisión pedida)" : ""}`)
              .join(" · ")}
            . Los que pediste revisar volverán a esta cola con la valoración de Ortosend.
          </div>
        )}
      </>
    );
  }
  if (t === "disp") {
    body = <ClinicaDisponibilidad clinic={clinic} user={user} />;
  }
  if (t === "prof" && user.role === "ADMIN_CLINICA") {
    const [pros, applications] = await Promise.all([
      prisma.user.findMany({
        where: { clinicId: clinic.id, role: { in: ["PROFESIONAL", "ADMIN_CLINICA"] } },
        include: { professional: { include: { training: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.professionalApplication.findMany({
        where: { clinicId: clinic.id },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    body = (
      <>
        <h3>Profesionales de la clínica</h3>
        <div className="muted">
          Las cuentas las crea Ortosend tras validar la ficha (colegiación incluida si prescribe).
          Desde aquí solicitas el alta y sigues el estado de tus solicitudes.
        </div>
        <div className="sp" />
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Nombre completo</th>
                <th>Rol</th>
                <th>Titulación</th>
                <th>Nº colegiado</th>
                <th>Colegio</th>
                <th>Colegiación</th>
                <th>Formación</th>
                <th>Cuenta</th>
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
                  <td>{p.professional?.degree ?? "—"}</td>
                  <td>{p.professional?.collegiateNum ?? "—"}</td>
                  <td className="tiny">{p.professional?.college ?? "—"}</td>
                  <td>
                    {p.professional?.canPrescribe ? (
                      p.professional.verifiedAt ? (
                        <span className="pill g">Verificada</span>
                      ) : (
                        <span className="pill a">Pendiente</span>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span className={`pill ${(p.professional?.training.length ?? 0) >= 5 ? "g" : "a"}`}>
                      {p.professional?.training.length ?? 0}/5
                    </span>
                  </td>
                  <td>
                    {p.activatedAt ? (
                      <span className="pill g">Activa</span>
                    ) : (
                      <span className="pill a">Invitación enviada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {applications.length > 0 && (
          <>
            <div className="sp" />
            <div className="card">
              <b>Solicitudes de alta enviadas</b>
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Nombre</th>
                    <th>Perfil</th>
                    <th>Nº colegiado</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.id}>
                      <td className="tiny">{fmtd(a.createdAt)}</td>
                      <td>{a.fullName}</td>
                      <td>
                        {a.degree}
                        {a.canPrescribe ? " · prescriptor" : " · técnico"}
                      </td>
                      <td>{a.collegiateNum ?? "—"}</td>
                      <td>
                        <span
                          className={`pill ${a.status === "recibida" ? "a" : a.status === "aprobada" ? "g" : "r"}`}
                        >
                          {a.status}
                        </span>
                        {a.resolutionNote && <div className="tiny">{a.resolutionNote}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="sp" />
        <div className="card">
          <b style={{ fontFamily: "var(--font-sora)" }}>Solicitar alta de profesional</b>
          <form action={requestProfessionalAction}>
            <div className="grid g2">
              <div>
                <label>Nombre y apellidos</label>
                <input name="fullName" required />
              </div>
              <div>
                <label>DNI/NIE</label>
                <input name="dni" required />
              </div>
              <div>
                <label>Email (recibirá la invitación)</label>
                <input name="email" type="email" required />
              </div>
              <div>
                <label>Móvil</label>
                <input name="phone" required />
              </div>
            </div>
            <label>Titulación</label>
            <select name="degree" defaultValue="Podología">
              <option>Podología</option>
              <option>Medicina</option>
              <option>Fisioterapia</option>
              <option>Enfermería</option>
              <option>Técnico ortopédico</option>
              <option>Otra</option>
            </select>
            <label className="chk">
              <input type="checkbox" name="canPrescribe" /> Puede prescribir (podólogo o médico
              colegiado — Ortosend verificará la colegiación)
            </label>
            <div className="grid g2">
              <div>
                <label>Nº de colegiado (si prescribe)</label>
                <input name="collegiateNum" placeholder="Ej.: COL-1234" />
              </div>
              <div>
                <label>Colegio profesional y provincia (si prescribe)</label>
                <input name="college" placeholder="Ej.: Col·legi de Podòlegs de Catalunya (Girona)" />
              </div>
            </div>
            <label>Comentarios (opcional)</label>
            <textarea name="notes" rows={2} />
            <div className="sp" />
            <button type="submit" className="pri">
              Enviar solicitud a Ortosend
            </button>
            <div className="tiny" style={{ marginTop: 8 }}>
              Ortosend valida la ficha, crea la cuenta y el profesional recibe su invitación de
              activación (72 h). Después deberá completar la formación (5 módulos).
            </div>
          </form>
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
