// ============================================================
// Escaneo de las espumas — helpers puros (sin base de datos)
// ============================================================
// RevoScan no sabe nada de Ortosend: el profesional escanea y guarda como
// siempre. El puente del PC del escáner (tools/puente-escaneo) sube cada
// modelo 3D nuevo y el servidor lo asocia al caso que está en el paso del
// escaneo del asistente de captura. Aquí, lo que comparten servidor,
// interfaz y puente.

// Formatos que exporta RevoScan (y el ZIP del proyecto completo). El navegador
// manda casi siempre un MIME vacío para estos archivos, así que el tipo se
// decide por la extensión, no por lo que diga el cliente.
export const SCAN_MIME: Record<string, string> = {
  stl: "model/stl",
  obj: "model/obj",
  ply: "model/ply",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  "3mf": "model/3mf",
  asc: "text/plain",
  zip: "application/zip",
};
export const SCAN_EXTS = Object.keys(SCAN_MIME);
export const SCAN_ACCEPT = SCAN_EXTS.map((e) => `.${e}`).join(",");

export function scanExt(filename: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return ext in SCAN_MIME ? ext : null;
}

// Nombre de archivo seguro para el evento del caso y la descarga.
export function safeFilename(name: string) {
  return name.replace(/[\\/]/g, "_").replace(/[\x00-\x1f"]/g, "").slice(0, 120) || "escaneo";
}

// Tope solo en modo «servidor» (sin R2: el archivo pasa por la petición y se
// guarda en Postgres). Con R2 no hay límite de tamaño.
export const SCAN_SERVER_MAX_BYTES = Number(process.env.SCAN_MAX_MB || 40) * 1024 * 1024;

// El puente saluda al servidor cada minuto: si lleva más de esto callado se
// da por parado (el PC del escáner apagado o el programa cerrado).
export const PUENTE_VIVO_MIN = 5;

// Un caso «espera escaneo» mientras su asistente está en ese paso (la pantalla
// lo refresca cada pocos segundos) y hasta este margen después.
export const SCAN_WAIT_MIN = 10;

// Los escaneos de la bandeja sin asociar se ofrecen durante este tiempo.
export const INBOX_HOURS = 24;

export function fmtMB(bytes: number) {
  return `${(bytes / (1024 * 1024)).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;
}
