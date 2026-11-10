// Programas de agenda que se pueden conectar. Para añadir uno: escribir su
// adaptador (proveedor-*.ts, contrato en tipos.ts) y registrarlo aquí.
import { DOCFAV } from "./proveedor-docfav";
import { ICAL } from "./proveedor-ical";
import type { Proveedor } from "./tipos";

export const PROVEEDORES: Proveedor[] = [DOCFAV, ICAL];

export function proveedorDe(kind: string): Proveedor | null {
  return PROVEEDORES.find((p) => p.kind === kind) ?? null;
}
