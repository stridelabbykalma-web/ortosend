import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/cases";
import { EMPRESA } from "@/lib/legal";
import { fmtd } from "@/lib/format";
import { nombreCompleto } from "@/lib/nombre";
import { Imprimir } from "@/components/caso/imprimir";

export const dynamic = "force-dynamic";

// Declaración de producto a medida (Anexo XIII del Reglamento (UE) 2017/745).
// Acompaña a cada par de plantillas: identifica fabricante, paciente,
// prescriptor y las características de diseño prescritas, y declara la
// conformidad con el Anexo I. Documentación a conservar 10 años (MDR).
export default async function AnexoXIIIPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const kase = await prisma.case.findUnique({
    where: { id },
    include: { patient: { include: { owner: true } }, clinic: true, prescription: true },
  });
  if (!kase) notFound();
  const k = kase!;
  const isOwner = user.role === "CLIENTE" && k.patient.ownerId === user.id;
  const isClinicStaff =
    (user.role === "PROFESIONAL" || user.role === "ADMIN_CLINICA") && user.clinicId === k.clinicId;
  const isStaff = isClinicStaff || user.role === "RECETADOR" || user.role === "TALLER" || user.role === "ADMIN";
  if (!isOwner && !isStaff) redirect("/panel");
  const rx = k.prescription;
  if (!rx) redirect(`/caso/${k.id}`); // sin prescripción no hay producto a medida
  await audit(user.id, "case.anexo13", `case:${k.number}`, k.patientId);

  const filas: [string, React.ReactNode][] = [
    [
      "Fabricante",
      <>
        {EMPRESA.razonSocial} — {EMPRESA.cif}
        <br />
        {EMPRESA.domicilio}
        <br />
        {EMPRESA.email} · {EMPRESA.web}
      </>,
    ],
    [
      "Producto",
      <>
        Par de plantillas ortopédicas fabricadas a medida (producto sanitario a medida, clase I) ·
        Caso #{k.number}
        {k.lot ? <> · Lote de mecanizado {k.lot}</> : null}
        {k.material ? <> · Material {k.material}</> : null}
      </>,
    ],
    [
      "Paciente destinatario",
      <>
        {nombreCompleto(k.patient)} — producto destinado a la utilización exclusiva de este
        paciente.
      </>,
    ],
    [
      "Prescripción",
      <>
        {rx.prescriberName} (n.º de colegiado {rx.collegiateNum}), firmada el {fmtd(rx.signedAt)}.
        {rx.pdfSha256 ? <> Huella SHA-256 del documento de prescripción: {rx.pdfSha256}.</> : null}
      </>,
    ],
    [
      "Características específicas según la prescripción",
      <>
        {rx.fabricationOrder}
        {rx.orderLeft ? (
          <>
            <br />
            Pie izquierdo: {rx.orderLeft}
          </>
        ) : null}
        {rx.orderRight ? (
          <>
            <br />
            Pie derecho: {rx.orderRight}
          </>
        ) : null}
      </>,
    ],
    ["Estudio realizado en", `${k.clinic.name} — ${k.clinic.address}, ${k.clinic.postalCode} ${k.clinic.town}`],
  ];

  return (
    <div className="wrap hoja">
      <div className="sp2 noprint" />
      <div className="row between noprint" style={{ marginBottom: 14 }}>
        <Link href={`/caso/${k.id}`}>← Volver al caso</Link>
        <Imprimir>Imprimir / guardar PDF</Imprimir>
      </div>
      <div className="hoja-paper">
        <div className="row between">
          <div>
            <div className="logo">
              orto<b>send</b>
            </div>
            <h2 style={{ marginTop: 4 }}>Declaración de producto a medida</h2>
            <div className="tiny">Anexo XIII del Reglamento (UE) 2017/745 sobre los productos sanitarios</div>
          </div>
          <div className="hoja-num">#{k.number}</div>
        </div>
        <table className="hoja-meta" style={{ marginTop: 14 }}>
          <tbody>
            {filas.map(([t, v]) => (
              <tr key={t}>
                <th style={{ width: 220 }}>{t}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hoja-bloque">
          <div className="tiny">DECLARACIÓN</div>
          <p>
            El fabricante declara que este producto, fabricado expresamente según la prescripción
            escrita arriba indicada y destinado a la utilización exclusiva del paciente señalado,
            es conforme con los requisitos generales de seguridad y funcionamiento del Anexo I del
            Reglamento (UE) 2017/745 que le son de aplicación. No hay requisitos de dicho anexo que
            no se hayan cumplido plenamente.
          </p>
          <p className="tiny">
            La documentación de este producto (prescripción, orden de fabricación y esta
            declaración) se conserva a disposición de las autoridades competentes durante 10 años a
            partir de la fecha de fabricación. La declaración se entrega al paciente junto con el
            producto o queda disponible en su panel.
          </p>
        </div>
        <div className="row between" style={{ marginTop: 18 }}>
          <div className="tiny">
            {EMPRESA.nombreComercial} · Documento generado el {fmtd(new Date())}
          </div>
          <div className="tiny">Caso #{k.number}</div>
        </div>
      </div>
    </div>
  );
}
