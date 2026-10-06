// ManyChat de mentira: guarda cada llamada para comprobar qué saldría hacia fuera.
import { CAMPOS, ManyChatError, type Contacto, type ManyChat } from "@/lib/manychat";

export type Llamada =
  | { op: "contacto"; contacto: Contacto }
  | { op: "campos"; sub: string; campos: Record<string, string | undefined> }
  | { op: "flujo"; sub: string; flow: string }
  | { op: "etiqueta"; sub: string; etiqueta: string }
  | { op: "quitar"; sub: string; etiqueta: string };

const PERMITIDOS = new Set<string>(Object.values(CAMPOS));

export class FakeManyChat implements ManyChat {
  readonly simulado = true;
  llamadas: Llamada[] = [];
  fallar = false;

  private check() {
    if (this.fallar) throw new ManyChatError("ManyChat caído (simulado)");
  }
  async buscarOCrearContacto(c: Contacto) {
    this.check();
    this.llamadas.push({ op: "contacto", contacto: c });
    return `sub_${c.telefonoE164.replace(/\D/g, "")}`;
  }
  async ponerCampos(sub: string, campos: Record<string, string | undefined>) {
    this.check();
    for (const k of Object.keys(campos)) if (!PERMITIDOS.has(k)) throw new ManyChatError(`campo no permitido ${k}`);
    this.llamadas.push({ op: "campos", sub, campos });
  }
  async lanzarFlujo(sub: string, flow: string) {
    this.check();
    this.llamadas.push({ op: "flujo", sub, flow });
    return { ok: true };
  }
  async ponerEtiqueta(sub: string, etiqueta: string) {
    this.check();
    this.llamadas.push({ op: "etiqueta", sub, etiqueta });
  }
  async quitarEtiqueta(sub: string, etiqueta: string) {
    this.check();
    this.llamadas.push({ op: "quitar", sub, etiqueta });
  }

  // Último valor escrito en un campo personalizado.
  campo(nombre: string) {
    for (let i = this.llamadas.length - 1; i >= 0; i--) {
      const l = this.llamadas[i];
      if (l.op === "campos" && l.campos[nombre] !== undefined) return l.campos[nombre]!;
    }
    return null;
  }
}
