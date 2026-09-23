// Datos del titular para los textos legales. Un único sitio a rellenar cuando
// estén los datos definitivos de la sociedad — se propagan a todas las páginas.
export const EMPRESA = {
  nombreComercial: "Ortosend",
  razonSocial: "[RAZÓN SOCIAL PENDIENTE — p. ej. Ortosend, S.L.]",
  cif: "[CIF PENDIENTE]",
  domicilio: "[DOMICILIO SOCIAL PENDIENTE]",
  registro: "[DATOS DE INSCRIPCIÓN EN EL REGISTRO MERCANTIL PENDIENTES]",
  email: "hola@ortosend.com",
  web: "https://ortosend-five.vercel.app",
};

// Versión vigente de los textos de consentimiento. Se guarda junto a cada
// consentimiento del paciente; súbela cuando cambie el texto legal.
export const CONSENT_VERSION = "v2";

// ¿Ha firmado el paciente el consentimiento de datos de salud? Sin él no se
// captura nada del estudio. Los casos de clínica (Flujo B) antiguos lo marcaban
// como aceptado al crear el caso (via "clinica") sin firma del paciente: no cuentan.
export function consentimientoFirmado(consents: unknown): boolean {
  const salud = (consents as { salud?: { aceptado?: boolean; via?: string } } | null)?.salud;
  return !!salud?.aceptado && salud.via !== "clinica";
}

// Menor de edad: marcado en la ficha o por fecha de nacimiento.
export function esMenor(p: { isMinor: boolean; birthDate: Date | null }): boolean {
  if (p.isMinor) return true;
  if (!p.birthDate) return false;
  const mayoria = new Date(p.birthDate);
  mayoria.setFullYear(mayoria.getFullYear() + 18);
  return mayoria > new Date();
}

export const FECHA_TEXTOS = "septiembre de 2026";
