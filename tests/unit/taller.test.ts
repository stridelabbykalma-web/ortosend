import { describe, expect, it } from "vitest";
import { costeConfeccion, ordenTaller } from "@/lib/taller";

const hace = (diasLaborables: number) => {
  // Fecha de pago hace N días laborables (sin contar hoy).
  const d = new Date();
  let n = 0;
  while (n < diasLaborables) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) n++;
  }
  return d;
};

describe("orden del taller (qué debe salir antes)", () => {
  const caso = (id: string, pagadoHace: number | null, creado: string, rehacer = false) => ({
    id,
    payment: pagadoHace === null ? null : { paidAt: hace(pagadoHace) },
    createdAt: new Date(creado),
    incidents: rehacer ? [{ type: "REHACER_DEFECTO", closedAt: null }] : [{ type: "REHACER_DEFECTO", closedAt: new Date() }],
  });
  it("rehacer primero, luego fuera de plazo, ajustado, en plazo, sin pago; y los más antiguos antes", () => {
    const orden = ordenTaller([
      caso("ok-nuevo", 0, "2026-10-10"),
      caso("sin-pago", null, "2026-01-01"),
      caso("fuera", 7, "2026-10-05"),
      caso("ok-viejo", 1, "2026-10-01"),
      caso("ajustado", 3, "2026-10-08"),
      caso("rehacer", 0, "2026-10-12", true),
    ]).map((c) => c.id);
    expect(orden).toEqual(["rehacer", "fuera", "ajustado", "ok-viejo", "ok-nuevo", "sin-pago"]);
  });
});

describe("coste de confección", () => {
  const materiales = [
    { id: "eva", precioCents: 2500, paresPorPlancha: 20 },
    { id: "forro", precioCents: 1800, paresPorPlancha: 18 },
  ];
  const ajustes = { precioHoraCents: 2000, costeCncMinutoCents: 20, costeMoldeCents: 300 };
  it("material por capa (medio si es de un solo pie) + fresado + mano de obra", () => {
    const c = costeConfeccion(
      {
        capas: [
          { materialId: "eva", pies: "par" },
          { materialId: "forro", pies: "par" },
          { materialId: "eva", pies: "I" },
        ],
        minutosCnc: 30,
        minutosConfeccion: 45,
      },
      materiales,
      ajustes
    );
    expect(c.capas.map((x) => x.cents)).toEqual([125, 100, 63]);
    expect(c.materialCents).toBe(288);
    expect(c.fresadoCents).toBe(30 * 20 + 300);
    expect(c.manoObraCents).toBe(1500);
    expect(c.totalCents).toBe(288 + 900 + 1500);
  });
  it("un material desconocido no cuenta y no rompe", () => {
    const c = costeConfeccion({ capas: [{ materialId: "x", pies: "par" }], minutosCnc: 0, minutosConfeccion: 0 }, materiales, ajustes);
    expect(c.materialCents).toBe(0);
    expect(c.totalCents).toBe(300);
  });
});
