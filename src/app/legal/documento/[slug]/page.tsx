// Texto legal vigente (el mismo que se registra al aceptar en el registro web).
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { textosVigentes } from "@/lib/consent/registro";
import { ETIQUETA, tipoDeSlug } from "@/lib/consent/tipos";
import { fmtd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DocumentoLegal({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tipo = tipoDeSlug(slug);
  if (!tipo) notFound();
  const texto = (await textosVigentes(prisma))[tipo];
  return (
    <div className="wrap" style={{ maxWidth: 680 }}>
      <div className="sp2" />
      <div className="tiny">{ETIQUETA[tipo].toUpperCase()}</div>
      <h2>{texto.title}</h2>
      <div className="sp" />
      <div className="card" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
        {texto.content}
      </div>
      <div className="sp" />
      <div className="tiny">
        Versión {texto.version} · en vigor desde {fmtd(texto.validFrom)}
      </div>
    </div>
  );
}
