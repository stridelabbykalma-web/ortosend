import Link from "next/link";
import type { CaseState, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { releaseStale } from "@/lib/cases";
import { nextTallerAction } from "@/app/panel/taller-actions";

const PHASES: [CaseState, string][] = [
  ["ENTRADA_TALLER", "Entrada"],
  ["DISENO", "Diseño"],
  ["FABRICACION", "Fabricación"],
  ["CALIDAD", "Calidad"],
  ["ENVIADO", "Envío"],
];

export async function PanelTaller({ user }: { user: User }) {
  await releaseStale();
  const active = await prisma.case.findMany({
    where: { state: { in: PHASES.map(([s]) => s) } },
    include: { patient: true },
    orderBy: { createdAt: "asc" },
  });
  const openUsers = new Map<string, string>();
  for (const c of active) {
    if (c.openBy && !openUsers.has(c.openBy)) {
      const u = await prisma.user.findUnique({ where: { id: c.openBy } });
      openUsers.set(c.openBy, u?.name ?? "—");
    }
  }
  const incidents = await prisma.incident.count({ where: { closedAt: null } });
  const mineOpen = active.find((c) => c.openBy === user.id);
  return (
    <>
      <div className="row between">
        <h2>Taller · Producción</h2>
        <div className="row">
          <span className="tiny">{active.length} casos activos</span>
          {incidents > 0 && <span className="pill a">{incidents} incidencias abiertas</span>}
        </div>
      </div>
      <div className="sp" />
      {mineOpen ? (
        <div className="note a">
          Tienes el caso #{mineOpen.number} abierto. <Link href={`/caso/${mineOpen.id}`}>Continuar</Link>
        </div>
      ) : (
        <form action={nextTallerAction}>
          <button type="submit" className="pri">
            Siguiente caso (el más antiguo pendiente)
          </button>
        </form>
      )}
      <div className="sp" />
      <div className="cols">
        {PHASES.map(([state, label]) => {
          const cs = active.filter((c) => c.state === state);
          return (
            <div className="col" key={state}>
              <h4>
                {label} · {cs.length}
              </h4>
              {cs.length === 0 && (
                <div className="tiny" style={{ padding: 4 }}>
                  —
                </div>
              )}
              {cs.map((c) => (
                <Link href={`/caso/${c.id}`} className="tcard" key={c.id}>
                  <b>#{c.number}</b> {c.patient.name.split(" ")[0]}
                  <div className="tiny">
                    {c.state === "FABRICACION"
                      ? `${c.fabPhase === "MECANIZADO" ? "Mecanizado CNC" : "Confección a mano"}${c.lot ? ` · ${c.lot}` : ""}`
                      : c.openBy
                        ? `Abierto: ${openUsers.get(c.openBy)?.split(" ")[0] ?? "—"}`
                        : "En cola"}
                  </div>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
      <div className="sp" />
      <div className="tiny">
        Vista de supervisión. El trabajo diario entra por «Siguiente caso»; el tablero muestra la
        carga por fase. Compromiso: entrega en 5 días laborables desde el pago.
      </div>
    </>
  );
}
