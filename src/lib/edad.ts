// Edad y mayoría de edad sanitaria. En España el paciente decide sobre su
// salud desde los 16 años (Ley 41/2002): hasta entonces el tratamiento lo
// gestiona su padre, madre o tutor desde su propia cuenta; al cumplirlos, la
// cuenta se traspasa al propio paciente y el tutor deja de tener acceso.
export const EDAD_MAYORIA_SALUD = 16;

// Días de validez del enlace con el que el paciente toma el control de su cuenta.
export const HANDOVER_TOKEN_DAYS = 30;

export function edadEn(birth: Date, at: Date = new Date()): number {
  let edad = at.getFullYear() - birth.getFullYear();
  const m = at.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < birth.getDate())) edad--;
  return edad;
}

// Menor a efectos de la plataforma: aún no ha cumplido los 16.
export function esMenor(birth: Date | null | undefined, at: Date = new Date()) {
  return !!birth && edadEn(birth, at) < EDAD_MAYORIA_SALUD;
}

// Fecha en la que cumple la mayoría de edad sanitaria.
export function fechaMayoria(birth: Date): Date {
  const d = new Date(birth);
  d.setFullYear(d.getFullYear() + EDAD_MAYORIA_SALUD);
  return d;
}

// Fecha de nacimiento más reciente que ya ha cumplido los 16 (para el cron).
export function nacimientoLimiteMayoria(at: Date = new Date()): Date {
  const d = new Date(at);
  d.setFullYear(d.getFullYear() - EDAD_MAYORIA_SALUD);
  return d;
}

export function parseBirth(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const t = raw.trim();
  // dd/mm/aaaa (como se escribe a mano; también con guiones o puntos) o ISO.
  const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  const d = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : new Date(t);
  if (isNaN(+d) || d > new Date()) return null;
  // Rechaza fechas que el calendario corrige en silencio (31/02 → 3 de marzo).
  if (m && (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[1])) return null;
  if (d.getUTCFullYear() < 1900) return null;
  return d;
}
