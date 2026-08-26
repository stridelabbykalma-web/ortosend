import { Flash } from "@/components/ui";
import { solicitudClinicaAction } from "@/app/publico-actions";

export const dynamic = "force-dynamic";

export default async function ParaClinicasPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { error, ok } = await searchParams;
  return (
    <div className="wrap" style={{ maxWidth: 620 }}>
      <div className="sp2" />
      <h2>Únete a la red Ortosend</h2>
      <p className="muted" style={{ margin: "8px 0 16px" }}>
        Te cedemos el equipamiento (escáner 3D, plataforma de presiones), formamos a tu equipo y te
        enviamos pacientes de tu zona. Tú haces el estudio; nosotros fabricamos, cobramos al
        paciente y te liquidamos mensualmente. Tu clínica nunca cobra al paciente.
      </p>
      <Flash error={error} ok={ok} />
      <form className="card" action={solicitudClinicaAction}>
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
  );
}
