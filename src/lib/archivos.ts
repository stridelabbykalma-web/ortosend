// Subidas de vídeos y fotos: se mira el contenido real del archivo (no el tipo que dice el navegador)
// y a las fotos se les quitan los metadatos (EXIF: posición GPS, móvil, fecha…) antes de guardarlas.

const empieza = (b: Uint8Array, firma: number[], desde = 0) =>
  b.length >= desde + firma.length && firma.every((x, i) => b[desde + i] === x);
const ascii = (b: Uint8Array, desde: number, n: number) => String.fromCharCode(...b.subarray(desde, desde + n));

// Tipo según los primeros bytes del archivo, o null si no es ninguno de los admitidos.
export function tipoReal(b: Uint8Array): string | null {
  if (empieza(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (empieza(b, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") return "video/mp4";
  return null;
}

// ¿El contenido es del tipo declarado? (vídeo webm/mp4 con códec en el tipo: «video/webm;codecs=vp9»).
export function contenidoCoincide(b: Uint8Array, mimeDeclarado: string): boolean {
  return tipoReal(b) === mimeDeclarado.split(";")[0].trim();
}

// JPEG sin APP1 (EXIF/XMP), APP13 (IPTC/Photoshop) ni comentarios. Se conservan APP0 (JFIF), APP2
// (perfil de color) y APP14 (Adobe): sin ellos los colores podrían cambiar.
function jpegSinMetadatos(b: Uint8Array): Uint8Array {
  const partes: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b; // no es un JPEG bien formado: se deja como está
    const marca = b[i + 1];
    if (marca === 0xda) {
      partes.push(b.subarray(i)); // inicio de la imagen comprimida: el resto se copia tal cual
      break;
    }
    const largo = (b[i + 2] << 8) | b[i + 3];
    if (largo < 2 || i + 2 + largo > b.length) return b;
    const quitar = marca === 0xe1 || marca === 0xed || marca === 0xfe;
    if (!quitar) partes.push(b.subarray(i, i + 2 + largo));
    i += 2 + largo;
  }
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// PNG sin los bloques de texto y EXIF.
function pngSinMetadatos(b: Uint8Array): Uint8Array {
  const QUITAR = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);
  const partes: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const largo = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const fin = i + 12 + largo;
    if (fin > b.length) return b;
    if (!QUITAR.has(ascii(b, i + 4, 4))) partes.push(b.subarray(i, fin));
    i = fin;
  }
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// La foto sin metadatos (los vídeos de la cámara del navegador no llevan GPS y se dejan igual).
export function sinMetadatos(b: Uint8Array, mime: string): Uint8Array {
  if (mime === "image/jpeg") return jpegSinMetadatos(b);
  if (mime === "image/png") return pngSinMetadatos(b);
  return b;
}
