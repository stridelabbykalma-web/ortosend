// Normalización de los datos de contacto antes de guardarlos o buscarlos.
// El móvil se guarda siempre igual para que el login, el reparto de avisos y
// el nombre del proyecto de Revo Scan (últimos 9 dígitos) coincidan.

// Móviles españoles → 9 dígitos ("600 11 22 33", "+34 600112233" y
// "0034600112233" dan "600112233"). Extranjeros → "+" y dígitos.
export function normalizePhone(raw: string | null | undefined): string {
  let t = (raw ?? "").trim().replace(/[\s.\-()]/g, "");
  if (!t) return "";
  if (t.startsWith("00")) t = "+" + t.slice(2);
  const intl = t.startsWith("+");
  const digits = t.replace(/\D/g, "");
  if (!intl && digits.length === 9) return digits;
  if (intl && digits.startsWith("34") && digits.length === 11) return digits.slice(2);
  if (!intl && digits.startsWith("34") && digits.length === 11) return digits.slice(2);
  return intl ? "+" + digits : digits;
}

export function isValidPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

// El login admite email o móvil en el mismo campo.
export function normalizeIdentifier(raw: string) {
  const t = raw.trim();
  return t.includes("@") ? normalizeEmail(t) : normalizePhone(t);
}
