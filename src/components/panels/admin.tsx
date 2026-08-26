import Link from "next/link";
import { prisma } from "@/lib/db";
import { Kpi, StatePill } from "@/components/ui";
import { fmtd, fmtdt } from "@/lib/format";
import {
  applicationSetAction,
  clinicStatusAction,
  closeCaseAction,
  reactivatePayAction,
  runJobsAction,
} from "@/app/panel/admin-actions";

const TABS: [string, string][] = [
  ["res", "Resumen"],
  ["sol", "Solicitudes"],
  ["cli", "Clínicas"],
  ["usr", "Profesionales"],
  ["cas", "Casos"],
  ["esp", "Lista de espera"],
  ["not", "Notificaciones"],
];

export async function PanelAdmin({ tab }: { tab?: string }) {
  const t = tab && TABS.some(([k]) => k === tab) ? tab : "res";
  let body: React.ReactNode = null;

  if (t === "res") {
    const [total, rx, pago, taller, entregados, clinicas, solicitudes, espera] = await Promise.all([
      prisma.case.count(),
      prisma.case.count({ where: { state: { in: ["EN_PRESCRIPCION", "EN_CONTACTO"] } } }),
      prisma.case.count({ where: { state: "PENDIENTE_PAGO" } }),
      prisma.case.count({ where: { state: { in: ["ENTRADA_TALLER", "DISENO", "FABRICACION", "CALIDAD", "ENVIADO"] } } }),
      prisma.case.count({ where: { state: { in: ["ENTREGADO", "CERRADO"] } } }),
      prisma.clinic.count({ where: { status: "ACTIVA" } }),
      prisma.clinicApplication.count({ where: { status: "recibida" } }),
      prisma.waitlistEntry.count(),
    ]);
    body = (
      <>
        <div className="grid g4">
          <Kpi v={total} l="Casos totales" />
          <Kpi v={rx} l="En prescripción" />
          <Kpi v={pago} l="Pendientes de pago" />
          <Kpi v={taller} l="En taller" />
          <Kpi v={entregados} l="Entregados" />
          <Kpi v={clinicas} l="Clínicas activas" />
          <Kpi v={solicitudes} l="Solicitudes nuevas" />
          <Kpi v={espera} l="Lista de espera" />
        </div>
        <div className="sp" />
        <div className="row between">
          <div className="note" style={{ flex: 1 }}>
            Automatizaciones: recordatorio de cita 24 h · secuencia de pago días 0/3/7/15/30 · aviso
            de envío · seguimiento de adaptación día 20 · revisión anual. En producción corren como
            cron diario (/api/cron).
          </div>
          <form action={runJobsAction}>
            <button type="submit">Ejecutar mantenimiento ahora</button>
          </form>
        </div>
      </>
    );
  }
  if (t === "sol") {
    const apps = await prisma.clinicApplication.findMany({ orderBy: { createdAt: "desc" } });
    body = (
      <>
        <h3>Solicitudes de clínicas</h3>
        <div className="sp" />
        <div className="card">
          {apps.length ? (
            <table>
              <thead>
                <tr>
                  <th>Clínica</th>
                  <th>Zona</th>
                  <th>Prescriptor</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{a.town}</td>
                    <td>{a.hasPrescriber ? "Sí" : "No"}</td>
                    <td>
                      <span className={`pill ${a.status === "recibida" ? "a" : a.status === "aprobada" ? "g" : "r"}`}>
                        {a.status}
                      </span>
                    </td>
                    <td>
                      {a.status === "recibida" && (
                        <div className="row">
                          <form action={applicationSetAction}>
                            <input type="hidden" name="applicationId" value={a.id} />
                            <input type="hidden" name="status" value="aprobada" />
                            <button type="submit">Aprobar</button>
                          </form>
                          <form action={applicationSetAction}>
                            <input type="hidden" name="applicationId" value={a.id} />
                            <input type="hidden" name="status" value="rechazada" />
                            <button type="submit" className="dang">
                              Rechazar
                            </button>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted">Sin solicitudes. Llegan desde «Para clínicas» en la web.</div>
          )}
        </div>
        <div className="tiny" style={{ marginTop: 10 }}>
          Tras aprobar: contrato + cesión de equipamiento + creación de cuentas + formación
          obligatoria → activación (pestaña Clínicas) y aparición en el buscador.
        </div>
      </>
    );
  }
  if (t === "cli") {
    const clinics = await prisma.clinic.findMany({ include: { equipment: true }, orderBy: { name: "asc" } });
    body = (
      <>
        <h3>Red de clínicas</h3>
        <div className="sp" />
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Clínica</th>
                <th>Zona</th>
                <th>Prescriptor</th>
                <th>Equipo cedido</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clinics.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    {c.town} ({c.postalCode})
                  </td>
                  <td>{c.hasPrescriber ? "Sí" : "No"}</td>
                  <td className="tiny">
                    {c.equipment.length
                      ? c.equipment.map((e) => `${e.type} #${e.serial}`).join(" · ")
                      : "—"}
                  </td>
                  <td>
                    <span className={`pill ${c.status === "ACTIVA" ? "g" : c.status === "SUSPENDIDA" ? "r" : "a"}`}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    <form action={clinicStatusAction}>
                      <input type="hidden" name="clinicId" value={c.id} />
                      <input type="hidden" name="status" value={c.status === "ACTIVA" ? "SUSPENDIDA" : "ACTIVA"} />
                      <button type="submit">{c.status === "ACTIVA" ? "Suspender" : "Activar"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  if (t === "usr") {
    const users = await prisma.user.findMany({
      where: { role: { not: "CLIENTE" } },
      include: { clinic: true, professional: true },
      orderBy: { name: "asc" },
    });
    body = (
      <>
        <h3>Profesionales y cuentas</h3>
        <div className="sp" />
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Colegiación</th>
                <th>Clínica</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="tiny">{u.email}</td>
                  <td>
                    {u.role}
                    {u.professional?.canPrescribe ? " · prescriptor" : ""}
                  </td>
                  <td className="tiny">
                    {u.professional?.canPrescribe
                      ? `${u.professional.collegiateNum ?? "—"} ${u.professional.verifiedAt ? "✓ verificada" : "· pendiente"}`
                      : "—"}
                  </td>
                  <td>{u.clinic?.name ?? "Ortosend"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="tiny" style={{ marginTop: 10 }}>
            Alta de profesional: ficha completa + verificación de colegiación si prescribe →
            creación de cuenta → formación (5 módulos) → acceso.
          </div>
        </div>
      </>
    );
  }
  if (t === "cas") {
    const cases = await prisma.case.findMany({
      include: { patient: true, clinic: true },
      orderBy: { createdAt: "desc" },
    });
    body = (
      <>
        <h3>Todos los casos</h3>
        <div className="sp" />
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Caso</th>
                <th>Paciente</th>
                <th>Clínica</th>
                <th>Creado</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/caso/${c.id}`}>#{c.number}</Link>
                  </td>
                  <td>{c.patient.name}</td>
                  <td>{c.clinic.name}</td>
                  <td>{fmtd(c.createdAt)}</td>
                  <td>
                    <StatePill state={c.state} />
                  </td>
                  <td>
                    {c.state === "ENTREGADO" && (
                      <form action={closeCaseAction}>
                        <input type="hidden" name="caseId" value={c.id} />
                        <button type="submit">Cerrar (revisión anual)</button>
                      </form>
                    )}
                    {c.state === "NO_CONVERTIDO" && (
                      <form action={reactivatePayAction}>
                        <input type="hidden" name="caseId" value={c.id} />
                        <button type="submit">Reactivar pago</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  if (t === "esp") {
    const wl = await prisma.waitlistEntry.findMany({ orderBy: { createdAt: "desc" } });
    body = (
      <>
        <h3>Lista de espera por zonas sin clínica</h3>
        <div className="muted">Oro para decidir dónde captar la próxima clínica.</div>
        <div className="sp" />
        <div className="card">
          {wl.length ? (
            <table>
              <thead>
                <tr>
                  <th>Zona buscada</th>
                  <th>Contacto</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {wl.map((w) => (
                  <tr key={w.id}>
                    <td>{w.zone}</td>
                    <td>{w.contact}</td>
                    <td>{fmtd(w.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted">Vacía. Se llena cuando alguien busca una zona sin cobertura y deja su contacto.</div>
          )}
        </div>
      </>
    );
  }
  if (t === "not") {
    const notifications = await prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    body = (
      <>
        <h3>Cola de WhatsApp (simulada)</h3>
        <div className="muted">
          Canal principal: solo avisos + enlace, nunca contenido clínico. En producción se envía por
          WhatsApp Business API (360dialog/Twilio) con email de respaldo.
        </div>
        <div className="sp" />
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Destino</th>
                <th>Plantilla</th>
                <th>Contenido</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n) => (
                <tr key={n.id}>
                  <td className="tiny">{fmtdt(n.createdAt)}</td>
                  <td>{n.toPhone}</td>
                  <td>
                    <span className="pill n">{n.template}</span>
                  </td>
                  <td className="tiny">{(n.payload as { nota?: string })?.nota ?? JSON.stringify(n.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <>
      <h2>Administración Ortosend</h2>
      <div className="sp" />
      <div className="tabs">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/panel?tab=${k}`} className={t === k ? "on" : ""}>
            {label}
          </Link>
        ))}
      </div>
      {body}
    </>
  );
}
