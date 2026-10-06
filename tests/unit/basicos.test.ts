import { describe, expect, it } from "vitest";
import { hashCodigo, hashSecreto, mismoHash, nuevoCodigo, nuevoSecreto } from "@/lib/consent/tokens";
import { isValidDni, normalizeDni } from "@/lib/contacto";
import { aE164, usarManyChat, manychat, CAMPOS } from "@/lib/manychat";
import { ORDEN, OBLIGATORIOS, SLUG, tipoDeSlug } from "@/lib/consent/tipos";

describe("tokens", () => {
  it("genera secretos de 32 bytes, distintos, y guarda solo su hash", () => {
    const a = nuevoSecreto();
    const b = nuevoSecreto();
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(hashSecreto(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecreto(a)).not.toContain(a);
  });
  it("códigos de 6 cifras con hash comparado en tiempo constante", () => {
    const c = nuevoCodigo();
    expect(c).toMatch(/^\d{6}$/);
    expect(mismoHash(hashCodigo(c), hashCodigo(c))).toBe(true);
    expect(mismoHash(hashCodigo(c), hashCodigo(c === "000000" ? "000001" : "000000"))).toBe(false);
  });
});

describe("DNI/NIE", () => {
  it("normaliza y valida la letra de control", () => {
    expect(normalizeDni(" 12.345.678-z ")).toBe("12345678Z");
    expect(isValidDni("12345678Z")).toBe(true);
    expect(isValidDni("12345678A")).toBe(false);
    expect(isValidDni("X1234567L")).toBe(true);
    expect(isValidDni("Y1234567X")).toBe(true);
    expect(isValidDni("1234")).toBe(false);
  });
});

describe("ManyChat", () => {
  it("convierte los móviles a formato internacional", () => {
    expect(aE164("600112233")).toBe("+34600112233");
    expect(aE164("+447700900123")).toBe("+447700900123");
  });
  it("rechaza cualquier campo fuera de la lista cerrada (nunca datos de salud)", async () => {
    usarManyChat(null); // cliente simulado (sin API key)
    delete process.env.MANYCHAT_API_KEY;
    await expect(manychat().ponerCampos("sub_1", { diagnostico: "fascitis" } as never)).rejects.toThrow(/no permitido/);
    expect(Object.values(CAMPOS).sort()).toEqual(
      ["ortosend_codigo", "ortosend_paciente", "ortosend_ref", "ortosend_url_acceso"].sort()
    );
  });
});

describe("documentos", () => {
  it("cinco documentos en orden, cuatro obligatorios, slugs reversibles", () => {
    expect(ORDEN).toHaveLength(5);
    expect(OBLIGATORIOS).not.toContain("MARKETING");
    for (const t of ORDEN) expect(tipoDeSlug(SLUG[t])).toBe(t);
    expect(tipoDeSlug("otro")).toBeNull();
  });
});
