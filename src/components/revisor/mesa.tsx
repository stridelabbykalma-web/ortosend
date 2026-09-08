import Link from "next/link";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { releaseStale } from "@/lib/cases";
import { fmtd } from "@/lib/format";
import { OPEN_CASE_TIMEOUT_MIN } from "@/lib/states";
import type { Questionnaire } from "@/lib/questionnaire";
import type { Exam } from "@/lib/exploracion";
import { ahoraMs, diasDesde, edad, hace, sintesisDe } from "@/lib/revisor";
import { Kpi, StatePill } from "@/components/ui";
import { nextRxAction, openCaseAction } from "@/app/panel/rx-actions";

const COLA_INCLUDE = {
  patient: true,
  clinic: true,
  capture: { include: { media: { select: { kind: true, meta: true, confirmedAt: true } } } },
} satisfies Prisma.CaseInclude;
type CasoCola = Prisma.CaseGetPayload<{ include: typeof COLA_INCLUDE }>;

// Mesa de valoración: lo que ve el revisor al entrar. En modo «central» la
// cola se reparte por antigüedad (solo «siguiente caso»); en modo «clinica» el
// prescriptor elige el caso de su propia clínica.
export async function MesaRevisor({ user, modo }: { user: User; modo: "central" | "clinica" }) {
  await releaseStale();
  const ahora = ahoraMs();
  const whereCola: Prisma.CaseWhereInput =
    modo === "central"
      ? { state: "EN_PRESCRIPCION", openBy: null, clinic: { hasPrescriber: false } }
      : { clinicId: user.clinicId!, state: { in: ["EN_PRESCRIPCION", "EN_CONTACTO"] } };
  const [cola, mineOpen, contact, firmadas, profile] = await Promise.all([
    prisma.case.findMany({ where: whereCola, include: COLA_INCLUDE, orderBy: { createdAt: "asc" }, take: 25 }),
    prisma.case.findFirst({ where: { openBy: user.id }, include: { patient: true, clinic: true } }),
    prisma.case.findMany({
      where: { state: "EN_CONTACTO", assignedTo: user.id },
      include: { patient: { include: { owner: true } }, events: { orderBy: { at: "desc" }, take: 1 } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.prescription.findMany({
      where: { prescriberId: user.id },
      include: { case: { include: { patient: true } } },
      orderBy: { signedAt: "desc" },
      take: 6,
    }),
    prisma.professionalProfile.findUnique({ where: { userId: user.id } }),
  ]);
  const colaLibre = cola.filter((c) => !c.openBy || c.openBy === user.id);
  const masAntiguo = colaLibre[0];
  const firmadas30 = firmadas.filter((p) => ahora - new Date(p.signedAt).getTime() < 30 * 86400000).length;
  const verificado = !!profile?.canPrescribe && !!profile.verifiedAt;

  return (
    <>
      <div className="row between">
        <div>
          <h2>{modo === "central" ? "Mesa de valoración · cola central" : "Mesa de valoración · mi clínica"}</h2>
          <div className="tiny">
            {user.name}
            {profile?.collegiateNum ? ` · col. ${profile.collegiateNum}` : ""} ·{" "}
            {verificado ? (
              <span className="pill g">colegiación verificada</span>
            ) : (
              <span className="pill r">colegiación sin verificar: no puedes firmar</span>
            )}
          </div>
        </div>
        <span className="tiny">Compromiso de respuesta: 48 h por caso</span>
      </div>

      <div className="grid g4" style={{ margin: "14px 0" }}>
        <Kpi v={colaLibre.length} l="Casos en cola" />
        <Kpi v={masAntiguo ? `${diasDesde(masAntiguo.createdAt, ahora)} d` : "—"} l="Espera del más antiguo" />
        <Kpi v={contact.length} l="Pendientes de contacto" />
        <Kpi v={firmadas30} l="Firmadas por ti (30 d)" />
      </div>

      {mineOpen ? (
        <div className="rev-next rev-open">
          <div>
            <h3>
              Tienes abierto el caso #{mineOpen.number} · {mineOpen.patient.name}
            </h3>
            <p>
              {mineOpen.clinic.name} · abierto {hace(mineOpen.openAt, ahora)} · se libera a los {OPEN_CASE_TIMEOUT_MIN} min
              sin actividad, con tus notas guardadas.
            </p>
          </div>
          <Link href={`/caso/${mineOpen.id}`} className="btn">
            Continuar con el caso
          </Link>
        </div>
      ) : modo === "central" ? (
        <form action={nextRxAction} className="rev-next">
          <div>
            <h3>{colaLibre.length ? "Siguiente caso de la cola" : "Cola vacía"}</h3>
            <p>
              {masAntiguo
                ? `El más antiguo es el #${masAntiguo.number} (${masAntiguo.clinic.name}), esperando ${diasDesde(masAntiguo.createdAt, ahora)} días. Al abrirlo queda asociado a ti.`
                : "Ahora mismo no hay estudios pendientes de valorar en clínicas sin prescriptor."}
            </p>
          </div>
          <button type="submit" disabled={colaLibre.length === 0}>
            Abrir el siguiente caso
          </button>
        </form>
      ) : (
        <div className="rev-next">
          <div>
            <h3>{colaLibre.length ? `${colaLibre.length} caso${colaLibre.length === 1 ? "" : "s"} pendiente${colaLibre.length === 1 ? "" : "s"} de tu prescripción` : "Nada pendiente de prescribir"}</h3>
            <p>Elige el caso en la lista de abajo. Al abrirlo queda asociado a ti hasta que lo cierres o lo sueltes.</p>
          </div>
        </div>
      )}

      <div className="sp" />
      <div className="card">
        <div className="row between">
          <b>{modo === "central" ? "Cola central (por antigüedad)" : "Casos de la clínica pendientes"}</b>
          <span className="tiny">{cola.length} en total</span>
        </div>
        {cola.length ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Paciente</th>
                  {modo === "central" && <th>Clínica</th>}
                  <th>Motivo</th>
                  <th>Señales</th>
                  <th>Espera</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cola.map((c, i) => (
                  <FilaCola key={c.id} c={c} ahora={ahora} modo={modo} userId={user.id} primero={i === 0} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 6 }}>
            Sin casos en cola.
          </div>
        )}
      </div>

      {contact.length > 0 && (
        <>
          <div className="sp" />
          <div className="card">
            <b>Tus casos en contacto con el paciente</b>
            <div className="tiny">Asignados a ti hasta resolverlos. Llama, y después firma o cierra el caso.</div>
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Paciente</th>
                  <th>Teléfono</th>
                  <th>Último apunte</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contact.map((c) => (
                  <tr key={c.id}>
                    <td>#{c.number}</td>
                    <td>{c.patient.name}</td>
                    <td>
                      {c.patient.owner.phone ? <a href={`tel:${c.patient.owner.phone}`}>{c.patient.owner.phone}</a> : "—"}
                    </td>
                    <td className="muted">{c.events[0]?.text ?? "—"}</td>
                    <td>
                      <Link href={`/caso/${c.id}`} className="btn pri">
                        Retomar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {firmadas.length > 0 && (
        <>
          <div className="sp" />
          <div className="card">
            <b>Tus últimas prescripciones</b>
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Paciente</th>
                  <th>Diagnóstico</th>
                  <th>Firmada</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {firmadas.map((p) => (
                  <tr key={p.id}>
                    <td>#{p.case.number}</td>
                    <td>{p.case.patient.name}</td>
                    <td className="muted">{p.diagnosis}</td>
                    <td className="tiny">{fmtd(p.signedAt)}</td>
                    <td>
                      <StatePill state={p.case.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="sp" />
      <div className="tiny">
        {modo === "central"
          ? `El reparto es automático por antigüedad: al abrir un caso queda asociado a ti y desaparece de la cola del resto. Si cierras sesión sin terminarlo (o pasan ${OPEN_CASE_TIMEOUT_MIN} min de inactividad), vuelve al principio de la cola con tus notas guardadas.`
          : `Al abrir un caso queda asociado a ti; si cierras sesión sin terminarlo (o pasan ${OPEN_CASE_TIMEOUT_MIN} min de inactividad) se libera con tus notas guardadas.`}
      </div>
    </>
  );
}

function FilaCola({
  c,
  ahora,
  modo,
  userId,
  primero,
}: {
  c: CasoCola;
  ahora: number;
  modo: "central" | "clinica";
  userId: string;
  primero: boolean;
}) {
  const q = (c.capture?.questionnaire as Questionnaire | null) ?? null;
  const e = (c.capture?.physicalExam as Exam | null) ?? null;
  const s = sintesisDe(q, e, c.capture?.media ?? []);
  const alertas = s.claves.filter((x) => x.nivel === "alerta").length;
  const revisar = s.claves.filter((x) => x.nivel === "revisar").length;
  const years = edad(c.patient.birthDate);
  const dias = diasDesde(c.createdAt, ahora);
  const otro = !!c.openBy && c.openBy !== userId;
  return (
    <tr>
      <td>
        #{c.number}
        {primero && modo === "central" && (
          <>
            {" "}
            <span className="pill">siguiente</span>
          </>
        )}
      </td>
      <td>
        {c.patient.name}
        {years !== null && <span className="tiny"> · {years} a.</span>}
      </td>
      {modo === "central" && <td className="muted">{c.clinic.name}</td>}
      <td className="muted" style={{ maxWidth: 260 }}>
        {q?.motivo || "—"}
        {q?.dolor ? <span className="tiny"> · dolor {String(q.dolor).includes("/") ? q.dolor : `${q.dolor}/10`}</span> : null}
      </td>
      <td>
        {alertas > 0 && <span className="pill r">{alertas} alerta{alertas > 1 ? "s" : ""}</span>}{" "}
        {revisar > 0 && <span className="pill a">{revisar} a revisar</span>}
        {alertas + revisar === 0 && <span className="tiny">—</span>}
      </td>
      <td>
        <span className={`pill ${dias >= 2 ? "r" : dias >= 1 ? "a" : "n"}`}>
          {dias === 0 ? "hoy" : `${dias} d`}
        </span>
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        {modo === "clinica" ? (
          otro ? (
            <span className="tiny">abierto por otro profesional</span>
          ) : c.openBy === userId ? (
            <Link href={`/caso/${c.id}`} className="btn pri">
              Continuar
            </Link>
          ) : (
            <form action={openCaseAction}>
              <input type="hidden" name="caseId" value={c.id} />
              <button type="submit" className={primero ? "pri" : ""}>
                Valorar
              </button>
            </form>
          )
        ) : (
          <span className="row" style={{ gap: 6 }}>
            <StatePill state={c.state} />
          </span>
        )}
      </td>
    </tr>
  );
}
