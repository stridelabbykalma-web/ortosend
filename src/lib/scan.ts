// ============================================================
// Puente de escaneo — asociación automática del escaneo al paciente
// ============================================================
// RevoScan (Revopoint) no sabe nada de Ortosend, pero deja elegir DÓNDE se
// guarda cada escaneo. Ese es el enganche: cada caso tiene una carpeta propia
// con un código en el nombre; el profesional solo elige esa carpeta al guardar
// y el puente local (tools/puente-escaneo) sube el archivo a este servidor,
// que lo asocia al paciente por el código. Aquí van los helpers puros
// (sin base de datos) que comparten servidor, interfaz y puente.

// Alfabeto sin caracteres confundibles (0/O, 1/I/L) para que el código se
// pueda leer y teclear desde la pantalla del asistente de captura.
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SCAN_CODE_LEN = 8;

export function newScanCode(): string {
  const bytes = new Uint8Array(SCAN_CODE_LEN);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join("");
}

// Nombre seguro para carpetas a partir del nombre del paciente.
export function slugifyName(t: string) {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// Carpeta del caso tal y como se ve en el diálogo «Guardar» de RevoScan:
// ORT-00123-4K7Q2M9X-juan-perez  (el sufijo del nombre es solo para el ojo
// humano; la asociación la hace el código).
export function scanFolder(caseNumber: number, code: string, patientName?: string) {
  const base = `ORT-${String(caseNumber).padStart(5, "0")}-${code}`;
  const slug = patientName ? slugifyName(patientName) : "";
  return slug ? `${base}-${slug}` : base;
}

// Localiza el identificador del caso en cualquier parte de una ruta:
// C:\Ortosend\Escaneos\ORT-00123-4K7Q2M9X-juan-perez\pie.stl
const FOLDER_RE = new RegExp(`ORT-(\\d{1,9})-([A-HJ-NP-Z2-9]{${SCAN_CODE_LEN}})`, "i");

export function parseScanFolder(path: string): { number: number; code: string } | null {
  const m = FOLDER_RE.exec(path.replace(/\\/g, "/"));
  if (!m) return null;
  return { number: Number(m[1]), code: m[2].toUpperCase() };
}

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

export function scanExt(filename: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return ext in SCAN_MIME ? ext : null;
}

// Tope de tamaño del modelo 3D (prototipo: se guarda en Postgres; en
// producción irá a R2/S3 por fragmentos). Ajustable con SCAN_MAX_MB.
export const SCAN_MAX_BYTES = Number(process.env.SCAN_MAX_MB || 40) * 1024 * 1024;

// El puente saluda al servidor cada minuto: si lleva más de esto callado se
// da por parado (el PC del escáner apagado o el programa cerrado).
export const PUENTE_VIVO_MIN = 5;

export function fmtMB(bytes: number) {
  return `${(bytes / (1024 * 1024)).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;
}
