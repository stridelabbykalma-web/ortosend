import Link from "next/link";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { releaseStale } from "@/lib/cases";
import { Kpi } from "@/components/ui";
import { answerReviewAction, nextRxAction } from "@/app/panel/rx-actions";

export async function PanelRecetador({ user }: { user: User }) {
  await releaseStale();
  const [queueCount, mineOpen, contact, reviews] = await Promise.all([
    prisma.case.count({
      where: { state: "EN_PRESCRIPCION", openBy: null, clinic: { hasPrescriber: false } },
    }),
    prisma.case.findFirst({ where: { openBy: user.id }, include: { patient: true } }),
    prisma.case.findMany({
      where: { state: "EN_CONTACTO", assignedTo: user.id },
      include: { patient: { include: { owner: true } } },
    }),
    // Revisiones de recetas directas pendientes de opinión (consultivas, por antigüedad)
    prisma.case.findMany({
      where: { reviewRequestedAt: { not: null }, reviewAnswer: null },
      include: { prescription: true, clinic: true },
      orderBy: { reviewRequestedAt: "asc" },
    }),
  ]);
  return (
    <>
      <h2>Cola central de prescripción</h2>
      <div className="grid g3" style={{ margin: "14px 0" }}>
        <Kpi v={queueCount} l="Casos en cola" />
        <Kpi v="48 h" l="Compromiso de respuesta" />
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
      {reviews.length > 0 && (
        <>
          <div className="sp" />
          <div className="card">
            <b>Revisiones de recetas directas pendientes</b>
            <div className="tiny" style={{ marginBottom: 6 }}>
              Un prescriptor de clínica ya ha firmado su receta y pide tu opinión. Es consultiva:
              no bloquea ni modifica el caso.
            </div>
            {reviews.map((c) => (
              <div className="card" key={c.id} style={{ padding: 14, marginTop: 8 }}>
                <b style={{ fontSize: 13 }}>
                  <Link href={`/caso/${c.id}`}>Caso #{c.number}</Link> · {c.clinic.name} ·{" "}
                  {c.prescription
                    ? `receta de ${c.prescription.prescriberName} (col. ${c.prescription.collegiateNum})`
                    : "receta directa"}
                </b>
                <div className="muted" style={{ margin: "6px 0" }}>
                  «{c.reviewQuestion}»
                </div>
                {c.prescription && (
                  <div className="tiny" style={{ marginBottom: 6 }}>
                    Receta firmada: {c.prescription.fabricationOrder}
                  </div>
                )}
                <form action={answerReviewAction}>
                  <input type="hidden" name="caseId" value={c.id} />
                  <label>Tu opinión (la verá el prescriptor en el caso)</label>
                  <textarea name="answer" rows={2} required />
                  <div className="sp" />
                  <button type="submit" className="pri">
                    Enviar opinión
                  </button>
                </form>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="sp" />
      <div className="tiny">
        El reparto es automático por antigüedad: al abrir un caso queda asociado a ti y desaparece
        de la cola del resto. Si cierras sesión sin terminarlo (o pasan 45 min de inactividad),
        vuelve al principio de la cola con tus notas guardadas.
      </div>
    </>
  );
}
