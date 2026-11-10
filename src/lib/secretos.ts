// Cifrado de secretos guardados en la base de datos (claves de API de los
// programas de las clínicas). AES-256-GCM con una clave derivada de
// CONNECTOR_SECRET o, si no existe, de AUTH_SECRET. Si esa variable cambia, las
// claves guardadas dejan de poder leerse y la clínica tiene que volver a
// introducir la suya.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function clave() {
  const base = process.env.CONNECTOR_SECRET || process.env.AUTH_SECRET;
  if (!base) throw new Error("Falta CONNECTOR_SECRET o AUTH_SECRET para cifrar las claves de los conectores");
  return createHash("sha256").update(`ortosend:conectores:${base}`).digest();
}

// Formato: v1.<iv>.<tag>.<cifrado>, todo en base64url.
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave(), iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), datos.toString("base64url")].join(".");
}

export function descifrar(sobre: string): string {
  const [v, iv, tag, datos] = sobre.split(".");
  if (v !== "v1" || !iv || !tag || !datos) throw new Error("Secreto con formato desconocido");
  const d = createDecipheriv("aes-256-gcm", clave(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(datos, "base64url")), d.final()]).toString("utf8");
}

// Pista para reconocer la clave en pantalla sin mostrarla: «…a1b2».
export function pistaDe(secreto: string) {
  return "…" + secreto.trim().slice(-4);
}
