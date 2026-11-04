// Subidas: el contenido real manda (no el tipo que dice el navegador) y las fotos se guardan sin EXIF.
import { describe, expect, it } from "vitest";
import { contenidoCoincide, sinMetadatos, tipoReal } from "@/lib/archivos";

const seg = (marca: number, datos: number[]) => [0xff, marca, ((datos.length + 2) >> 8) & 0xff, (datos.length + 2) & 0xff, ...datos];
const texto = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("tipo real del archivo", () => {
  it("reconoce JPEG, PNG, WebP, WebM y MP4; rechaza HTML disfrazado", () => {
    expect(tipoReal(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(tipoReal(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(tipoReal(new Uint8Array([...texto("RIFF"), 0, 0, 0, 0, ...texto("WEBP")]))).toBe("image/webp");
    expect(tipoReal(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]))).toBe("video/webm");
    expect(tipoReal(new Uint8Array([0, 0, 0, 0x18, ...texto("ftypisom")]))).toBe("video/mp4");
    const html = new Uint8Array(texto("<html><script>alert(1)</script>"));
    expect(tipoReal(html)).toBeNull();
    expect(contenidoCoincide(html, "image/png")).toBe(false);
    expect(contenidoCoincide(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), "video/webm;codecs=vp9")).toBe(true);
  });
});

describe("fotos sin metadatos", () => {
  it("JPEG: quita EXIF (GPS), IPTC y comentarios; deja JFIF, perfil de color y la imagen", () => {
    const jfif = seg(0xe0, texto("JFIF\0"));
    const exif = seg(0xe1, texto("Exif\0\0GPS 41.6N 0.6E"));
    const icc = seg(0xe2, texto("ICC_PROFILE"));
    const coment = seg(0xfe, texto("Hecho con mi móvil"));
    const imagen = [0xff, 0xda, 0, 4, 1, 2, 3, 4, 0xff, 0xd9];
    const foto = new Uint8Array([0xff, 0xd8, ...jfif, ...exif, ...icc, ...coment, ...imagen]);
    const limpia = sinMetadatos(foto, "image/jpeg");
    expect([...limpia]).toEqual([0xff, 0xd8, ...jfif, ...icc, ...imagen]);
    expect(Buffer.from(limpia).toString("latin1")).not.toMatch(/GPS|Exif|móvil/);
  });

  it("PNG: quita los bloques de texto y EXIF", () => {
    const chunk = (tipo: string, datos: number[]) => [0, 0, 0, datos.length, ...texto(tipo), ...datos, 9, 9, 9, 9];
    const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = chunk("IHDR", [1, 2, 3]);
    const fin = chunk("IEND", []);
    const png = new Uint8Array([...firma, ...ihdr, ...chunk("tEXt", texto("GPS")), ...chunk("eXIf", [7]), ...fin]);
    expect([...sinMetadatos(png, "image/png")]).toEqual([...firma, ...ihdr, ...fin]);
  });

  it("un archivo mal formado se deja como está (no se rompe la subida)", () => {
    const raro = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    expect(sinMetadatos(raro, "image/jpeg")).toEqual(raro);
  });
});
