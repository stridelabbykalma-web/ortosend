import Link from "next/link";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { releaseStale } from "@/lib/cases";
import { Kpi } from "@/components/ui";
import { nextRxAction } from "@/app/panel/rx-actions";
import { CENTRAL_WHERE } from "@/lib/rx-route";

export async function PanelRecetador({ user }: { user: User }) {
  await releaseStale();
  const [queueCount, revisiones, mineOpen, contact] = await Promise.all([
    prisma.case.count({
      where: { state: "EN_PRESCRIPCION", openBy: null, ...CENTRAL_WHERE },
    }),
    prisma.case.count({ where: { state: "EN_PRESCRIPCION", openBy: null, rxRoute: "REVISION" } }),
    prisma.case.findFirst({ where: { openBy: user.id }, include: { patient: true } }),
    prisma.case.findMany({
      where: { state: "EN_CONTACTO", assignedTo: user.id },
      include: { patient: { include: { owner: true } } },
    }),
  ]);
  return (
    <>
      <h2>Cola central de prescripción</h2>
      <div className="grid g3" style={{ margin: "14px 0" }}>
        <Kpi v={queueCount} l="Casos en cola" />
        <Kpi v={revisiones} l="De ellos, revisiones pedidas por clínicas" />
        <Kpi v={contact.length} l="Pendientes de contacto" />
      </div>
      {mineOpen ? (
        <div className="note a">
          Tienes el caso #{mineOpen.number} abierto (asociado a ti hasta cerrarlo o cerrar sesión).{" "}
          <Link href={`/caso/${mineOpen.id}`}>Continuar</Link>
        </div>
      ) : (
        <form action={nextRxAction}>
          <button type="submit" className="pri" disabled={queueCount === 0}>
            Siguiente caso (el más antiguo)
          </button>
        </form>
      )}
      {contact.length > 0 && (
        <>
          <div className="sp" />
          <div className="card">
            <b>Tus casos en contacto con el paciente</b>
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Paciente</th>
                  <th>Tel.</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contact.map((c) => (
                  <tr key={c.id}>
                    <td>#{c.number}</td>
                    <td>{c.patient.name}</td>
                    <td>{c.patient.owner.phone ?? "—"}</td>
                    <td>
                      <Link href={`/caso/${c.id}`} className="btn">
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
      <div className="sp" />
      <div className="tiny">
        En la cola entran los casos que las clínicas envían a Ortosend y los que piden revisión
        (esos los firma la clínica: tú dejas tu valoración y se lo devuelves). El reparto es
        automático por antigüedad: al abrir un caso queda asociado a ti y desaparece de la cola
        del resto. Si cierras sesión sin terminarlo (o pasan 45 min de inactividad),
        vuelve al principio de la cola con tus notas guardadas.
      </div>
    </>
  );
}
