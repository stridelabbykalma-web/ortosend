// ============================================================
// Almacén de escaneos: Cloudflare R2 (API S3) con URLs firmadas
// ============================================================
// El modelo 3D de las espumas puede pesar cientos de MB, más de lo que admite
// una petición al servidor (Vercel corta en ~4,5 MB). Por eso el archivo no
// pasa por aquí: el servidor firma una URL de subida y el puente (o el
// navegador) lo deja directamente en el bucket; luego se confirma y el
// servidor comprueba que está. Para leerlo se firma otra URL de descarga.
//
// Variables: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// (opcional R2_ENDPOINT para otro S3 compatible). Sin ellas, el sistema cae
// al modo «servidor» (bytes en Postgres, con el límite de la petición).
import { HeadObjectCommand, PutObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.R2_BUCKET ?? "";

export function r2Configured(): boolean {
  return !!(
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    BUCKET &&
    (process.env.R2_ENDPOINT || process.env.R2_ACCOUNT_ID)
  );
}

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client)
    client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT ?? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      // Necesario para MinIO y otros S3 compatibles con ruta en vez de subdominio.
      forcePathStyle: !!process.env.R2_ENDPOINT,
    });
  return client;
}

// URL de subida directa (PUT) válida 1 h: tiempo de sobra para un escaneo grande
// por la conexión de una clínica.
// Si el archivo va comprimido (gzip), el objeto se guarda así y R2 devuelve el
// Content-Encoding al descargar: el navegador del taller lo descomprime solo.
export async function presignPut(key: string, mime: string, sizeBytes: number, encoding?: string | null) {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: mime,
      ContentLength: sizeBytes,
      ContentEncoding: encoding ?? undefined,
    }),
    { expiresIn: 60 * 60 }
  );
}

// URL de descarga válida 10 min, con el nombre original al guardar.
export async function presignGet(key: string, filename: string) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\]/g, "_")}"`,
    }),
    { expiresIn: 10 * 60 }
  );
}

// Tamaño del objeto si existe (null si no se ha subido).
export async function objectSize(key: string): Promise<number | null> {
  try {
    const r = await s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return r.ContentLength ?? null;
  } catch {
    return null;
  }
}
