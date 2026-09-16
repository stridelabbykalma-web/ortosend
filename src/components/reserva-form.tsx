"use client";

// Formulario de reserva del Flujo A. Al elegir la hora se bloquea 15 min para
// este navegador (holdSlotAction); el resto de la lógica es del servidor
// (reservaAction). Dos modos: visitante (crea cuenta) o cliente ya registrado
// (elige para quién es la cita).
import { useState, useTransition } from "react";
import { holdSlotAction, reservaAction } from "@/app/publico-actions";
import { EDAD_MAYORIA_SALUD } from "@/lib/edad";

type Slot = { id: string; label: string };
type Persona = { id: string; name: string; isMinor: boolean };

export function ReservaForm({
  clinicId,
  slots,
  cuenta,
}: {
  clinicId: string;
  slots: Slot[];
  // Cliente con sesión: sus personas (él/ella y los menores a su cargo).
  cuenta: { nombre: string; personas: Persona[] } | null;
}) {
  const [hold, setHold] = useState<{ slotId: string; ok: boolean; until?: string } | null>(null);
  const [pending, start] = useTransition();
  const [menor, setMenor] = useState(false);
  const [persona, setPersona] = useState(cuenta?.personas[0]?.id ?? "nuevo");
  const nuevaPersona = !cuenta ? menor : persona === "nuevo";

  const elegir = (slotId: string) =>
    start(async () => {
      const r = await holdSlotAction(slotId);
      setHold({ slotId, ...r });
    });

  return (
    <form action={reservaAction}>
      <input type="hidden" name="clinicId" value={clinicId} />
      <input type="hidden" name="modo" value={cuenta ? "cuenta" : "nuevo"} />
      <div className="card">
        <b>1. Elige tu hora</b>
        <div className="grid g4" style={{ marginTop: 10 }}>
          {slots.map((s) => (
            <label key={s.id} className="slotlabel">
              <input type="radio" name="slotId" value={s.id} required onChange={() => elegir(s.id)} />
              {s.label}
            </label>
          ))}
        </div>
        {slots.length === 0 && (
          <div className="note a" style={{ marginTop: 8 }}>
            Esta clínica no tiene huecos publicados ahora mismo.
          </div>
        )}
        {hold && (
          <div className={`note ${hold.ok ? "g" : "r"}`} style={{ marginTop: 8 }}>
            {hold.ok
              ? `Hora reservada para ti durante 15 minutos (hasta las ${hold.until}). Completa tus datos.`
              : "Esa hora acaba de ocuparla otra persona. Elige otra."}
          </div>
        )}
        {pending && <div className="tiny" style={{ marginTop: 6 }}>Comprobando disponibilidad…</div>}
      </div>
      <div className="sp" />

      {cuenta ? (
        <div className="card">
          <b>2. ¿Para quién es la cita?</b>
          <div className="muted" style={{ marginBottom: 8 }}>
            Reservas con tu cuenta ({cuenta.nombre}); no hace falta volver a registrarte.
          </div>
          {cuenta.personas.map((p) => (
            <label key={p.id} className="chk">
              <input
                type="radio"
                name="patientId"
                value={p.id}
                checked={persona === p.id}
                onChange={() => setPersona(p.id)}
              />
              {p.name}
              {p.isMinor ? " (menor a tu cargo)" : ""}
            </label>
          ))}
          <label className="chk">
            <input type="radio" name="patientId" value="nuevo" checked={persona === "nuevo"} onChange={() => setPersona("nuevo")} />
            Otra persona menor de {EDAD_MAYORIA_SALUD} años a mi cargo
          </label>
          {nuevaPersona && <CamposMenor />}
        </div>
      ) : (
        <div className="card">
          <b>2. Tus datos</b>
          <label>Nombre y apellidos</label>
          <input name="name" required />
          <div className="grid g2">
            <div>
              <label>Móvil (será tu vía de contacto por WhatsApp)</label>
              <input name="phone" type="tel" required />
            </div>
            <div>
              <label>Email</label>
              <input name="email" type="email" required />
            </div>
          </div>
          <div className="grid g2">
            <div>
              <label>Fecha de nacimiento{menor ? " (la tuya)" : ""}</label>
              <input name="birth" type="date" required={!menor} />
            </div>
            <div>
              <label>Motivo (opcional)</label>
              <select name="motivo" defaultValue="Dolor">
                <option>Dolor</option>
                <option>Deporte</option>
                <option>Prevención / revisión</option>
                <option>Renovación de plantillas</option>
              </select>
            </div>
          </div>
          <label>Crea tu contraseña (para seguir tu tratamiento en tu panel)</label>
          <input name="password" type="password" minLength={8} autoComplete="new-password" required />
          <label className="chk" style={{ marginTop: 10 }}>
            <input type="checkbox" name="paraMenor" checked={menor} onChange={(e) => setMenor(e.target.checked)} />
            Reservo para un menor de {EDAD_MAYORIA_SALUD} años a mi cargo (soy su padre, madre o tutor legal)
          </label>
          {menor && <CamposMenor />}
        </div>
      )}

      {cuenta && (
        <>
          <div className="sp" />
          <div className="card">
            <label>Motivo (opcional)</label>
            <select name="motivo" defaultValue="Dolor">
              <option>Dolor</option>
              <option>Deporte</option>
              <option>Prevención / revisión</option>
              <option>Renovación de plantillas</option>
            </select>
          </div>
        </>
      )}

      {(!cuenta || nuevaPersona) && (
        <>
          <div className="sp" />
          <div className="card">
            <b>3. Consentimientos</b>
            <label className="chk" style={{ marginTop: 8 }}>
              <input type="checkbox" name="consentSalud" required /> Consiento de forma explícita el
              tratamiento de {nuevaPersona ? "los datos de salud del menor" : "mis datos de salud"} para
              la prestación del servicio, incluida la grabación de vídeos de la marcha y fotografías de
              los pies durante el estudio.
              {nuevaPersona &&
                ` Declaro ser su padre, madre o tutor legal y consentir en su nombre; sé que al cumplir ${EDAD_MAYORIA_SALUD} años se le avisará por email para que tome el control de su cuenta y yo dejaré de tener acceso.`}
            </label>
            <label className="chk">
              <input type="checkbox" name="consentWhatsApp" /> Acepto recibir los avisos del servicio por
              WhatsApp (solo avisos y enlaces, nunca contenido clínico).
            </label>
          </div>
        </>
      )}

      <div className="tiny" style={{ marginTop: 10 }}>
        Responsable: Ortosend. Finalidad: gestionar tu cita, estudio y tratamiento. Derechos de acceso,
        rectificación y supresión en la <a href="/legal/privacidad">política de privacidad</a>.
      </div>
      <div className="sp" />
      <button type="submit" className="pri wfull" disabled={slots.length === 0 || pending}>
        Confirmar reserva gratuita
      </button>
    </form>
  );
}

function CamposMenor() {
  return (
    <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: "3px solid var(--line)" }}>
      <label>Nombre y apellidos del menor</label>
      <input name="menorNombre" required />
      <label>Fecha de nacimiento del menor</label>
      <input name="menorNacimiento" type="date" required />
      <div className="grid g2">
        <div>
          <label>Email del menor (recibirá el aviso al cumplir {EDAD_MAYORIA_SALUD} años)</label>
          <input name="menorEmail" type="email" />
        </div>
        <div>
          <label>Móvil del menor (opcional)</label>
          <input name="menorMovil" type="tel" />
        </div>
      </div>
      <div className="tiny">
        Hasta los {EDAD_MAYORIA_SALUD} años el tratamiento se gestiona desde tu cuenta. Al cumplirlos le
        enviaremos a su email un enlace para que cree su contraseña y confirme su móvil, y desde entonces
        solo él/ella tendrá acceso. Si no tienes su email ahora, podrás añadirlo en tu panel.
      </div>
    </div>
  );
}
