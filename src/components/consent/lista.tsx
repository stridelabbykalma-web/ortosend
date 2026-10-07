// Consentimientos de un paciente con su botón de retirar (o de volver a aceptar
// el de marketing). Lo usan el perfil del paciente, la página de gestión sin
// cuenta y la ficha del paciente en el panel del profesional.
import type { ConsentType } from "@prisma/client";
import { estadoActual } from "@/lib/consent/registro";
import { ETIQUETA, ORDEN, esObligatorio } from "@/lib/consent/tipos";
import { prisma } from "@/lib/db";
import { fmtdt } from "@/lib/format";

const TEXTO_ACCION = { ACEPTADO: "Aceptado", RECHAZADO: "No aceptado", REVOCADO: "Retirado" } as const;

export async function ListaConsentimientos({
  patientId,
  action,
  ocultos,
  enNombreDelPaciente = false,
  soloLectura = false,
}: {
  patientId: string;
  action: (f: FormData) => Promise<void>;
  ocultos: Record<string, string>;
  enNombreDelPaciente?: boolean;
  soloLectura?: boolean;
}) {
  const estado = await estadoActual(prisma, patientId);
  const hidden = (type: ConsentType) => (
    <>
      {Object.entries(ocultos).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="type" value={type} />
    </>
  );
  return (
    <div className="grid" style={{ gap: 10 }}>
      {ORDEN.map((t) => {
        const e = estado[t];
        return (
          <div key={t} className="card" style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <b>{ETIQUETA[t]}</b>
              <span className={`pill ${e?.action === "ACEPTADO" ? "g" : e ? "r" : ""}`}>
                {e ? TEXTO_ACCION[e.action] : "Sin respuesta"}
              </span>
            </div>
            {e && (
              <div className="tiny">
                {fmtdt(e.at)} · {e.channel === "whatsapp" ? "por WhatsApp" : e.channel === "panel" ? "registrado por el profesional" : "en la web"}
              </div>
            )}
            {e?.action === "ACEPTADO" && !soloLectura && (
              <form action={action} style={{ marginTop: 8 }}>
                {hidden(t)}
                <input type="hidden" name="op" value="revocar" />
                {esObligatorio(t) && (
                  <label className="chk tiny">
                    <input type="checkbox" name="entiendo" required />{" "}
                    {enNombreDelPaciente
                      ? "El paciente me ha pedido retirarlo. Sé que se detendrá su tratamiento y la ficha quedará en solo lectura."
                      : "Entiendo que se detendrá el tratamiento y la fabricación. Mis datos se conservan el tiempo que exige la ley."}
                  </label>
                )}
                <button type="submit" className="btn">
                  Retirar este consentimiento
                </button>
              </form>
            )}
            {t === "MARKETING" && e?.action !== "ACEPTADO" && !enNombreDelPaciente && !soloLectura && (
              <form action={action} style={{ marginTop: 8 }}>
                {hidden(t)}
                <input type="hidden" name="op" value="aceptar" />
                <button type="submit" className="btn">
                  Quiero recibir comunicaciones comerciales
                </button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
