import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { hashSecreto } from "@/lib/consent/tokens";
import { ETIQUETA, ORDEN, SLUG, esObligatorio } from "@/lib/consent/tipos";
import { permitirPublico } from "@/lib/rate-limit";
import { Flash } from "@/components/ui";
import { fmtd, fmtdt } from "@/lib/format";
import { aceptarAltaWebAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  title: "Acepta tus documentos · Ortosend",
};

// Aceptación de los documentos del alta por la web: el respaldo cuando el móvil
// no tiene WhatsApp (o el paciente prefiere hacerlo aquí). El enlace llega por
// email o lo abre la clínica en su dispositivo. Registra exactamente lo mismo
// que la vía de WhatsApp, con canal «web_alta».
export default async function AltaWebPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  if (!(await permitirPublico("alta-web")))
    return <Caja><div className="note r">Demasiadas peticiones. Espera un minuto y vuelve a abrir el enlace.</div></Caja>;
  const inv = await prisma.consentInvitation.findUnique({
    where: { webTokenHash: hashSecreto(token) },
    include: { patient: true, consentLogs: true },
  });
  if (!inv)
    return <Caja><div className="note r">Este enlace no es válido. Usa el último email que te enviamos o pide a tu clínica que te lo reenvíe.</div></Caja>;
  if (inv.completedAt)
    return (
      <Caja>
        <div className="note">
          ✅ Los documentos quedaron aceptados el {fmtdt(inv.completedAt)}. No tienes que hacer nada más: tu clínica
          continúa con el estudio y te enviará el acceso a tu perfil cuando esté listo.
        </div>
      </Caja>
    );
  if (inv.invalidatedAt)
    return <Caja><div className="note a">Este enlace fue sustituido por un reenvío. Usa el último email o WhatsApp que te enviamos.</div></Caja>;
  if (inv.expiresAt <= new Date())
    return <Caja><div className="note a">El enlace ha caducado (dura 72 h desde el envío). Pide a tu clínica que te lo reenvíe.</div></Caja>;

  const p = inv.patient;
  const textos = await prisma.legalText.findMany({
    where: { id: { in: Object.values(inv.legalTextIds as Record<string, string>) } },
  });
  const textoDe = (t: (typeof ORDEN)[number]) =>
    textos.find((x) => x.id === (inv.legalTextIds as Record<string, string>)[t]) ?? null;
  const esTutor = inv.recipient === "tutor";

  return (
    <Caja>
      <Flash error={error} />
      <p className="muted">
        {esTutor ? (
          <>Hola {p.tutorName}: tu clínica ha iniciado el alta de <b>{p.name}</b> (menor a tu cargo) en Ortosend.</>
        ) : (
          <>Hola {p.name}: tu clínica ha iniciado tu alta en Ortosend.</>
        )}{" "}
        Lee cada documento y márcalo. Los cuatro primeros son necesarios para poder atenderte; el de comunicaciones es
        opcional. Quedará registrado con fecha, hora y la versión exacta de cada texto.
      </p>
      <form action={aceptarAltaWebAction}>
        <input type="hidden" name="token" value={token} />
        {ORDEN.map((t, i) => {
          const texto = textoDe(t);
          if (!texto) return null;
          return (
            <details key={t} className="card" style={{ marginBottom: 10 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                {i + 1}. {ETIQUETA[t]}
              </summary>
              <div className="tiny" style={{ margin: "6px 0" }}>
                {texto.title} · versión {texto.version} · en vigor desde {fmtd(texto.validFrom)}
              </div>
              <div
                className="card"
                style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, maxHeight: 320, overflowY: "auto", marginTop: 6 }}
              >
                {texto.content}
              </div>
              <div style={{ marginTop: 10 }}>
                {esObligatorio(t) ? (
                  <label className="chk">
                    <input type="checkbox" name={`acepto_${SLUG[t]}`} required /> He leído y <b>acepto</b> este documento
                  </label>
                ) : (
                  <>
                    <label className="chk">
                      <input type="radio" name="marketing" value="acepto" required /> Acepto recibir comunicaciones
                      comerciales
                    </label>
                    <label className="chk">
                      <input type="radio" name="marketing" value="rechazo" /> No quiero comunicaciones comerciales
                      (puedo seguir con el alta igualmente)
                    </label>
                  </>
                )}
              </div>
            </details>
          );
        })}
        <div className="tiny" style={{ margin: "10px 0" }}>
          {esTutor
            ? `Declaras ser el padre, la madre o el tutor legal de ${p.name} y aceptar en su nombre.`
            : "Aceptas en tu propio nombre."}{" "}
          Puedes retirar cualquier consentimiento más adelante.
        </div>
        <button type="submit" className="pri wfull">
          Confirmar y empezar el estudio
        </button>
      </form>
    </Caja>
  );
}

function Caja({ children }: { children: React.ReactNode }) {
  return (
    <div className="wrap" style={{ maxWidth: 640 }}>
      <div className="sp2" />
      <h2>Documentos de tu alta</h2>
      <div className="sp" />
      {children}
      <div className="sp2" />
    </div>
  );
}
