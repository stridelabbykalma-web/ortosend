import { Flash } from "@/components/ui";
import { solicitudClinicaAction } from "@/app/publico-actions";

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
    <div className="wrap" style={{ maxWidth: 860 }}>
      <div className="px-sec" style={{ paddingTop: 56 }}>
        <div className="px-kicker">Red de clínicas</div>
        <h2 className="px-h2">Únete a la red Ortosend</h2>
        <p className="muted" style={{ margin: "0 0 22px", maxWidth: 640 }}>
          Te cedemos el equipamiento, formamos a tu equipo y te enviamos pacientes de tu zona. Tú
          haces el estudio; nosotros fabricamos, cobramos al paciente y te liquidamos mensualmente.
        </p>
        <div className="grid g3">
          {BENEFICIOS.map(([t, d]) => (
            <div className="card px-lift" key={t}>
              <div className="px-card-t">{t}</div>
              <div className="muted" style={{ marginTop: 6 }}>
                {d}
              </div>
            </div>
          ))}
        </div>
        <div className="sp2" />
        <h3 style={{ marginBottom: 10 }}>Cuéntanos sobre tu clínica y te contactamos</h3>
        <Flash error={error} ok={ok} />
        <form className="card px-lift" style={{ maxWidth: 620 }} action={solicitudClinicaAction}>
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
        <div className="sp2" />
      </div>
    </div>
  );
}
