// El taller en el móvil: los pedidos como post-its por columnas, en el orden en que deben salir.
// Cada persona entra con su usuario; la página se actualiza sola.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { listaPedidos } from "@/lib/taller-pedidos";
import { Refrescar } from "@/components/taller/refrescar";
import { COLUMNAS_TALLER, PostIt, type PedidoResumen } from "@/components/taller/postits";

export const dynamic = "force-dynamic";

export default async function TallerMovil({ searchParams }: { searchParams: Promise<{ col?: string; ok?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/equipo?next=/taller");
  if (user.role !== "TALLER" && user.role !== "ADMIN") redirect("/panel");
  const { col, ok } = await searchParams;
  const pedidos = (await listaPedidos()) as PedidoResumen[];
  const actual = COLUMNAS_TALLER.find(([k]) => k === col) ?? COLUMNAS_TALLER[0];
  const visibles = pedidos.filter(actual[2]);
  return (
    <main className="wrap" style={{ maxWidth: 560, padding: "12px 12px 40px" }}>
      <Refrescar segundos={20} />
      <div className="row between">
        <h2 style={{ margin: "4px 0" }}>Taller</h2>
        <span className="tiny">{user.name}</span>
      </div>
      {ok && <div className="note g">{ok}</div>}
      <div className="row" style={{ gap: 6, margin: "10px 0" }}>
        {COLUMNAS_TALLER.map(([k, t, esta]) => (
          <Link key={k} href={`/taller?col=${k}`} className={`btn ${k === actual[0] ? "pri" : ""}`} style={{ padding: "6px 10px" }}>
            {t} · {pedidos.filter(esta).length}
          </Link>
        ))}
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {visibles.length === 0 && <p className="muted">No hay pedidos en «{actual[1]}».</p>}
        {visibles.map((p) => (
          <PostIt key={p.id} p={p} />
        ))}
      </div>
    </main>
  );
}
