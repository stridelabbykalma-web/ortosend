// Texto legal completo enlazado desde cada mensaje de WhatsApp. Muestra la
// versión exacta fijada en la invitación (la que quedará registrada al aceptar),
// aunque después se haya publicado otra.
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { hashSecreto } from "@/lib/consent/tokens";
import { ETIQUETA, ORDEN, SLUG, tipoDeSlug } from "@/lib/consent/tipos";
import { permitirPublico } from "@/lib/rate-limit";
import { fmtd } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function TextoLegalInvitacion({ params }: { params: Promise<{ ref: string; doc: string }> }) {
  const { ref, doc } = await params;
  if (!(await permitirPublico("legal"))) return <Aviso texto="Demasiadas peticiones. Espera un minuto y vuelve a abrir el enlace." />;
  const tipo = tipoDeSlug(doc);
  const inv = tipo ? await prisma.consentInvitation.findUnique({ where: { refHash: hashSecreto(ref) } }) : null;
  const id = inv ? (inv.legalTextIds as Record<string, string>)[tipo!] : null;
  const texto = id ? await prisma.legalText.findUnique({ where: { id } }) : null;
  if (!texto) return <Aviso texto="Este enlace no es válido. Usa el último mensaje de WhatsApp que te enviamos." />;
  const n = ORDEN.indexOf(texto.type) + 1;
  return (
    <div className="wrap" style={{ maxWidth: 680 }}>
      <div className="sp2" />
      <div className="tiny">
        DOCUMENTO {n} DE {ORDEN.length} · {ETIQUETA[texto.type].toUpperCase()}
      </div>
      <h2>{texto.title}</h2>
      <div className="sp" />
      <div className="card" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
        {texto.content}
      </div>
      <div className="sp" />
      <div className="tiny">
        Versión {texto.version} · en vigor desde {fmtd(texto.validFrom)} · huella SHA-256 {texto.sha256.slice(0, 16)}…
      </div>
      <div className="sp" />
      <div className="note">
        Cuando lo hayas leído, vuelve a WhatsApp y pulsa <b>Acepto</b> o <b>No acepto</b> en el mensaje de «
        {ETIQUETA[texto.type]}».{" "}
        {SLUG[texto.type] === "marketing" ? "Este es opcional: puedes decir que no y seguir con el alta." : ""}
      </div>
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="wrap" style={{ maxWidth: 560 }}>
      <div className="sp2" />
      <div className="note r">{texto}</div>
    </div>
  );
}
