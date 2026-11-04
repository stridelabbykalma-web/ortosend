import { Flash } from "@/components/ui";
import { solicitudClinicaAction } from "@/app/publico-actions";
import { Reveal } from "@/components/ox/reveal";

export const dynamic = "force-dynamic";

const BENEFICIOS: [string, string][] = [
  ["Equipamiento cedido", "Escáner 3D y plataforma de presiones sin inversión: los ponemos nosotros, con formación para tu equipo."],
  ["Pacientes de tu zona", "Los pacientes que buscan en ortosend.es reservan directamente en tu agenda."],
  ["Cero gestión de cobros", "El paciente paga siempre a Ortosend; tú haces el estudio y te liquidamos mensualmente."],
];

export default async function ParaClinicasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { error, ok } = await searchParams;
  return (
    <div className="oxp">
      <Reveal />
      <div className="ox-wrap ox-page" style={{ maxWidth: 1100 }}>
        <h1 className="ox-h2" data-mv>
          Únete a la red Ortosend
        </h1>
        <p className="ox-lead" style={{ maxWidth: "36ch" }} data-mv>
          Te cedemos el equipamiento, formamos a tu equipo y te enviamos pacientes de tu zona. Tú
          haces el estudio; nosotros fabricamos, cobramos al paciente y te liquidamos mensualmente.
        </p>
        <div className="ox-bloques" style={{ margin: "48px 0 64px" }}>
          {BENEFICIOS.map(([t, d]) => (
            <section key={t} data-mv>
              <h3>{t}</h3>
              <p className="ox-prose">{d}</p>
            </section>
          ))}
        </div>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 24, margin: "0 0 14px" }} data-mv>
          Cuéntanos sobre tu clínica y te contactamos
        </h3>
        <Flash error={error} ok={ok} />
        <form className="card" style={{ maxWidth: 620, padding: 26 }} action={solicitudClinicaAction} data-mv>
          <label>Nombre de la clínica</label>
          <input name="name" required />
          <label>Población y código postal</label>
          <input name="town" required />
          <label>Persona de contacto y teléfono</label>
          <input name="contact" required />
          <label>¿Tenéis podólogo o médico que pueda prescribir?</label>
          <select name="hasPrescriber" defaultValue="si">
            <option value="si">Sí</option>
            <option value="no">No</option>
          </select>
          <label>Comentarios</label>
          <textarea name="notes" rows={3} />
          <div className="sp" />
          <button type="submit" className="pri">
            Enviar solicitud
          </button>
        </form>
      </div>
    </div>
  );
}
