// Cliente de la API de ManyChat (WhatsApp). Regla de oro: a ManyChat solo van
// nombre, móvil, el «ref» opaco de la invitación, enlaces y el código de acceso.
// NUNCA datos de salud: los campos que se pueden escribir están en una lista
// cerrada y cualquier otro se rechaza antes de salir.
//
// Sin MANYCHAT_API_KEY el cliente es simulado: cada envío queda en la tabla
// Notification (visible en el panel de administración) y se da por bueno.
import { prisma } from "./db";

export const CAMPOS = {
  ref: "ortosend_ref", // secreto de la invitación: va en los enlaces a los textos y en cada respuesta
  paciente: "ortosend_paciente", // nombre de pila del paciente (para que el tutor sepa de quién es)
  codigo: "ortosend_codigo", // código de 6 cifras para crear la contraseña
  urlAcceso: "ortosend_url_acceso",
} as const;
const PERMITIDOS = new Set<string>(Object.values(CAMPOS));

export const ETIQUETAS = { consentOk: "consent_ok", marketingOk: "marketing_ok" } as const;

// Flujos de ManyChat (su «flow_ns»). Ver docs/ALTA-WHATSAPP.md.
export const FLUJOS = {
  invitacion: () => process.env.MANYCHAT_FLOW_INVITACION ?? "",
  recordatorio: () => process.env.MANYCHAT_FLOW_RECORDATORIO ?? "",
  acceso: () => process.env.MANYCHAT_FLOW_ACCESO ?? "",
  codigo: () => process.env.MANYCHAT_FLOW_CODIGO ?? "",
};

export type Contacto = { telefonoE164: string; nombre: string; apellidos?: string | null; fraseConsentimiento: string };

export interface ManyChat {
  readonly simulado: boolean;
  buscarOCrearContacto(c: Contacto): Promise<string>; // devuelve subscriber_id
  ponerCampos(subscriberId: string, campos: Partial<Record<(typeof CAMPOS)[keyof typeof CAMPOS], string>>): Promise<void>;
  lanzarFlujo(subscriberId: string, flowNs: string): Promise<unknown>;
  ponerEtiqueta(subscriberId: string, etiqueta: string): Promise<void>;
  quitarEtiqueta(subscriberId: string, etiqueta: string): Promise<void>;
}

export class ManyChatError extends Error {
  constructor(message: string, readonly detalle?: unknown) {
    super(message);
  }
}

// Móviles guardados como 9 cifras (España) → +34…; extranjeros ya llevan «+».
export function aE164(telefono: string) {
  const t = telefono.replace(/[^\d+]/g, "");
  if (t.startsWith("+")) return t;
  if (/^\d{9}$/.test(t)) return "+34" + t;
  return "+" + t;
}

function comprobarCampos(campos: Record<string, string | undefined>) {
  for (const k of Object.keys(campos))
    if (!PERMITIDOS.has(k)) throw new ManyChatError(`Campo no permitido hacia ManyChat: ${k}`);
}

const API = "https://api.manychat.com";

class ManyChatApi implements ManyChat {
  readonly simulado = false;
  constructor(private readonly key: string) {}

  private async call(method: "GET" | "POST", path: string, body?: unknown) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(API + path, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", Accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const json = (await res.json().catch(() => null)) as { status?: string; data?: unknown; message?: string } | null;
      if (!res.ok || json?.status !== "success")
        throw new ManyChatError(`ManyChat ${path}: ${json?.message ?? res.status}`, json);
      return json.data;
    } catch (e) {
      if (e instanceof ManyChatError) throw e;
      throw new ManyChatError(`ManyChat ${path}: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async buscarOCrearContacto(c: Contacto) {
    const found = (await this.call(
      "GET",
      `/fb/subscriber/findBySystemField?phone=${encodeURIComponent(c.telefonoE164)}`
    ).catch(() => null)) as { id?: string | number } | null;
    if (found?.id) return String(found.id);
    const created = (await this.call("POST", "/fb/subscriber/createSubscriber", {
      first_name: c.nombre,
      last_name: c.apellidos ?? "",
      whatsapp_phone: c.telefonoE164,
      has_opt_in_sms: false,
      has_opt_in_email: false,
      consent_phrase: c.fraseConsentimiento,
    })) as { id?: string | number };
    if (!created?.id) throw new ManyChatError("ManyChat no devolvió el contacto creado", created);
    return String(created.id);
  }

  async ponerCampos(subscriberId: string, campos: Record<string, string | undefined>) {
    comprobarCampos(campos);
    for (const [field_name, field_value] of Object.entries(campos)) {
      if (field_value === undefined) continue;
      await this.call("POST", "/fb/subscriber/setCustomFieldByName", { subscriber_id: subscriberId, field_name, field_value });
    }
  }

  async lanzarFlujo(subscriberId: string, flowNs: string) {
    if (!flowNs) throw new ManyChatError("Falta el ID del flujo de ManyChat (variables MANYCHAT_FLOW_*)");
    await this.call("POST", "/fb/sending/sendFlow", { subscriber_id: subscriberId, flow_ns: flowNs });
    return { subscriber_id: subscriberId, flow_ns: flowNs, enviado: new Date().toISOString() };
  }

  async ponerEtiqueta(subscriberId: string, tag_name: string) {
    await this.call("POST", "/fb/subscriber/addTagByName", { subscriber_id: subscriberId, tag_name });
  }

  async quitarEtiqueta(subscriberId: string, tag_name: string) {
    await this.call("POST", "/fb/subscriber/removeTagByName", { subscriber_id: subscriberId, tag_name });
  }
}

// Modo desarrollo: registra lo que se habría enviado.
class ManyChatSimulado implements ManyChat {
  readonly simulado = true;
  private async log(toPhone: string | null, template: string, payload: Record<string, unknown>) {
    await prisma.notification.create({
      data: { channel: "whatsapp", toPhone, template: `manychat:${template}`, payload: payload as object, sentAt: null },
    });
  }
  async buscarOCrearContacto(c: Contacto) {
    return `sim_${c.telefonoE164.replace(/\D/g, "")}`;
  }
  async ponerCampos(subscriberId: string, campos: Record<string, string | undefined>) {
    comprobarCampos(campos);
    await this.log(subscriberId.replace(/^sim_/, "+"), "campos", { subscriberId, ...campos });
  }
  async lanzarFlujo(subscriberId: string, flowNs: string) {
    await this.log(subscriberId.replace(/^sim_/, "+"), "flujo", { subscriberId, flowNs });
    return { simulado: true, subscriber_id: subscriberId, flow_ns: flowNs };
  }
  async ponerEtiqueta(subscriberId: string, etiqueta: string) {
    await this.log(subscriberId.replace(/^sim_/, "+"), "etiqueta", { subscriberId, etiqueta });
  }
  async quitarEtiqueta(subscriberId: string, etiqueta: string) {
    await this.log(subscriberId.replace(/^sim_/, "+"), "quitar_etiqueta", { subscriberId, etiqueta });
  }
}

let instancia: ManyChat | null = null;
export function manychat(): ManyChat {
  if (!instancia) {
    const key = process.env.MANYCHAT_API_KEY;
    instancia = key ? new ManyChatApi(key) : new ManyChatSimulado();
  }
  return instancia;
}

// Solo para tests.
export function usarManyChat(mc: ManyChat | null) {
  instancia = mc;
}
