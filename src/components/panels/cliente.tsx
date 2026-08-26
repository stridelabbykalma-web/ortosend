import Link from "next/link";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { StatePill, Steps } from "@/components/ui";
import { payAction } from "@/app/panel/cliente-actions";
import { fmtdt, PRICE_LABEL } from "@/lib/format";

export async function PanelCliente({ user }: { user: User }) {
  const cases = await prisma.case.findMany({
    where: { patient: { ownerId: user.id } },
    include: { clinic: true, prescription: true, shipment: true },
    orderBy: { createdAt: "desc" },
  });
  if (cases.length === 0) {
    return (
      <div className="card">
        <b>Aún no tienes ningún tratamiento</b>
        <p className="muted" style={{ marginTop: 6 }}>
          Reserva tu primera cita en una clínica asociada.
        </p>
        <Link href="/buscar" className="btn pri" style={{ marginTop: 10 }}>
          Buscar clínica
        </Link>
      </div>
    );
  }
  return (
    <>
      <h2>Hola, {user.name.split(" ")[0]}</h2>
      <div className="sp" />
      {cases.map((c) => {
        let body: React.ReactNode = null;
        switch (c.state) {
          case "CITA_RESERVADA":
            body = (
              <>
                <b>Tu cita: {fmtdt(c.appointmentAt)}</b>
                <div className="muted">
                  {c.clinic.name} · {c.clinic.address}. Trae tu calzado habitual y ropa cómoda.
                </div>
              </>
            );
            break;
          case "ESTUDIO_EN_CURSO":
          case "ESTUDIO_COMPLETO":
          case "EN_PRESCRIPCION":
            body = (
              <>
                <b>Tu estudio está en marcha</b>
                <div className="muted">
                  Nuestro equipo lo está valorando. Te avisaremos por WhatsApp en un máximo de 48 h
                  laborables.
                </div>
              </>
            );
            break;
          case "EN_CONTACTO":
            body = (
              <>
                <b>Un profesional quiere hablar contigo</b>
                <div className="muted">
                  El podólogo que valora tu caso te llamará para aclarar un par de cuestiones antes
                  de la prescripción.
                </div>
              </>
            );
            break;
          case "DEVUELTO_CLINICA":
            body = (
              <>
                <b>Necesitamos repetir una prueba</b>
                <div className="muted">Tu clínica te contactará para una cita breve. Sin coste para ti.</div>
              </>
            );
            break;
          case "NO_PRESCRITO":
            body = (
              <>
                <b>Tu valoración está completa</b>
                <div className="muted">
                  Nuestro equipo ha estudiado tu caso y el tratamiento con plantillas no está
                  indicado. No se te cobrará nada.
                </div>
              </>
            );
            break;
          case "NO_CONVERTIDO":
            body = (
              <>
                <b>Tu enlace de pago ha caducado</b>
                <div className="muted">
                  Escríbenos por WhatsApp y lo reactivamos (hasta 6 meses desde tu prescripción).
                </div>
              </>
            );
            break;
          case "PENDIENTE_PAGO":
            body = (
              <>
                <b>Tu prescripción está lista</b>
                <div className="muted">
                  Firmada por {c.prescription?.prescriberName}. Revisa el documento y completa el
                  pago para iniciar la fabricación. Enlace válido hasta {fmtdt(c.payLinkExpiresAt)}.
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <Link href={`/caso/${c.id}`} className="btn">
                    Ver prescripción (pide contraseña)
                  </Link>
                </div>
                <div className="card" style={{ marginTop: 12, background: "var(--paper)" }}>
                  <b>Pago — {PRICE_LABEL}</b>
                  <form action={payAction}>
                    <input type="hidden" name="caseId" value={c.id} />
                    <label>¿Dónde quieres recibirlas?</label>
                    <select name="delivery" defaultValue="DOMICILIO">
                      <option value="DOMICILIO">Envío a mi domicilio</option>
                      <option value="CLINICA">Recogida en mi clínica ({c.clinic.name})</option>
                    </select>
                    <label>Método</label>
                    <select name="method" defaultValue="card">
                      <option value="card">Tarjeta</option>
                      <option value="bizum">Bizum</option>
                    </select>
                    <div className="sp" />
                    <button type="submit" className="pri wfull">
                      Pagar {PRICE_LABEL} (simulado — Stripe pendiente)
                    </button>
                  </form>
                </div>
              </>
            );
            break;
          case "ENTRADA_TALLER":
          case "DISENO":
          case "FABRICACION":
          case "CALIDAD":
            body = (
              <>
                <b>Tus plantillas se están fabricando</b>
                <div className="muted">
                  Mecanizamos el molde a partir de tu escaneo 3D y las confeccionamos a mano.
                  Entrega estimada: 5 días laborables desde tu pago.
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <Link href={`/caso/${c.id}`} className="btn">
                    Ver mi prescripción
                  </Link>
                </div>
              </>
            );
            break;
          case "ENVIADO":
            body = (
              <>
                <b>¡En camino!</b>
                <div className="muted">
                  {c.delivery === "CLINICA"
                    ? `Enviadas a tu clínica (${c.clinic.name}). Te avisarán para recogerlas.`
                    : `Seguimiento: ${c.shipment?.tracking ?? "—"}.`}
                </div>
              </>
            );
            break;
          case "ENTREGADO":
          case "CERRADO":
            body = (
              <>
                <b>Entregadas — guía de adaptación</b>
                <div className="muted">
                  Uso progresivo 2-3 semanas, con calzado cerrado. Vida útil orientativa: 2-4 años /
                  ~800 km. Tu revisión anual queda programada — te avisaremos.
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <Link href={`/caso/${c.id}`} className="btn">
                    Mis documentos
                  </Link>
                </div>
              </>
            );
            break;
        }
        return (
          <div className="card" key={c.id} style={{ marginBottom: 18 }}>
            <div className="row between">
              <b style={{ fontFamily: "var(--font-sora)" }}>Tratamiento #{c.number}</b>
              <StatePill state={c.state} />
            </div>
            <Steps state={c.state} />
            {body}
            <div className="tiny" style={{ marginTop: 12 }}>
              ¿Dudas? Escríbenos por WhatsApp (canal principal de Ortosend).
            </div>
          </div>
        );
      })}
    </>
  );
}
