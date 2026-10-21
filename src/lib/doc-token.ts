// Token de lectura del documento clínico (10 min): el cliente lo obtiene
// re-confirmando su contraseña y da acceso a la vista web y al PDF. Vive en
// src/lib (no en un fichero "use server": ahí sería una action pública).
import { SignJWT, jwtVerify } from "jose";
import { authSecret } from "./auth";

export async function createDocToken(caseId: string) {
  return new SignJWT({ caseId, kind: "doc" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(authSecret());
}

export async function verifyDocToken(token: string, caseId: string) {
  try {
    const { payload } = await jwtVerify(token, authSecret());
    return payload.kind === "doc" && payload.caseId === caseId;
  } catch {
    return false;
  }
}
