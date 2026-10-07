import type { Metadata } from "next";
import { Flash } from "@/components/ui";
import { ListaConsentimientos } from "@/components/consent/lista";
import { prisma } from "@/lib/db";
import { hashSecreto } from "@/lib/consent/tokens";
import { permitirPublico } from "@/lib/rate-limit";
import { gestionarDesdeEnlaceAction } from "./actions";
import { pacientesDelTelefono } from "./datos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false }, referrer: "no-referrer", title: "Mis consentimientos · Ortosend" };

// Gestión de consentimientos sin cuenta: enlace de 24 h pedido por WhatsApp
// (escribiendo BAJA o pulsando «Mis consentimientos»).
export default async function GestionConsentimientos({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { token } = await params;
  const { ok } = await searchParams;
  if (!(await permitirPublico("gestion")))
    return <Caja><div className="note r">Demasiadas peticiones. Espera un minuto.</div></Caja>;
  const t = await prisma.consentManageToken.findUnique({ where: { tokenHash: hashSecreto(token) } });
  if (!t || t.expiresAt <= new Date())
    return (
      <Caja>
        <div className="note r">
          El enlace ha caducado (dura 24 h). Escribe <b>BAJA</b> en nuestro chat de WhatsApp y te enviaremos otro.
        </div>
      </Caja>
    );
  const pacientes = await pacientesDelTelefono(t.phone);
  return (
    <Caja>
      <Flash ok={ok} />
      <p className="muted">
        Puedes retirar cualquier consentimiento con un clic. Retirarlo no borra tu historia clínica (la ley obliga a
        conservarla), pero detiene el tratamiento y las comunicaciones.
      </p>
      {pacientes.map((p) => (
        <div key={p.id}>
          {pacientes.length > 1 && <h3>{[p.name, p.lastName].filter(Boolean).join(" ")}</h3>}
          <ListaConsentimientos patientId={p.id} action={gestionarDesdeEnlaceAction} ocultos={{ token }} />
          <div className="sp" />
        </div>
      ))}
      {!pacientes.length && <div className="note">No hay consentimientos registrados con este móvil.</div>}
    </Caja>
  );
}

function Caja({ children }: { children: React.ReactNode }) {
  return (
    <div className="wrap" style={{ maxWidth: 560 }}>
      <div className="sp2" />
      <h2>Mis consentimientos</h2>
      <div className="sp" />
      {children}
    </div>
  );
}
