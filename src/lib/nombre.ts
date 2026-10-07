// Nombre completo de un paciente (nombre + apellidos) para mostrar en pantalla.
// Los pacientes anteriores al alta por WhatsApp no tienen apellidos guardados
// aparte: su nombre ya los incluye.
export function nombreCompleto(p: { name: string; lastName?: string | null }) {
  return [p.name, p.lastName].filter(Boolean).join(" ");
}
