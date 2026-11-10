"use server";

// Conexión de la agenda con el programa de gestión de la clínica (Docfav):
// alta y cambio de la clave, elección de la clínica, enlaces entre agendas,
// servicio, lectura manual y reintento de la copia de una cita.
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { cifrar, pistaDe } from "@/lib/secretos";
import { docfav } from "@/lib/conector/docfav";
import { clienteDe, explicarError, KIND_DOCFAV, leerOcupacion, mantenimientoConectores, sincronizarCita } from "@/lib/conector";

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

// Guarda (o cambia) la clave de API después de comprobarla contra Docfav.
export async function conectarDocfavAction(formData: FormData) {
  const u = await requireAdminClinica();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!/^df_pk_[A-Za-z0-9_-]{16,}$/.test(apiKey)) fail("La clave de Docfav empieza por «df_pk_». Cópiala completa desde Docfav → Mi cuenta → API Keys");
  let clinicas: { id: string; name: string }[] = [];
  try {
    const api = docfav(apiKey);
    await api.me();
    clinicas = await api.clinics();
  } catch (e) {
    fail(`No se pudo conectar con esa clave: ${explicarError(e)}`);
  }
  if (!clinicas.length) fail("Esa clave no da acceso a ninguna clínica de Docfav");
  const previo = await prisma.calendarConnector.findUnique({ where: { clinicId_kind: { clinicId: u.clinicId, kind: KIND_DOCFAV } } });
  // Si la clínica de Docfav sigue siendo accesible se conserva; si solo hay una, se elige sola.
  const sigue = previo?.externalClinicId ? clinicas.find((c) => c.id === previo.externalClinicId) : undefined;
  const elegida = sigue ?? (clinicas.length === 1 ? clinicas[0] : undefined);
  const datos = {
    apiKeyEnc: cifrar(apiKey),
    apiKeyHint: pistaDe(apiKey),
    active: true,
    externalClinicId: elegida?.id ?? null,
    externalClinicName: elegida?.name ?? null,
    lastError: null,
  };
  if (previo) {
    // Otra clínica de Docfav: los enlaces y fichas anteriores ya no valen.
    if (previo.externalClinicId && previo.externalClinicId !== elegida?.id) {
      await prisma.connectorLink.deleteMany({ where: { connectorId: previo.id } });
      await prisma.externalBusy.deleteMany({ where: { connectorId: previo.id } });
      await prisma.patientExternalRef.deleteMany({ where: { connectorId: previo.id } });
      await prisma.calendarConnector.update({ where: { id: previo.id }, data: { ...datos, serviceId: null, lastSyncAt: null } });
    } else await prisma.calendarConnector.update({ where: { id: previo.id }, data: datos });
  } else await prisma.calendarConnector.create({ data: { ...datos, clinicId: u.clinicId, kind: KIND_DOCFAV } });
  ok(elegida ? `Conectado con Docfav (${elegida.name}). Ahora enlaza cada agenda con su profesional.` : "Clave guardada. Elige la clínica de Docfav.");
}

export async function elegirClinicaDocfavAction(formData: FormData) {
  const u = await requireAdminClinica();
  const id = String(formData.get("externalClinicId") ?? "");
  const c = await prisma.calendarConnector.findUnique({ where: { clinicId_kind: { clinicId: u.clinicId, kind: KIND_DOCFAV } } });
  if (!c) fail("Primero guarda la clave de Docfav");
  let nombre: string | undefined;
  try {
    nombre = (await clienteDe(c!).clinics()).find((x) => x.id === id)?.name;
  } catch (e) {
    fail(explicarError(e));
  }
  if (!nombre) fail("Clínica de Docfav no válida");
  if (c!.externalClinicId !== id) {
    await prisma.connectorLink.deleteMany({ where: { connectorId: c!.id } });
    await prisma.externalBusy.deleteMany({ where: { connectorId: c!.id } });
    await prisma.patientExternalRef.deleteMany({ where: { connectorId: c!.id } });
  }
  await prisma.calendarConnector.update({
    where: { id: c!.id },
    data: { externalClinicId: id, externalClinicName: nombre, serviceId: null, lastSyncAt: null },
  });
  ok(`Clínica de Docfav elegida: ${nombre}`);
}

// Enlaces agenda de Ortosend ↔ agenda del profesional en Docfav, servicio y opciones.
export async function guardarConectorAction(formData: FormData) {
  const u = await requireAdminClinica();
  const c = await prisma.calendarConnector.findUnique({ where: { clinicId_kind: { clinicId: u.clinicId, kind: KIND_DOCFAV } } });
  if (!c?.externalClinicId) fail("Primero conecta Docfav y elige la clínica");
  const api = clienteDe(c!);
  let calendarios: Awaited<ReturnType<typeof api.staffCalendars>> = [];
  let personal: Awaited<ReturnType<typeof api.staff>> = [];
  let sitios: Awaited<ReturnType<typeof api.places>> = [];
  let servicios: Awaited<ReturnType<typeof api.services>> = [];
  try {
    [calendarios, personal, sitios, servicios] = await Promise.all([
      api.staffCalendars(c!.externalClinicId!),
      api.staff(c!.externalClinicId!),
      api.places(c!.externalClinicId!),
      api.services(c!.externalClinicId!),
    ]);
  } catch (e) {
    fail(explicarError(e));
  }
  const equipo = await prisma.user.findMany({
    where: { clinicId: u.clinicId, active: true, role: { in: ["PROFESIONAL", "ADMIN_CLINICA"] } },
    select: { id: true },
  });
  const agendas: (string | null)[] = [null, ...equipo.map((x) => x.id)];
  const enlaces: { professionalId: string | null; externalCalendarId: string; externalPlaceId: string; externalStaffId: string; externalName: string }[] = [];
  for (const pid of agendas) {
    const v = String(formData.get(`link_${pid ?? "clinica"}`) ?? "");
    if (!v) continue;
    const sc = calendarios.find((x) => x.id === v);
    if (!sc) fail("Una de las agendas de Docfav elegidas ya no existe: recarga la página");
    const nombre = personal.find((p) => p.id === sc!.staffId)?.fullname ?? "Profesional";
    const sitio = sitios.find((p) => p.id === sc!.placeId)?.name ?? "";
    enlaces.push({
      professionalId: pid,
      externalCalendarId: sc!.id,
      externalPlaceId: sc!.placeId,
      externalStaffId: sc!.staffId,
      externalName: sitio ? `${nombre} · ${sitio}` : nombre,
    });
  }
  if (new Set(enlaces.map((e) => e.externalCalendarId)).size !== enlaces.length)
    fail("Cada agenda de Docfav solo puede enlazarse con una agenda de Ortosend");

  const servicioElegido = String(formData.get("serviceId") ?? "");
  if (servicioElegido && !servicios.some((s) => s.id === servicioElegido && s.active)) fail("Ese servicio no está activo en Docfav");
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
  if (!r.ok) fail(`Guardado, pero no se pudo leer la agenda de Docfav: ${r.error}`);
  ok(`Guardado. ${enlaces.length} agenda${enlaces.length === 1 ? "" : "s"} enlazada${enlaces.length === 1 ? "" : "s"}; ocupación de Docfav leída.`);
}

export async function sincronizarConectorAction() {
  const u = await requireRole("ADMIN_CLINICA", "PROFESIONAL");
  if (!u.clinicId) fail("Usuario sin clínica");
  const c = await prisma.calendarConnector.findUnique({ where: { clinicId_kind: { clinicId: u.clinicId!, kind: KIND_DOCFAV } } });
  if (!c) fail("La clínica no tiene Docfav conectado");
  const r = await leerOcupacion(c!.id);
  if (!r.ok) fail(r.error ?? "No se pudo leer Docfav");
  // De paso, reintenta las citas pendientes de apuntar o anular en Docfav.
  await mantenimientoConectores().catch(() => null);
  ok(`Agenda de Docfav leída: ${r.tramos} tramos ocupados`);
}

export async function desconectarDocfavAction() {
  const u = await requireAdminClinica();
  await prisma.calendarConnector.deleteMany({ where: { clinicId: u.clinicId, kind: KIND_DOCFAV } });
  ok("Docfav desconectado. Las citas ya apuntadas allí se quedan como están.");
}

// Desde la agenda: volver a intentar apuntar una cita en Docfav, o apuntarla
// aunque Docfav la vea fuera de horario o solapada («forzar»).
export async function reintentarCitaExternaAction(formData: FormData) {
  const u = await requireRole("ADMIN_CLINICA", "PROFESIONAL");
  const back = String(formData.get("back") ?? "/panel?tab=agenda");
  const id = String(formData.get("appointmentId") ?? "");
  const a = await prisma.appointment.findUnique({ where: { id }, select: { clinicId: true } });
  if (!a || a.clinicId !== u.clinicId) redirect(`${back}&error=${encodeURIComponent("Cita no accesible")}`);
  await prisma.appointment.update({ where: { id }, data: { externalState: null } });
  await sincronizarCita(id, { forzar: formData.get("forzar") === "1" });
  const r = await prisma.appointment.findUnique({ where: { id }, select: { externalState: true, externalError: true } });
  const msg = r?.externalState === "creada" ? "Cita apuntada en Docfav" : `Docfav sigue sin aceptarla: ${r?.externalError ?? "error"}`;
  redirect(`${back}&${r?.externalState === "creada" ? "ok" : "error"}=${encodeURIComponent(msg)}`);
}
