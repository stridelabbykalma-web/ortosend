// Destino tras el login: solo rutas internas. La validación por regex sola no
// basta (un tabulador en "/\t/evil.com" se descarta al interpretar la URL y
// deja "//evil.com"), así que además se interpreta la URL contra una base y se
// exige que no cambie de origen.
export function destinoSeguro(next: string, porDefecto = "/panel"): string {
  if (!/^\/(?![\/\\])[^\s\\]*$/.test(next)) return porDefecto;
  try {
    const base = "https://interno.invalid";
    if (new URL(next, base).origin !== base) return porDefecto;
  } catch {
    return porDefecto;
  }
  return next;
}
