// Un pedido en el móvil del taller: pauta por pie, hoja de confección, materiales registrados (con la
// foto de la etiqueta y el lote) y los pasos (molde fresado, confección terminada).
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { detallePedido } from "@/lib/taller-pedidos";
import { materialesTaller } from "@/lib/taller-ops";
import { fmtCaducidad, fmtdt } from "@/lib/format";
import { AnularMaterial, EscanearMaterial } from "@/components/taller/escanear-material";
import { confeccionMovilAction, fresadoMovilAction } from "../actions";

export const dynamic = "force-dynamic";

const PIES: Record<string, string> = { par: "Par", I: "Pie izquierdo", D: "Pie derecho" };

export default async function PedidoMovil({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  const { id } = await params;
  if (!user) redirect(`/equipo?next=/taller/${id}`);
  if (user.role !== "TALLER" && user.role !== "ADMIN") redirect("/panel");
  const { ok, error } = await searchParams;
  let p;
  try {
    p = await detallePedido(id, user);
  } catch {
    redirect("/taller?ok=" + encodeURIComponent("Ese pedido ya no está en el taller"));
  }
  const materiales = (await materialesTaller()).map((m) => ({ id: m.id, nombre: m.nombre }));
  const nivel = p.plazo?.nivel;
  const capas = (p.hoja?.capas ?? []) as { nombre?: string; pies?: string; notas?: string }[];
  const activos = p.materiales.filter((m) => !m.anulado);
  return (
    <main className="wrap" style={{ maxWidth: 560, padding: "12px 12px 40px" }}>
      <Link href="/taller" className="tiny">
        ← Todos los pedidos
      </Link>
      <h2 style={{ margin: "6px 0 2px" }}>
        #{p.numero} · {p.paciente}
      </h2>
      <div className="row" style={{ gap: 6 }}>
        <span className="pill n">{p.paso}</span>
        {p.plazo && <span className={`pill ${nivel === "fuera" ? "r" : nivel === "ajustado" ? "a" : "g"}`}>{p.plazo.texto}</span>}
        {p.lote && <span className="pill n">Lote CNC {p.lote}</span>}
        {p.rehacer && <span className="pill r">⚠ Rehacer</span>}
      </div>
      <div className="tiny" style={{ margin: "4px 0 10px" }}>{p.clinica}</div>
      {ok && <div className="note g">{ok}</div>}
      {error && <div className="note r">{error}</div>}

      <div className="card" style={{ padding: 14 }}>
        <b>Pauta</b>
        {p.pies.map((pie) => (
          <div key={pie.pie} style={{ marginTop: 6 }}>
            <b>{pie.pie}</b> · {pie.pauta}
            {pie.datos.length > 0 && <div className="tiny">{pie.datos.join(" · ")}</div>}
          </div>
        ))}
        {p.hoja && (
          <div style={{ marginTop: 10 }}>
            <b>Hoja de confección</b> · {p.hoja.proceso === "CAPAS" ? "capas pegadas y prensadas" : "termoformado al vacío"}
            <ol style={{ margin: "4px 0 0 18px" }}>
              {capas.map((c, i) => (
                <li key={i}>
                  {c.nombre} · {PIES[c.pies ?? "par"]}
                  {c.notas ? ` · ${c.notas}` : ""}
                </li>
              ))}
            </ol>
            {p.hoja.notas && <div className="muted">{p.hoja.notas}</div>}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <b>Materiales usados ({activos.length})</b>
        <div className="tiny" style={{ marginBottom: 8 }}>
          Cada plancha que uses: foto de su etiqueta. Queda registrado el lote en esta plantilla.
        </div>
        {p.materiales.map((m) => (
          <div key={m.id} className="row" style={{ alignItems: "flex-start", margin: "8px 0", opacity: m.anulado ? 0.55 : 1 }}>
            {m.foto ? (
              <a href={m.foto} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.foto} alt="Etiqueta" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6 }} />
              </a>
            ) : (
              <div style={{ width: 64, height: 64, borderRadius: 6, background: "#eee" }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={m.anulado ? { textDecoration: "line-through" } : {}}>
                <b>{m.material}</b> · lote {m.lote}
              </div>
              <div className="tiny">
                {PIES[m.pies]}
                {m.caducidad ? ` · cad. ${fmtCaducidad(m.caducidad)}` : ""} · {m.quien}, {fmtdt(m.cuando)}
              </div>
              {m.anulado && <div className="tiny">Anulado por {m.anulado.quien}: {m.anulado.motivo}</div>}
            </div>
            {!m.anulado && <AnularMaterial consumoId={m.id} />}
          </div>
        ))}
        <div style={{ marginTop: 10 }}>
          <EscanearMaterial caseId={p.id} materiales={materiales} />
        </div>
      </div>

      {p.estado === "FABRICACION" && p.fase === "MECANIZADO" && (
        <form action={fresadoMovilAction} className="card" style={{ padding: 14, marginTop: 12 }}>
          <input type="hidden" name="caseId" value={p.id} />
          <label>Lote de CNC (tirada)</label>
          <input name="lote" defaultValue={p.lote ?? ""} />
          <button type="submit" className="pri" style={{ width: "100%", marginTop: 10 }}>
            Molde fresado → a confección
          </button>
        </form>
      )}
      {p.estado === "FABRICACION" && p.fase === "CONFECCION" && (
        <form action={confeccionMovilAction} className="card" style={{ padding: 14, marginTop: 12 }}>
          <input type="hidden" name="caseId" value={p.id} />
          <button type="submit" className="pri" style={{ width: "100%" }} disabled={activos.length === 0}>
            Confección terminada → a calidad
          </button>
          {activos.length === 0 && <div className="tiny" style={{ marginTop: 6 }}>Registra antes los materiales usados.</div>}
        </form>
      )}
    </main>
  );
}
