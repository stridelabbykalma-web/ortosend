// Lee el código de barras de la etiqueta de una plancha, en el navegador del móvil.
// Orden: lector del propio navegador (Android/Chrome) → zxing-cpp (WebAssembly, lee bien los códigos de
// barras de línea GS1-128 en fotos, también un poco girados) → ZXing en JavaScript como último recurso.
// Formatos de las etiquetas de material: GS1-128 (Code 128), EAN/UPC, GS1 DataBar, DataMatrix, QR, ITF, Code 39.
"use client";

import type { ReaderOptions } from "zxing-wasm/reader";

type Detector = { detect: (img: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type Fuente = { img: CanvasImageSource; w: number; h: number };

const FORMATOS_WASM: ReaderOptions["formats"] = [
  "Code128",
  "EAN-13",
  "EAN-8",
  "UPC-A",
  "DataBarExpanded",
  "DataBar",
  "DataMatrix",
  "QRCode",
  "ITF",
  "Code39",
];
const FORMATOS_NATIVO = ["code_128", "ean_13", "ean_8", "upc_a", "data_matrix", "qr_code", "itf", "code_39"];

let wasm: Promise<typeof import("zxing-wasm/reader")> | null = null;
function zxingWasm() {
  wasm ??= import("zxing-wasm/reader").then((m) => {
    // El .wasm se sirve desde la propia web (public/zxing), no desde un CDN.
    m.prepareZXingModule({
      overrides: { locateFile: (ruta: string, prefijo: string) => (ruta.endsWith(".wasm") ? "/zxing/zxing_reader.wasm" : prefijo + ruta) },
    });
    return m;
  });
  return wasm;
}

let detector: Detector | null | undefined;
function nativo(): Detector | null {
  if (detector !== undefined) return detector;
  const D = (globalThis as unknown as { BarcodeDetector?: new (o: object) => Detector }).BarcodeDetector;
  try {
    detector = D ? new D({ formats: FORMATOS_NATIVO }) : null;
  } catch {
    detector = null;
  }
  return detector;
}

async function cargar(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ko(new Error("No se puede leer la foto"));
      i.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Dibuja (una parte centrada de) la imagen reducida a `max` px y girada `grados`, con fondo gris.
// Con `ampliar` la parte central se agranda hasta `max` (etiqueta lejos de la cámara).
function lienzo(f: Fuente, max: number, grados = 0, parte = 1, ampliar = false): HTMLCanvasElement {
  const sw = f.w * parte;
  const sh = f.h * parte;
  const k = ampliar ? max / Math.max(sw, sh) : Math.min(1, max / Math.max(sw, sh));
  const w = Math.round(sw * k);
  const h = Math.round(sh * k);
  const a = (grados * Math.PI) / 180;
  const c = document.createElement("canvas");
  c.width = Math.round(Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)));
  c.height = Math.round(Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)));
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = "#777";
  g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2);
  g.rotate(a);
  g.drawImage(f.img, (f.w - sw) / 2, (f.h - sh) / 2, sw, sh, -w / 2, -h / 2, w, h);
  return c;
}

async function conWasm(c: HTMLCanvasElement, rapido: boolean): Promise<string | null> {
  const { readBarcodes } = await zxingWasm();
  const datos = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  const r = await readBarcodes(datos, {
    formats: FORMATOS_WASM,
    tryHarder: !rapido,
    tryRotate: true,
    tryDownscale: true,
    maxNumberOfSymbols: 1,
  });
  return r.find((x) => x.isValid && x.text)?.text ?? null;
}

async function conZxingJs(c: HTMLCanvasElement): Promise<string | null> {
  const z = await import("@zxing/library");
  const lector = new z.MultiFormatReader();
  const pistas = new Map();
  pistas.set(z.DecodeHintType.TRY_HARDER, true);
  lector.setHints(pistas);
  try {
    return lector.decode(new z.BinaryBitmap(new z.HybridBinarizer(new z.HTMLCanvasElementLuminanceSource(c)))).getText();
  } catch {
    return null;
  }
}

async function conNativo(img: CanvasImageSource): Promise<string | null> {
  const d = nativo();
  if (!d) return null;
  try {
    return (await d.detect(img))[0]?.rawValue || null;
  } catch {
    return null;
  }
}

// [tamaño máximo, giro en grados, parte central de la foto]
const INTENTOS_FOTO: [number, number, number][] = [
  [2000, 0, 1],
  [2000, 5, 1],
  [2000, -5, 1],
  [2000, 10, 1],
  [2000, -10, 1],
  [2000, 15, 1],
  [2000, -15, 1],
  [2000, 20, 1],
  [2000, -20, 1],
  [2400, 0, 0.6],
  [2400, 8, 0.6],
  [2400, -8, 0.6],
  [2400, 16, 0.6],
  [2400, -16, 0.6],
  [3000, 0, 1],
  [3000, 5, 1],
  [3000, -5, 1],
];

// Una foto hecha con la cámara: se prueba a fondo (tamaños, recorte del centro y giros de hasta 20°).
export async function leerCodigoDeFoto(file: Blob): Promise<string | null> {
  const img = await cargar(file);
  const f = { img, w: img.naturalWidth, h: img.naturalHeight };
  const directo = await conNativo(img);
  if (directo) return directo;
  try {
    for (const [max, grados, parte] of INTENTOS_FOTO) {
      const t = await conWasm(lienzo(f, max, grados, parte), false);
      if (t) return t;
    }
  } catch {
    // sin WebAssembly: sigue con ZXing en JavaScript
  }
  for (const [max, grados] of [[1600, 0], [2400, 0], [1600, 90]] as const) {
    const t = await conZxingJs(lienzo(f, max, grados));
    if (t) return t;
  }
  return null;
}

// Un fotograma de la cámara en vivo: rápido (se llama varias veces por segundo). `vuelta` va cambiando
// para probar cada vez un giro y un encuadre distintos sin hacerlo lento.
// [giro en grados, parte central, ampliada]
const VIVO: [number, number, boolean][] = [
  [0, 1, false],
  [0, 0.5, true],
  [8, 1, false],
  [-8, 1, false],
  [0, 0.7, false],
  [15, 1, false],
  [-15, 1, false],
  [8, 0.5, true],
  [-8, 0.5, true],
];
export async function leerCodigoDeVideo(video: HTMLVideoElement, vuelta: number): Promise<string | null> {
  if (!video.videoWidth) return null;
  const directo = await conNativo(video);
  if (directo) return directo;
  const f = { img: video, w: video.videoWidth, h: video.videoHeight };
  const [grados, parte, ampliar] = VIVO[vuelta % VIVO.length];
  return conWasm(lienzo(f, ampliar ? 1600 : 1920, grados, parte, ampliar), true);
}

// Foto del fotograma actual de la cámara (es la prueba que se guarda con el registro).
export async function fotoDeVideo(video: HTMLVideoElement): Promise<Blob> {
  const c = lienzo({ img: video, w: video.videoWidth, h: video.videoHeight }, 1600);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
  if (!blob) throw new Error("No se ha podido guardar la foto");
  return blob;
}

// Carga el lector de antemano (al abrir la cámara) para que el primer intento no espere la descarga.
export function prepararLector() {
  void zxingWasm().catch(() => {});
}

// La foto que se guarda: como mucho 1600 px de lado, en JPEG (pesa poco y la etiqueta se lee bien).
export async function fotoReducida(file: File): Promise<Blob> {
  const img = await cargar(file);
  const c = lienzo({ img, w: img.naturalWidth, h: img.naturalHeight }, 1600);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
  return blob ?? file;
}
