// PDF de la prescripción, generado en el momento de la firma y guardado
// inmutable con su huella SHA-256 (refuerzo probatorio de la firma simple:
// la huella queda también en el AuditLog, que es append-only en la BD).
import { createHash } from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { EMPRESA } from "./legal";

export type DatosRxPdf = {
  numeroCaso: number;
  paciente: string;
  nacimiento: string | null;
  dni: string | null;
  clinica: string;
  prescriptor: string;
  colegiado: string;
  valoracion: string;
  diagnostico: string;
  pautaFabricacion: string;
  pieIzquierdo: string | null;
  pieDerecho: string | null;
  pautaUso: string;
  firmadoEl: Date;
};

const A4: [number, number] = [595.28, 841.89];
const MARGEN = 56;
const ANCHO = A4[0] - MARGEN * 2;

export async function generarPdfPrescripcion(d: DatosRxPdf): Promise<{ bytes: Uint8Array<ArrayBuffer>; sha256: string }> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage(A4);
  let y = A4[1] - MARGEN;

  const wrap = (texto: string, size: number, font = fuente): string[] => {
    const out: string[] = [];
    for (const parrafo of (texto || "—").split("\n")) {
      let linea = "";
      for (const palabra of parrafo.split(/\s+/)) {
        const prueba = linea ? `${linea} ${palabra}` : palabra;
        if (font.widthOfTextAtSize(prueba, size) > ANCHO && linea) {
          out.push(linea);
          linea = palabra;
        } else linea = prueba;
      }
      out.push(linea);
    }
    return out;
  };
  const escribe = (texto: string, size = 10, font = fuente, color = rgb(0.09, 0.15, 0.18)) => {
    for (const linea of wrap(texto, size, font)) {
      if (y < MARGEN + 40) {
        page = doc.addPage(A4);
        y = A4[1] - MARGEN;
      }
      page.drawText(linea, { x: MARGEN, y, size, font, color });
      y -= size * 1.45;
    }
  };
  const seccion = (titulo: string, cuerpo: string) => {
    y -= 8;
    escribe(titulo.toUpperCase(), 9, negrita, rgb(0.05, 0.43, 0.36));
    escribe(cuerpo, 10);
  };

  // Cabecera
  escribe(EMPRESA.nombreComercial, 18, negrita, rgb(0.05, 0.43, 0.36));
  escribe("Prescripción de producto sanitario a medida — plantillas ortopédicas", 11, negrita);
  escribe(`Caso #${d.numeroCaso} · Firmada el ${d.firmadoEl.toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" })} (hora peninsular)`, 9);
  y -= 6;
  page.drawLine({ start: { x: MARGEN, y }, end: { x: A4[0] - MARGEN, y }, thickness: 1, color: rgb(0.8, 0.85, 0.83) });
  y -= 14;

  seccion("Paciente", `${d.paciente}${d.nacimiento ? ` · Nacimiento: ${d.nacimiento}` : ""}${d.dni ? ` · DNI/NIE: ${d.dni}` : ""}`);
  seccion("Clínica del estudio", d.clinica);
  seccion("Prescriptor", `${d.prescriptor} · Colegiado n.º ${d.colegiado}`);
  seccion("Valoración clínica", d.valoracion);
  seccion("Diagnóstico / indicación", d.diagnostico);
  seccion("Pauta de fabricación (orden de trabajo)", d.pautaFabricacion);
  if (d.pieIzquierdo) seccion("Pie izquierdo", d.pieIzquierdo);
  if (d.pieDerecho) seccion("Pie derecho", d.pieDerecho);
  seccion("Pauta de uso para el paciente", d.pautaUso);

  y -= 10;
  escribe(
    `Documento firmado electrónicamente en la plataforma de ${EMPRESA.nombreComercial} por el prescriptor identificado, con colegiación verificada. ` +
      `Prescripción escrita de producto sanitario a medida (Reglamento (UE) 2017/745, anexo XIII). ` +
      `Se conserva de forma inmutable un mínimo de 5 años; su huella SHA-256 queda registrada en el historial de auditoría en el momento de la firma.`,
    8,
    fuente,
    rgb(0.4, 0.45, 0.47)
  );

  const bytes = (await doc.save()) as Uint8Array<ArrayBuffer>;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, sha256 };
}
