import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/cases";
import { fmtd } from "@/lib/format";
import { nombreProyectoRevoScan } from "@/lib/scan";
import { PROD_STEPS, QC_CHECKS, fichaTecnica, trabajoPorPie, type TrabajoPie } from "@/lib/taller";
import { Imprimir } from "@/components/caso/imprimir";
import type { Questionnaire } from "@/lib/questionnaire";
import type { Exam } from "@/lib/exploracion";

export const dynamic = "force-dynamic";

// Etiqueta de molde (una por pie): número de caso, talla, lote y, sobre todo,
// qué hay que hacer en ESE pie (pauta del pie y datos del estudio de ese lado).
function Etiqueta({
  t,
  numero,
  talla,
  nombre,
  lote,
}: {
  t: TrabajoPie;
  numero: number;
  talla: string;
  nombre: string;
  lote: string | null;
}) {
  return (
    <div className="etiqueta">
      <div className="etiqueta-cab">
        <div className="lado">{t.pie}</div>
        <div>
          <b>
            #{numero} · Pie {t.nombre.toLowerCase()}
          </b>{" "}
          {talla}
          <div className="tiny">
            {nombre} · {lote ? `Lote ${lote}` : "Lote ____"}
          </div>
        </div>
      </div>
      <div className="etiqueta-trabajo">
        <div className="tiny">{t.especifica ? `QUÉ HACER EN EL PIE ${t.nombre.toUpperCase()}` : "QUÉ HACER (IGUAL EN LOS DOS PIES)"}</div>
        <div>{t.pauta}</div>
        {t.datos.length > 0 && <div className="etiqueta-datos">{t.datos.join(" · ")}</div>}
      </div>
    </div>
  );
}

// Hoja de trabajo del taller: acompaña físicamente al par (una hoja A4) y
// lleva las dos etiquetas de molde (I / D). Solo taller y administración.
export default async function HojaPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "TALLER" && user.role !== "ADMIN") redirect("/panel");
  const { id } = await params;
  const kase = await prisma.case.findUnique({
    where: { id },
    include: { patient: { include: { owner: true } }, clinic: true, capture: true, prescription: true, payment: true },
  });
  if (!kase) notFound();
  const k = kase!;
  await audit(user.id, "case.hoja", `case:${k.number}`);

  const q = k.capture?.questionnaire as Questionnaire | null;
  const e = k.capture?.physicalExam as Exam | null;
  const ficha = fichaTecnica(q, e, k);
  const proyecto = nombreProyectoRevoScan(k.patient.name, k.patient.owner.phone, k.number);
  const talla = q?.tallaCalzado ? `T ${q.tallaCalzado}` : "";
  const [izq, dcho] = trabajoPorPie(k.prescription, e, q);

  return (
    <div className="wrap hoja">
      <div className="sp2 noprint" />
      <div className="row between noprint" style={{ marginBottom: 14 }}>
        <Link href={`/caso/${k.id}`}>← Volver al caso</Link>
        <Imprimir>Imprimir hoja y etiquetas</Imprimir>
      </div>
      <div className="hoja-paper">
        <div className="row between">
          <div>
            <div className="logo">
              orto<b>send</b> <span className="muted">· Taller</span>
            </div>
            <h2 style={{ marginTop: 4 }}>Hoja de trabajo — caso #{k.number}</h2>
          </div>
          <div className="hoja-num">#{k.number}</div>
        </div>
        <table className="hoja-meta">
          <tbody>
            <tr>
              <th>Paciente</th>
              <td>{k.patient.name}</td>
              <th>Clínica</th>
              <td>{k.clinic.name} ({k.clinic.town})</td>
            </tr>
            <tr>
              <th>Entrega</th>
              <td>{k.delivery === "CLINICA" ? `Recogida en clínica — ${k.clinic.address}, ${k.clinic.postalCode} ${k.clinic.town}` : "Domicilio del paciente"}</td>
              <th>Pago</th>
              <td>{k.payment?.paidAt ? fmtd(k.payment.paidAt) : "—"} · entrega en 5 días laborables</td>
            </tr>
            <tr>
              <th>Escaneo</th>
              <td colSpan={3}>
                Proyecto Revo Scan «{proyecto}» · carpeta compartida de {k.clinic.name}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="hoja-bloque">
          <div className="tiny">PAUTA DE FABRICACIÓN</div>
          <p className="pauta">{k.prescription?.fabricationOrder ?? "— sin prescripción —"}</p>
          {(izq.especifica || dcho.especifica) && (
            <div className="grid g2" style={{ gap: "6px 18px", margin: "4px 0 8px" }}>
              {[izq, dcho].map((t) => (
                <div key={t.pie} className="pie-bloque">
                  <b>Pie {t.nombre.toLowerCase()}</b>
                  <div>{t.pauta}</div>
                </div>
              ))}
            </div>
          )}
          <div className="tiny">
            Diagnóstico: {k.prescription?.diagnosis ?? "—"} · Prescribe {k.prescription?.prescriberName ?? "—"}
            {k.prescription?.collegiateNum ? ` (col. ${k.prescription.collegiateNum})` : ""}
          </div>
        </div>

        <div className="grid g2" style={{ gap: 18 }}>
          <div className="hoja-bloque">
            <div className="tiny">DATOS DEL PAR</div>
            <dl className="ficha-dl">
              {ficha.map(([l, v]) => (
                <div key={l}>
                  <dt>{l}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="hoja-bloque">
            <div className="tiny">FASES · fecha y firma</div>
            <table className="hoja-fases">
              <tbody>
                {PROD_STEPS.filter((s) => s.key !== "entrega").map((s) => (
                  <tr key={s.key}>
                    <td className="box">☐</td>
                    <td>{s.label}</td>
                    <td className="linea">
                      {s.key === "mecanizado" ? `Lote ${k.lot ?? "______"}` : s.key === "confeccion" ? `Material ${k.material ?? "______________"}` : ""}
                    </td>
                    <td className="linea firma"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="hoja-bloque">
          <div className="tiny">CONTROL DE CALIDAD</div>
          <div className="grid g2" style={{ gap: "2px 18px" }}>
            {QC_CHECKS.map(([key, label]) => (
              <div key={key}>☐ {label}</div>
            ))}
            <div>☐ Foto del par subida a la app</div>
          </div>
        </div>

        <div className="hoja-bloque etiquetas">
          <div className="tiny">ETIQUETAS DE MOLDE (recortar)</div>
          <div className="grid g2" style={{ gap: 12 }}>
            <Etiqueta t={izq} numero={k.number} talla={talla} nombre={k.patient.name} lote={k.lot} />
            <Etiqueta t={dcho} numero={k.number} talla={talla} nombre={k.patient.name} lote={k.lot} />
          </div>
        </div>
        <div className="tiny" style={{ marginTop: 14 }}>
          Documento interno del taller. Contiene datos de salud: no sale del taller y se destruye al entregar el par.
        </div>
      </div>
    </div>
  );
}
