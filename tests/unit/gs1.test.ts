import { describe, expect, it } from "vitest";
import { leerEtiqueta } from "@/lib/gs1";

describe("etiquetas GS1", () => {
  it("datos en bruto con separador GS (GS1-128 / DataMatrix)", () => {
    expect(leerEtiqueta("]C1010841234567890517261231" + "10AB-123\u001d21S99")).toEqual({
      esGs1: true,
      gtin: "08412345678905",
      caducidad: "2026-12-31",
      lote: "AB-123",
      serie: "S99",
    });
  });
  it("texto legible con paréntesis y día 00 = último del mes", () => {
    expect(leerEtiqueta("(01)08412345678905(17)270200(10)L2024/7")).toEqual({
      esGs1: true,
      gtin: "08412345678905",
      caducidad: "2027-02-28",
      lote: "L2024/7",
    });
  });
  it("el lote al final sin separador", () => {
    expect(leerEtiqueta("010841234567890510LOTE55")).toMatchObject({ gtin: "08412345678905", lote: "LOTE55" });
  });
  it("un código que no es GS1 (EAN o del proveedor) no se inventa nada", () => {
    expect(leerEtiqueta("8412345678905")).toEqual({ esGs1: false });
    expect(leerEtiqueta("EVA45-NEGRO-LOTE778")).toEqual({ esGs1: false });
    expect(leerEtiqueta("1012345678901")).toEqual({ esGs1: false }); // EAN que empieza por 10
  });
});
