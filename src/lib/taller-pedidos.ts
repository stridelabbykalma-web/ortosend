// Pedidos del taller tal como los ve el Rectificador (programa del taller): la lista en el
// mismo orden que el tablero del panel y el detalle con la pauta por pie, la ficha técnica
// y la hoja de confección. Solo lo necesario para fabricar (datos mínimos, RGPD).
import type { Case, Clinic, HojaConfeccion, Incident, Patient, Payment, User } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./cases";
import { nombreCompleto } from "./nombre";
import { PROD_STEPS, TALLER_STATES, fichaTecnica, ordenTaller, prodStepIndex, rehacerAbierto, slaDe, trabajoPorPie } from "./taller";
import type { Questionnaire } from "./questionnaire";
import type { Exam } from "./exploracion";
import { ErrorTaller, ajustesTaller, materialesTaller } from "./taller-ops";

type Fila = Case & { patient: Patient; clinic: Clinic; payment: Payment | null; incidents: Incident[] };

function resumen(c: Fila) {
  const paso = PROD_STEPS[prodStepIndex(c.state, c.fabPhase)];
  return {
    id: c.id,
    numero: c.number,
    paciente: nombreCompleto(c.patient),
    clinica: c.clinic.name,
    estado: c.state,
    fase: c.fabPhase,
    paso: paso?.label ?? c.state,
    lote: c.lot,
    material: c.material,
    plazo: slaDe(c),
    rehacer: rehacerAbierto(c),
    entrega: c.delivery,
    pagado: c.payment?.paidAt?.toISOString() ?? null,
    creado: c.createdAt.toISOString(),
  };
}

export async function listaPedidos() {
  const casos = await prisma.case.findMany({
    where: { state: { in: TALLER_STATES } },
    include: { patient: true, clinic: true, payment: true, incidents: true },
  });
  return ordenTaller(casos).map(resumen);
}

function hojaJson(h: HojaConfeccion | null) {
  if (!h) return null;
  return {
    proceso: h.proceso,
    capas: h.capas,
    notas: h.notas ?? "",
    minutosCnc: h.minutosCnc,
    minutosConfeccion: h.minutosConfeccion,
    coste: {
      materialCents: h.costeMaterialCents,
      fresadoCents: h.costeFresadoCents,
      manoObraCents: h.costeManoObraCents,
      totalCents: h.costeTotalCents,
    },
    actualizadoPor: h.actualizadoPor,
    actualizado: h.updatedAt.toISOString(),
  };
}

export async function detallePedido(caseId: string, user: Pick<User, "id">) {
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: { patient: true, clinic: true, payment: true, incidents: true, capture: true, prescription: true, hoja: true },
  });
  if (!c || !TALLER_STATES.includes(c.state)) throw new ErrorTaller("Caso no activo en taller", 404);
  // Registro de accesos a datos de salud (RGPD), como al abrir la ficha en la web.
  await audit(user.id, "case.view", `case:${c.number}`, c.patientId, { via: "rectificador" });
  const q = c.capture?.questionnaire as Questionnaire | null;
  const e = c.capture?.physicalExam as Exam | null;
  const [izq, dcho] = trabajoPorPie(c.prescription, e, q);
  return {
    ...resumen(c),
    pies: [izq, dcho],
    pauta: c.prescription?.fabricationOrder ?? null,
    ficha: fichaTecnica(q, e, c),
    hoja: hojaJson(c.hoja),
  };
}

export async function catalogoCoste() {
  const [materiales, ajustes] = await Promise.all([materialesTaller(true), ajustesTaller()]);
  return { materiales, ajustes };
}

export { hojaJson };
