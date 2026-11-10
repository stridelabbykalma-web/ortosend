"use server";

// Conexión de la agenda con los programas de la clínica (Docfav por API,
// calendarios iCal de Google/Outlook/Apple u otros programas): alta y cambio
// de la clave, elección de la cuenta, enlaces entre agendas, servicio, enlaces
// iCal, lectura manual, desconexión y reintento de la copia de una cita.
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { cifrar, pistaDe } from "@/lib/secretos";
import { claveDe, leerOcupacion, mantenimientoConectores, sincronizarCita } from "@/lib/conector";
import { proveedorDe } from "@/lib/conector/registro";
import { descargarTexto, normalizarEnlace } from "@/lib/conector/red";
import type { Cuenta, ProveedorApi } from "@/lib/conector/tipos";

const BACK = "/panel?tab=disp#conector";

// Añade ?error= / ?ok= antes del ancla (#conector) para volver a la tarjeta.
function conMensaje(back: string, clave: "ok" | "error", msg: string) {
  const [ruta, ancla] = back.split("#");
  return `${ruta}${ruta.includes("?") ? "&" : "?"}${clave}=${encodeURIComponent(msg)}${ancla ? `#${ancla}` : ""}`;
}
function fail(msg: string, back = BACK): never {
  redirect(conMensaje(back, "error", msg));
}
function ok(msg: string, back = BACK): never {
  redirect(conMensaje(back, "ok", msg));
}

async function requireAdminClinica(): Promise<User & { clinicId: string }> {
  const u = await requireRole("ADMIN_CLINICA");
  if (!u.clinicId) throw new Error("Usuario sin clínica asignada");
  return u as User & { clinicId: string };
}

function proveedorApi(kind: string): ProveedorApi {
  const p = proveedorDe(kind);
  if (!p || p.modo !== "api") fail("Programa no válido");
  return p as ProveedorApi;
}

async function conectorDeLaClinica(clinicId: string, kind: string) {
  return prisma.calendarConnector.findUnique({ where: { clinicId_kind: { clinicId, kind } }, include: { links: true } });
}

async function equipoDe(clinicId: string) {
  const equipo = await prisma.user.findMany({
    where: { clinicId, active: true, role: { in: ["PROFESIONAL", "ADMIN_CLINICA"] } },
    select: { id: true, name: true },
  });
  return [{ id: null as string | null, name: "Agenda de la clínica" }, ...equipo];
}

// Olvida enlaces, ocupación y fichas de un conector (cambio de cuenta).
async function vaciar(connectorId: string) {
  await prisma.connectorLink.deleteMany({ where: { connectorId } });
  await prisma.externalBusy.deleteMany({ where: { connectorId } });
  await prisma.patientExternalRef.deleteMany({ where: { connectorId } });
}

// --- Programas con API (Docfav…) ---

// Guarda (o cambia) la clave de API después de comprobarla contra el programa.
export async function conectarApiAction(formData: FormData) {
  const u = await requireAdminClinica();
  const prov = proveedorApi(String(formData.get("kind") ?? ""));
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!apiKey || (prov.formatoClave && !prov.formatoClave.test(apiKey))) fail(`Esa no parece una clave de ${prov.nombre}. ${prov.ayuda}`);
  let cuentas: Cuenta[] = [];
  try {
    cuentas = await prov.cuentas(apiKey);
  } catch (e) {
    fail(`No se pudo conectar con esa clave: ${prov.explicarError(e)}`);
  }
  if (!cuentas.length) fail(`Esa clave no da acceso a ninguna clínica de ${prov.nombre}`);
  const previo = await conectorDeLaClinica(u.clinicId, prov.kind);
  // Si la cuenta elegida sigue accesible se conserva; si solo hay una, se elige sola.
  const sigue = previo?.externalClinicId ? cuentas.find((c) => c.id === previo.externalClinicId) : undefined;
  const elegida = sigue ?? (cuentas.length === 1 ? cuentas[0] : undefined);
  const datos = {
    apiKeyEnc: cifrar(apiKey),
    apiKeyHint: pistaDe(apiKey),
    active: true,
    externalClinicId: elegida?.id ?? null,
    externalClinicName: elegida?.name ?? null,
    lastError: null,
  };
  if (previo) {
    if (previo.externalClinicId && previo.externalClinicId !== elegida?.id) {
      await vaciar(previo.id);
      await prisma.calendarConnector.update({ where: { id: previo.id }, data: { ...datos, serviceId: null, lastSyncAt: null } });
    } else await prisma.calendarConnector.update({ where: { id: previo.id }, data: datos });
  } else await prisma.calendarConnector.create({ data: { ...datos, clinicId: u.clinicId, kind: prov.kind } });
  ok(elegida ? `Conectado con ${prov.nombre} (${elegida.name}). Ahora enlaza cada agenda con su profesional.` : `Clave guardada. Elige la clínica de ${prov.nombre}.`);
}

export async function elegirCuentaAction(formData: FormData) {
  const u = await requireAdminClinica();
  const prov = proveedorApi(String(formData.get("kind") ?? ""));
  const id = String(formData.get("externalClinicId") ?? "");
  const c = await conectorDeLaClinica(u.clinicId, prov.kind);
  if (!c?.apiKeyEnc) fail(`Primero guarda la clave de ${prov.nombre}`);
  let nombre: string | undefined;
  try {
    nombre = (await prov.cuentas(claveDe(c!)!)).find((x) => x.id === id)?.name;
  } catch (e) {
    fail(prov.explicarError(e));
  }
  if (!nombre) fail(`Clínica de ${prov.nombre} no válida`);
  if (c!.externalClinicId !== id) await vaciar(c!.id);
  await prisma.calendarConnector.update({
    where: { id: c!.id },
    data: { externalClinicId: id, externalClinicName: nombre, serviceId: null, lastSyncAt: null },
  });
  ok(`Clínica de ${prov.nombre} elegida: ${nombre}`);
}

// Enlaces agenda de Ortosend ↔ agenda del profesional en el programa, servicio y opciones.
export async function guardarConectorApiAction(formData: FormData) {
  const u = await requireAdminClinica();
  const prov = proveedorApi(String(formData.get("kind") ?? ""));
  const c = await conectorDeLaClinica(u.clinicId, prov.kind);
  if (!c?.externalClinicId) fail(`Primero conecta ${prov.nombre} y elige la clínica`);
  const clave = claveDe(c!)!;
  let agendas: Awaited<ReturnType<ProveedorApi["agendas"]>> = [];
  let servicios: Awaited<ReturnType<NonNullable<ProveedorApi["servicios"]>>> = [];
  try {
    [agendas, servicios] = await Promise.all([prov.agendas(clave, c!.externalClinicId!), prov.servicios ? prov.servicios(clave, c!.externalClinicId!) : []]);
  } catch (e) {
    fail(prov.explicarError(e));
  }
  const enlaces: { professionalId: string | null; externalCalendarId: string; externalPlaceId: string; externalStaffId: string; externalName: string }[] = [];
  for (const a of await equipoDe(u.clinicId)) {
    const v = String(formData.get(`link_${a.id ?? "clinica"}`) ?? "");
    if (!v) continue;
    const ag = agendas.find((x) => x.id === v);
    if (!ag) fail(`Una de las agendas de ${prov.nombre} elegidas ya no existe: recarga la página`);
    enlaces.push({ professionalId: a.id, externalCalendarId: ag!.id, externalPlaceId: ag!.placeId, externalStaffId: ag!.staffId, externalName: ag!.nombre });
  }
  if (new Set(enlaces.map((e) => e.externalCalendarId)).size !== enlaces.length)
    fail(`Cada agenda de ${prov.nombre} solo puede enlazarse con una agenda de Ortosend`);

  const servicioElegido = String(formData.get("serviceId") ?? "");
  if (servicioElegido && !servicios.some((s) => s.id === servicioElegido && s.active)) fail(`Ese servicio no está activo en ${prov.nombre}`);
  const serviceName = String(formData.get("serviceName") ?? "").trim() || "Ortosend";

  await prisma.$transaction([
    prisma.connectorLink.deleteMany({ where: { connectorId: c!.id } }),
    prisma.connectorLink.createMany({ data: enlaces.map((e) => ({ ...e, connectorId: c!.id })) }),
    prisma.calendarConnector.update({
      where: { id: c!.id },
      data: {
        serviceName,
        serviceId: servicioElegido || null,
        respectHours: formData.get("respectHours") === "on",
        pushAppointments: formData.get("pushAppointments") === "on",
      },
    }),
  ]);
  const r = await leerOcupacion(c!.id);
  if (!r.ok) fail(`Guardado, pero no se pudo leer la agenda de ${prov.nombre}: ${r.error}`);
  ok(`Guardado. ${enlaces.length} agenda${enlaces.length === 1 ? "" : "s"} enlazada${enlaces.length === 1 ? "" : "s"}; ocupación de ${prov.nombre} leída.`);
}

// --- Calendarios iCal (Google, Outlook, Apple u otro programa) ---

// Guarda el enlace iCal de cada agenda (vacío = se queda el que había; marcar
// «quitar» lo borra). Cada enlace nuevo se descarga una vez para comprobarlo.
export async function guardarIcalAction(formData: FormData) {
  const u = await requireAdminClinica();
  let c = await conectorDeLaClinica(u.clinicId, "ICAL");
  if (!c) c = await prisma.calendarConnector.create({ data: { clinicId: u.clinicId, kind: "ICAL" }, include: { links: true } });
  let cambios = 0;
  for (const a of await equipoDe(u.clinicId)) {
    const clave = a.id ?? "clinica";
    const previo = c.links.find((l) => l.professionalId === a.id);
    if (formData.get(`quitar_${clave}`) === "on") {
      if (previo) {
        await prisma.connectorLink.delete({ where: { id: previo.id } });
        cambios++;
      }
      continue;
    }
    const raw = String(formData.get(`ical_${clave}`) ?? "").trim();
    if (!raw) continue;
    let url: string;
    try {
      url = normalizarEnlace(raw).toString();
      const texto = await descargarTexto(url);
      if (!/BEGIN:VCALENDAR/i.test(texto)) throw new Error("ese enlace no devuelve un calendario iCal");
    } catch (e) {
      fail(`Calendario de ${a.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const datos = { secretEnc: cifrar(url!), externalName: `${a.name} · calendario ${new URL(url!).hostname}` };
    if (previo) await prisma.connectorLink.update({ where: { id: previo.id }, data: datos });
    else
      await prisma.connectorLink.create({
        data: { ...datos, connectorId: c.id, professionalId: a.id, externalCalendarId: `ical:${clave}`, externalPlaceId: "ical", externalStaffId: `ical:${clave}` },
      });
    cambios++;
  }
  await prisma.calendarConnector.update({ where: { id: c.id }, data: { active: true, lastSyncAt: null } });
  const r = await leerOcupacion(c.id);
  if (!r.ok) fail(`Guardado, pero no se pudieron leer los calendarios: ${r.error}`);
  ok(cambios ? `Calendarios guardados y leídos (${r.tramos} tramos ocupados).` : "Sin cambios en los calendarios.");
}

// --- Comunes ---

async function conectorPropio(connectorId: string, clinicId: string) {
  const c = await prisma.calendarConnector.findUnique({ where: { id: connectorId } });
  if (!c || c.clinicId !== clinicId) fail("Conector no encontrado");
  return c!;
}

export async function sincronizarConectorAction(formData: FormData) {
  const u = await requireRole("ADMIN_CLINICA", "PROFESIONAL");
  if (!u.clinicId) fail("Usuario sin clínica");
  const c = await conectorPropio(String(formData.get("connectorId") ?? ""), u.clinicId!);
  const r = await leerOcupacion(c.id);
  if (!r.ok) fail(r.error ?? "No se pudo leer el programa");
  // De paso, reintenta las citas pendientes de apuntar o anular.
  await mantenimientoConectores().catch(() => null);
  ok(`Agenda leída: ${r.tramos} tramos ocupados`);
}

export async function desconectarAction(formData: FormData) {
  const u = await requireAdminClinica();
  const c = await conectorPropio(String(formData.get("connectorId") ?? ""), u.clinicId);
  const nombre = proveedorDe(c.kind)?.nombre ?? "el programa";
  await prisma.calendarConnector.delete({ where: { id: c.id } });
  ok(`${nombre} desconectado. Las citas ya apuntadas allí se quedan como están.`);
}

// Desde la agenda: volver a intentar apuntar una cita en el programa, o
// apuntarla aunque lo vea fuera de horario o solapada («forzar»).
export async function reintentarCitaExternaAction(formData: FormData) {
  const u = await requireRole("ADMIN_CLINICA", "PROFESIONAL");
  const back = String(formData.get("back") ?? "/panel?tab=agenda");
  const id = String(formData.get("appointmentId") ?? "");
  const a = await prisma.appointment.findUnique({ where: { id }, select: { clinicId: true } });
  if (!a || a.clinicId !== u.clinicId) redirect(conMensaje(back, "error", "Cita no accesible"));
  await prisma.appointment.update({ where: { id }, data: { externalState: null } });
  await sincronizarCita(id, { forzar: formData.get("forzar") === "1" });
  const r = await prisma.appointment.findUnique({ where: { id }, select: { externalState: true, externalError: true } });
  const creada = r?.externalState === "creada";
  redirect(conMensaje(back, creada ? "ok" : "error", creada ? "Cita apuntada en el programa de la clínica" : `El programa sigue sin aceptarla: ${r?.externalError ?? "error"}`));
}
