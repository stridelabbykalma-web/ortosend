// ============================================================
// Escaneo de las espumas — helpers puros (sin base de datos)
// ============================================================
// RevoScan no sabe nada de Ortosend: el profesional escanea y guarda como
// siempre. El puente del PC del escáner (public/puente) sube cada
// modelo 3D nuevo y el servidor lo asocia al caso que está en el paso del
// escaneo del asistente de captura. Aquí, lo que comparten servidor,
// interfaz y puente.

// Formatos que exporta RevoScan (y el ZIP del proyecto completo). El navegador
// manda casi siempre un MIME vacío para estos archivos, así que el tipo se
// decide por la extensión, no por lo que diga el cliente.
export const SCAN_MIME: Record<string, string> = {
  // Mesh exportado (lo abre cualquier CAD)
  stl: "model/stl",
  obj: "model/obj",
  ply: "model/ply",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  "3mf": "model/3mf",
  asc: "text/plain",
  // Escaneo en bruto de Revo Scan: archivo de Revo Scan 6 («un escaneo, un
  // archivo») o carpeta de proyecto de Revo Scan 5 empaquetada en ZIP por el
  // puente. El taller lo abre en su Revo Scan, fusiona/malla y exporta.
  revox: "application/octet-stream",
  revo: "application/octet-stream",
  zip: "application/zip",
  // Cualquier otro archivo que deje Revo Scan (formatos de versiones nuevas):
  // se guarda tal cual y el taller lo abre en su Revo Scan.
  bin: "application/octet-stream",
};
const MESH_EXTS = ["stl", "obj", "ply", "glb", "gltf", "3mf", "asc"];
export const SCAN_EXTS = Object.keys(SCAN_MIME);
export const SCAN_ACCEPT = SCAN_EXTS.map((e) => `.${e}`).join(",");

// Escaneo en bruto (para abrir en Revo Scan) o mesh ya exportado.
export function esProyecto(filename: string) {
  const ext = scanExt(filename);
  return !!ext && !MESH_EXTS.includes(ext);
}
export function tipoEscaneo(filename: string) {
  return esProyecto(filename) ? "Proyecto Revo Scan (abrir en Revo Scan → Un clic → Exportar)" : "Mesh exportado";
}

export function scanExt(filename: string): string | null {
  const partes = filename.toLowerCase().split(".");
  if (partes.length < 2) return "bin"; // sin extensión: escaneo en bruto
  const ext = partes.pop() ?? "";
  if (ext in SCAN_MIME) return ext;
  // Documentos y basura del sistema no son escaneos.
  if (/^(txt|log|ini|json|xml|tmp|lnk|pdf|docx?|xlsx?|jpe?g|png|gif|mp4|exe|msi|bat|ps1)$/.test(ext)) return null;
  return "bin";
}

// Nombre que hay que ponerle al proyecto en Revo Scan: nombre del paciente y
// móvil del titular (o el número de caso si no hay móvil). Es lo que enlaza
// la carpeta compartida de la clínica con el paciente en el taller.
export function nombreProyectoRevoScan(nombre: string, telefono: string | null | undefined, numeroCaso: number) {
  const tel = (telefono ?? "").replace(/\D/g, "").slice(-9);
  const base = nombre.trim().replace(/\s+/g, " ");
  return tel.length === 9 ? `${base} ${tel}` : `${base} caso ${numeroCaso}`;
}

// Nombre del proyecto tal y como lo tecleó el profesional en Revo Scan.
export function safeLabel(t: unknown): string | null {
  const v = String(t ?? "").replace(/[\x00-\x1f]/g, "").trim().slice(0, 120);
  return v || null;
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
