// Escaneo de las espumas: el proyecto de Revo Scan se guarda en la carpeta
// compartida de la clínica y el taller lo encuentra por su nombre. Este es el
// único sitio donde se define ese nombre (formulario y expediente lo usan).

// Nombre del paciente y móvil del titular; si no hay móvil, el número de caso.
export function nombreProyectoRevoScan(nombre: string, telefono: string | null | undefined, numeroCaso: number) {
  const tel = (telefono ?? "").replace(/\D/g, "").slice(-9);
  const base = nombre.trim().replace(/\s+/g, " ");
  return tel.length === 9 ? `${base} ${tel}` : `${base} caso ${numeroCaso}`;
}
