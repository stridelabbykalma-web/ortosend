"use server";

// Pasos del pedido desde el móvil del taller (mismas operaciones que el panel y Ortosend Taller).
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { ErrorTaller, marcarConfeccion, marcarMecanizado } from "@/lib/taller-ops";

function volver(caseId: string, campo: "ok" | "error", texto: string): never {
  redirect(`/taller/${caseId}?${campo}=${encodeURIComponent(texto)}`);
}

export async function fresadoMovilAction(formData: FormData) {
  const u = await requireRole("TALLER", "ADMIN");
  const caseId = String(formData.get("caseId"));
  try {
    await marcarMecanizado(caseId, u, String(formData.get("lote") ?? ""));
  } catch (e) {
    if (e instanceof ErrorTaller) volver(caseId, "error", e.message);
    throw e;
  }
  volver(caseId, "ok", "Molde fresado: pasa a confección");
}

export async function confeccionMovilAction(formData: FormData) {
  const u = await requireRole("TALLER", "ADMIN");
  const caseId = String(formData.get("caseId"));
  try {
    await marcarConfeccion(caseId, u, "");
  } catch (e) {
    if (e instanceof ErrorTaller) volver(caseId, "error", e.message);
    throw e;
  }
  redirect("/taller?ok=" + encodeURIComponent("Confección terminada: el par pasa a control de calidad"));
}
