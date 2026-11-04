import { describe, expect, it } from "vitest";
import { PIEZAS_RECETA, piezasDeFormulario, textoPiezas } from "@/lib/piezas-receta";

const form = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  return fd;
};

describe("piezas marcadas en la receta", () => {
  it("las mismas 15 piezas que el programa del taller", () => {
    expect(PIEZAS_RECETA.map((p) => p.tipo)).toEqual([
      "oliva", "barra", "descarga_1mtt", "descarga_sesamoideos", "descarga_5mtt", "cuna_ant",
      "arco", "navicular", "cuboides", "canal_fascia", "skive", "cuna_post", "alza", "expansion_talon", "espolon",
    ]);
  });

  it("sin nada marcado no hay piezas", () => {
    expect(piezasDeFormulario(form({ pz_oliva_valor: "3" }))).toBeNull();
  });

  it("lee pie, valor y tipo; ajusta lo que se sale de rango y lo desconocido", () => {
    const p = piezasDeFormulario(
      form({
        pz_oliva_I: "on",
        pz_oliva_D: "on",
        pz_oliva_valor: "3,5",
        pz_cuna_post_D: "on",
        pz_cuna_post_valor: "40", // máx. 6°
        pz_cuna_post_sentido: "valgo",
        pz_descarga_1mtt_I: "on",
        pz_descarga_1mtt_valor: "",
        pz_descarga_1mtt_sentido: "rara", // → la de por defecto
      })
    );
    expect(p).toEqual({
      I: { oliva: { valor: 3.5 }, descarga_1mtt: { valor: 2.5, sentido: "cerrada" } },
      D: { oliva: { valor: 3.5 }, cuna_post: { valor: 6, sentido: "valgo" } },
    });
    expect(textoPiezas(p)).toBe(
      "Pie izquierdo: Oliva retrocapital 3,5 mm; Descarga 1.er MTT 2,5 mm (cerrada).\n" +
        "Pie derecho: Oliva retrocapital 3,5 mm; Cuña posterior 6° (valgo)."
    );
  });
});
