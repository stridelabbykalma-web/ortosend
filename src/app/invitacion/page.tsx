import Link from "next/link";

// Enlaces del Flujo B antiguo (invitación web). El alta de pacientes va ahora
// por WhatsApp: la clínica reenvía la invitación desde su panel.
export default function InvitacionPage() {
  return (
    <div className="wrap" style={{ maxWidth: 560 }}>
      <div className="sp2" />
      <h2>Este enlace ya no se usa</h2>
      <div className="sp" />
      <div className="note a">
        Ahora el alta en Ortosend se confirma por WhatsApp. Pide a tu clínica que te reenvíe la invitación: te
        llegará un mensaje para aceptar los documentos desde el propio chat.
      </div>
      <div className="sp" />
      <Link href="/login">¿Ya tienes cuenta? Entra aquí</Link>
    </div>
  );
}
