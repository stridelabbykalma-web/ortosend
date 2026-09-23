import Link from "next/link";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { StatePill, Steps } from "@/components/ui";
import {
  payAction,
  resendHandoverAction,
  updateMyAccountAction,
  updatePatientContactAction,
} from "@/app/panel/cliente-actions";
import { resendVerificationAction } from "@/app/(auth)/actions";
import { fmtd, fmtdt, PRICE_LABEL } from "@/lib/format";
import { EDAD_MAYORIA_SALUD, HANDOVER_TOKEN_DAYS, fechaMayoria } from "@/lib/edad";

export async function PanelCliente({ user }: { user: User }) {
  const cases = await prisma.case.findMany({
    where: { patient: { ownerId: user.id } },
    include: { clinic: true, prescription: true, shipment: true, patient: true },
    orderBy: { createdAt: "desc" },
  });
  const menores = await prisma.patient.findMany({ where: { ownerId: user.id, isMinor: true }, orderBy: { name: "asc" } });
  const variasPersonas = new Set(cases.map((c) => c.patientId)).size > 1 || menores.length > 0;
  if (cases.length === 0) {
    return (
      <>
        <EmailSinConfirmar user={user} />
        <div className="card">
          <b>Aún no tienes ningún tratamiento</b>
          <p className="muted" style={{ marginTop: 6 }}>
            Reserva tu primera cita en una clínica asociada.
          </p>
          <Link href="/buscar" className="btn pri" style={{ marginTop: 10 }}>
            Buscar clínica
          </Link>
        </div>
        <MisDatos user={user} />
      </>
    );
  }
  return (
    <>
      <h2>Hola, {user.name.split(" ")[0]}</h2>
      <div className="sp" />
      <EmailSinConfirmar user={user} />
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
              <b style={{ fontFamily: "var(--font-sora)" }}>
                Tratamiento #{c.number}
                {variasPersonas && <span className="muted"> · {c.patient.name}</span>}
              </b>
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
      <div className="row" style={{ marginTop: 6 }}>
        <Link href="/buscar" className="btn">
          Reservar otra cita (para ti o para un menor a tu cargo)
        </Link>
      </div>
      {menores.length > 0 && <PersonasACargo menores={menores} />}
      <MisDatos user={user} />
    </>
  );
}

// Menores gestionados desde esta cuenta: su contacto y el estado del traspaso a los 16.
function PersonasACargo({ menores }: { menores: { id: string; name: string; birthDate: Date | null; email: string | null; phone: string | null; handoverNoticeAt: Date | null }[] }) {
  return (
    <>
      <div className="sp2" />
      <h3>Personas a tu cargo</h3>
      <div className="muted">
        Gestionas su tratamiento hasta que cumplan {EDAD_MAYORIA_SALUD} años. Ese día les enviaremos a su email
        un enlace para crear su contraseña y confirmar su móvil; desde entonces solo ellos tendrán acceso a su
        expediente y tú dejarás de verlo.
      </div>
      <div className="sp" />
      {menores.map((m) => (
        <form key={m.id} className="card" action={updatePatientContactAction} style={{ marginBottom: 12 }}>
          <input type="hidden" name="patientId" value={m.id} />
          <div className="row between">
            <b>{m.name}</b>
            <span className="pill n">
              {m.birthDate ? `Cumple ${EDAD_MAYORIA_SALUD} años el ${fmtd(fechaMayoria(m.birthDate))}` : "Sin fecha de nacimiento"}
            </span>
          </div>
          {m.handoverNoticeAt && (
            <div className="note g" style={{ marginTop: 8 }}>
              Aviso enviado a {m.email} el {fmtd(m.handoverNoticeAt)} (enlace válido {HANDOVER_TOKEN_DAYS} días).
              Cuando active su cuenta dejarás de ver su tratamiento.
            </div>
          )}
          <div className="grid g2">
            <div>
              <label>Su email (recibirá el aviso)</label>
              <input name="email" type="email" defaultValue={m.email ?? ""} />
            </div>
            <div>
              <label>Su móvil (opcional)</label>
              <input name="phone" type="tel" defaultValue={m.phone ?? ""} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="submit">Guardar</button>
            {m.handoverNoticeAt && (
              <button type="submit" formAction={resendHandoverAction}>
                Reenviar el aviso
              </button>
            )}
          </div>
        </form>
      ))}
    </>
  );
}

// Aviso mientras el email no esté confirmado (necesario para recuperar la contraseña).
function EmailSinConfirmar({ user }: { user: User }) {
  if (!user.email || user.emailVerifiedAt) return null;
  return (
    <form action={resendVerificationAction} className="note a row between" style={{ marginBottom: 14 }}>
      <span>
        Confirma tu email: te hemos enviado un enlace a <b>{user.email}</b>. Sin confirmarlo no podrás
        recuperar tu contraseña si la olvidas.
      </span>
      <button type="submit">Reenviar</button>
    </form>
  );
}

// Datos de acceso del titular: email, móvil y contraseña.
function MisDatos({ user }: { user: User }) {
  return (
    <>
      <div className="sp2" />
      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Mis datos de acceso</summary>
        <form action={updateMyAccountAction}>
          <div className="grid g2">
            <div>
              <label>Email</label>
              <input name="email" type="email" defaultValue={user.email ?? ""} required />
            </div>
            <div>
              <label>Móvil</label>
              <input name="phone" type="tel" defaultValue={user.phone ?? ""} required />
            </div>
          </div>
          <div className="grid g2">
            <div>
              <label>Nueva contraseña (opcional)</label>
              <input name="password" type="password" minLength={8} autoComplete="new-password" />
            </div>
            <div>
              <label>Contraseña actual (para confirmar)</label>
              <input name="current" type="password" autoComplete="current-password" required />
            </div>
          </div>
          <div className="sp" />
          <button type="submit">Guardar mis datos</button>
        </form>
      </details>
    </>
  );
}
