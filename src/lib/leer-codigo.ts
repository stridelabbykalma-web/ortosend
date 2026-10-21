// Lee el código de barras de la foto de una etiqueta, en el navegador del móvil. Primero con el lector
// del propio navegador (Android/Chrome) y si no, con ZXing (vale en cualquier móvil, también iPhone).
// Formatos de las etiquetas de material: GS1-128 (Code 128), GS1 DataMatrix, QR, EAN, Code 39, ITF.
"use client";

import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
  MultiFormatReader,
} from "@zxing/library";

type Detector = { detect: (img: CanvasImageSource) => Promise<{ rawValue: string }[]> };

async function cargar(file: File): Promise<HTMLImageElement> {
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

function lienzo(img: HTMLImageElement, max: number, giro: 0 | 90): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * k);
  const h = Math.round(img.height * k);
  const c = document.createElement("canvas");
  c.width = giro ? h : w;
  c.height = giro ? w : h;
  const g = c.getContext("2d")!;
  if (giro) {
    g.translate(c.width / 2, c.height / 2);
    g.rotate(Math.PI / 2);
    g.drawImage(img, -w / 2, -h / 2, w, h);
  } else g.drawImage(img, 0, 0, w, h);
  return c;
}

export async function leerCodigoDeFoto(file: File): Promise<string | null> {
  const img = await cargar(file);
  const nativo = (globalThis as unknown as { BarcodeDetector?: new (o: object) => Detector }).BarcodeDetector;
  if (nativo) {
    try {
      const d = new nativo({ formats: ["code_128", "data_matrix", "qr_code", "ean_13", "ean_8", "code_39", "itf"] });
      const r = await d.detect(img);
      if (r[0]?.rawValue) return r[0].rawValue;
    } catch {
      // sigue con ZXing
    }
  }
  const lector = new MultiFormatReader();
  const pistas = new Map();
  pistas.set(DecodeHintType.TRY_HARDER, true);
  pistas.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
  ]);
  lector.setHints(pistas);
  for (const max of [1600, 2400, 1000]) {
    for (const giro of [0, 90] as const) {
      try {
        const bitmap = new BinaryBitmap(new HybridBinarizer(new HTMLCanvasElementLuminanceSource(lienzo(img, max, giro))));
        return lector.decode(bitmap).getText();
      } catch {
        // prueba otro tamaño o girada
      }
    }
  }
  return null;
}

// La foto que se guarda: como mucho 1600 px de lado, en JPEG (pesa poco y la etiqueta se lee bien).
export async function fotoReducida(file: File): Promise<Blob> {
  const img = await cargar(file);
  const c = lienzo(img, 1600, 0);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
  return blob ?? file;
}
