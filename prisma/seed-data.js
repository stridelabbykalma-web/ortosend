// Datos de demo compartidos: usados por `npx prisma db seed` y por /api/seed.
const bcrypt = require("bcryptjs");

const PASS = "ortosend123";

// Lo que se captura con la cámara de la app: 2 vídeos de marcha (descalzo) + 2 fotos de los pies de cerca
const CAPTURA_VISUAL = [
  "video_post_descalzo",
  "video_ant_descalzo",
  "foto_posterior",
  "foto_anterior",
];
const BARO_KINDS = ["baro_est", "baro_din_multi"];
const SCAN_KIND = "scan_espumas";

function inDays(d, h = 10, m = 0) {
  const t = new Date();
  t.setDate(t.getDate() + d);
  t.setHours(h, m, 0, 0);
  return t;
}

// Instante UTC de una hora de reloj de Madrid (sin librerías): calcula el
// desfase de la zona para ese día con Intl.
function madrid(y, m, d, hh, mm = 0) {
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(naive));
  const g = (t) => +parts.find((p) => p.type === t).value;
  const local = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
  return new Date(naive - (local - naive));
}

// Próximo lunes (fecha local de Madrid) a partir de hoy + 2 días, como {y,m,d}.
function nextMondayMadrid() {
  const now = new Date(Date.now() + 2 * 86400000);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t) => +parts.find((p) => p.type === t).value;
  const t = new Date(Date.UTC(g("year"), g("month") - 1, g("day")));
  const wd = t.getUTCDay(); // 0 domingo
  const add = wd === 1 ? 0 : (8 - wd) % 7;
  t.setUTCDate(t.getUTCDate() + add);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// Franjas semanales: días ISO (1 lunes … 7 domingo) × [inicio, fin] en minutos.
function franjas(professionalId, dias, tramos, extra = {}) {
  const out = [];
  for (const weekday of dias)
    for (const [startMin, endMin] of tramos) out.push({ professionalId, weekday, startMin, endMin, ...extra });
  return out;
}

async function seedDemo(prisma) {
  const hash = await bcrypt.hash(PASS, 10);
  const consent = (via) => ({
    salud: { aceptado: true, fecha: new Date().toISOString(), version: "v1", via },
    whatsapp: { aceptado: true, fecha: new Date().toISOString(), version: "v1" },
  });

  // --- Clínicas ---
  const c1 = await prisma.clinic.create({
    data: {
      name: "Clínica Girona Centre",
      address: "C/ Nou 12, Girona",
      town: "Girona",
      postalCode: "17001",
      lat: 41.9794,
      lng: 2.8214,
      status: "ACTIVA",
      hasPrescriber: true,
      equipment: {
        create: [
          { type: "Revopoint Inspire 2", serial: "INV-C1-001", deliveredAt: new Date() },
          { type: "Podisense GO", serial: "PS-C1-001", deliveredAt: new Date() },
        ],
      },
      patientPicksPro: true,
      // Agenda de la clínica (sala/equipo): mañanas de lunes a viernes
      availabilityRules: { create: franjas(null, [1, 2, 3, 4, 5], [[9 * 60, 13 * 60]]) },
    },
  });
  const c2 = await prisma.clinic.create({
    data: {
      name: "Centre Podològic Cassà",
      address: "Av. Pau Casals 3, Cassà de la Selva",
      town: "Cassà de la Selva",
      postalCode: "17244",
      lat: 41.889,
      lng: 2.8735,
      status: "ACTIVA",
      hasPrescriber: false,
      equipment: {
        create: [
          { type: "Revopoint Inspire 2", serial: "INV-C2-001", deliveredAt: new Date() },
          { type: "Podisense GO", serial: "PS-C2-001", deliveredAt: new Date() },
        ],
      },
      slotMinutes: 60,
      availabilityRules: { create: franjas(null, [1, 2, 3, 4, 5], [[10 * 60, 14 * 60]]) },
    },
  });
  await prisma.clinic.create({
    data: {
      name: "Clínica Llagostera Salut",
      address: "C/ Major 45, Llagostera",
      town: "Llagostera",
      postalCode: "17240",
      lat: 41.8296,
      lng: 2.8931,
      status: "ACTIVA",
      hasPrescriber: false,
      // Solo martes y jueves por la mañana; los sábados no se publican en la web
      availabilityRules: {
        create: [
          ...franjas(null, [2, 4], [[9 * 60, 13 * 60]]),
          ...franjas(null, [6], [[10 * 60, 12 * 60]], { online: false }),
        ],
      },
    },
  });

  // --- Usuarios ---
  const mkTraining = () =>
    ["M1 sistema", "M2 escáner", "M3 Podisense", "M4 vídeos", "M5 reciclaje anual"].map((m) => ({
      module: m,
      completedAt: new Date(),
      expiresAt: m === "M5 reciclaje anual" ? inDays(365) : null,
    }));

  await prisma.user.create({
    data: {
      email: "admin@ortosend.com",
      passwordHash: hash,
      role: "ADMIN",
      name: "Administración Ortosend",
      activatedAt: new Date(),
    },
  });
  await prisma.user.create({
    data: {
      email: "clinica@ortosend.com",
      passwordHash: hash,
      role: "ADMIN_CLINICA",
      name: "Admin Clínica Girona",
      clinicId: c1.id,
      activatedAt: new Date(),
    },
  });
  const draSerra = await prisma.user.create({
    data: {
      email: "profesionalreceta@ortosend.com",
      passwordHash: hash,
      role: "PROFESIONAL",
      name: "Dra. Laia Serra (podóloga)",
      clinicId: c1.id,
      activatedAt: new Date(),
      professional: {
        create: {
          dni: "11111111A",
          degree: "Podología",
          canPrescribe: true,
          collegiateNum: "COL-1234",
          college: "Col·legi de Podòlegs de Catalunya (Girona)",
          verifiedAt: new Date(),
          training: { create: mkTraining() },
        },
      },
    },
  });
  // Dra. Serra: tardes de lunes, miércoles y viernes
  await prisma.availabilityRule.createMany({
    data: franjas(draSerra.id, [1, 3, 5], [[16 * 60, 20 * 60]]).map((r) => ({ ...r, clinicId: c1.id })),
  });
  const marc = await prisma.user.create({
    data: {
      email: "profesionalnoreceta@ortosend.com",
      passwordHash: hash,
      role: "PROFESIONAL",
      name: "Marc Vidal (técnico)",
      clinicId: c1.id,
      activatedAt: new Date(),
      professional: {
        create: { dni: "22222222B", degree: "Fisioterapia", canPrescribe: false, training: { create: mkTraining() } },
      },
    },
  });
  // Marc Vidal: tardes de martes y jueves; una semana de vacaciones dentro de un mes
  await prisma.availabilityRule.createMany({
    data: franjas(marc.id, [2, 4], [[16 * 60, 20 * 60]]).map((r) => ({ ...r, clinicId: c1.id })),
  });
  const vac = nextMondayMadrid();
  const vacStart = new Date(Date.UTC(vac.y, vac.m - 1, vac.d + 28));
  const vacEnd = new Date(Date.UTC(vac.y, vac.m - 1, vac.d + 32));
  await prisma.availabilityException.create({
    data: { clinicId: c1.id, professionalId: marc.id, kind: "CIERRE", startsOn: vacStart, endsOn: vacEnd, note: "Vacaciones" },
  });
  await prisma.user.create({
    data: {
      email: "tecnico.cassa@ortosend.com",
      passwordHash: hash,
      role: "PROFESIONAL",
      name: "Núria Pons (técnica)",
      clinicId: c2.id,
      activatedAt: new Date(),
      professional: {
        create: { dni: "33333333C", degree: "Enfermería", canPrescribe: false, training: { create: mkTraining() } },
      },
    },
  });
  await prisma.user.create({
    data: {
      email: "recetador@ortosend.com",
      passwordHash: hash,
      role: "RECETADOR",
      name: "Dr. Toni Bosch (podólogo)",
      activatedAt: new Date(),
      professional: {
        create: {
          dni: "44444444D",
          degree: "Podología",
          canPrescribe: true,
          collegiateNum: "COL-5678",
          college: "Col·legi de Podòlegs de Catalunya (Barcelona)",
          verifiedAt: new Date(),
          training: { create: mkTraining() },
        },
      },
    },
  });
  await prisma.user.create({
    data: {
      email: "taller@ortosend.com",
      passwordHash: hash,
      role: "TALLER",
      name: "Taller Ortosend",
      activatedAt: new Date(),
    },
  });

  // --- Caso demo 1: en cola central (clínica sin prescriptor) ---
  const pere = await prisma.user.create({
    data: {
      email: "pere@demo.com",
      phone: "600111222",
      passwordHash: hash,
      role: "CLIENTE",
      name: "Pere Vidal",
      activatedAt: new Date(),
    },
  });
  const perePat = await prisma.patient.create({
    data: { ownerId: pere.id, name: "Pere Vidal", birthDate: new Date("1980-04-12"), consents: consent("web") },
  });
  const caso1 = await prisma.case.create({
    data: { patientId: perePat.id, clinicId: c2.id, state: "EN_PRESCRIPCION", flow: "A" },
  });
  await prisma.capture.create({
    data: {
      caseId: caso1.id,
      questionnaire: {
        v: 2,
        motivo: "Dolor en talón derecho al levantarse",
        evolucion: "3-6 meses",
        lado: "Derecho",
        zonas: ["Talón"],
        tipoSintoma: "Mecánico (duele al cargar o al caminar)",
        dolor: "7",
        momentos: ["Al levantarse / primeros pasos", "Después de la actividad"],
        actividad: "Activo",
        deporte: "",
        horasPie: "Más de 8 h",
        profesion: "Camarero",
        peso: "84",
        altura: "178",
        tallaCalzado: "43",
        calzado: ["Calle / casual", "Seguridad / trabajo"],
        desgaste: "Borde interno (pronador)",
        plantillasPrevias: "No, nunca",
        antecedentes: ["Ninguno relevante"],
        antecedentesDetalle: "",
        medicacion: "",
        tratamientosPrevios: ["Antiinflamatorios / analgésicos", "Reposo deportivo"],
        observaciones: "Trabaja 8 h de pie; el dolor cede al caminar unos minutos.",
      },
      physicalExam: {
        v: 2,
        movilidadObs: "Gemelos acortados; mejora al calentar.",
        tobillo: "Limitada rodilla extendida (gastrocnemios)",
        lungeIzq: "8",
        lungeDcha: "6.5",
        subastragalina: "Normal",
        primerRadio: "Normal",
        hallux: "Normal",
        cadenaPosterior: "Acortamiento leve",
        fpiIzq: "6",
        fpiDcho: "8",
        tipoPie: "Plano flexible",
        // Núcleo: los 5 generales, que se hacen siempre
        jackIzq: "Positivo (se forma el arco)",
        jackDcho: "Positivo (se forma el arco)",
        navDropIzq: "9",
        navDropDcho: "12",
        resistSupIzq: "Moderada",
        resistSupDcho: "Alta",
        singleHeelIzq: "Normal (el talón invierte)",
        singleHeelDcho: "Sin inversión del talón",
        // Complementarios de las ramas «talón / fascia» y «arco medial / pie plano»
        testsSel: [
          "palpacion_calcaneo",
          "silfverskiold",
          "compresion_calcaneo",
          "too_many_toes",
          "nav_drift",
          "double_heel_rise",
        ],
        palpacionCalcaneo: "Dolor en tubérculo medial",
        compresionCalcaneo: "Negativo",
        tooManyToes: "Aumentado (3 o más dedos)",
        navDriftIzq: "8",
        navDriftDcho: "11",
        heelRise: "Alterado derecho",
        dismetria: "No",
        ladoCorto: "",
        lamina: "",
        alza: "No",
        marchaPatron: "Pronador",
        contactoInicial: "Talón (normal)",
        anguloPaso: "Aumentado (marcha en abducción)",
        retropieApoyo: "Valgo",
        despegue: "Despegue precoz de talón",
        marchaObs: "Colapso del arco interno derecho en apoyo medio; más marcado con fatiga.",
      },
      completedAt: new Date(),
      media: {
        create: [SCAN_KIND, ...CAPTURA_VISUAL, ...BARO_KINDS].map((kind) => ({
          kind,
          url: `media/demo1/${kind}`,
          confirmedAt: new Date(),
        })),
      },
    },
  });
  for (const t of [
    "Cita reservada online (Flujo A)",
    "Estudio completado por la clínica",
    "Enviado a la cola central de prescripción",
  ])
    await prisma.caseEvent.create({ data: { caseId: caso1.id, text: t, actor: "sistema (seed)" } });

  // --- Caso demo 2: del cliente Jordi, ya en taller (fabricación/confección) ---
  const jordi = await prisma.user.create({
    data: {
      email: "jordi@demo.com",
      phone: "600333444",
      passwordHash: hash,
      role: "CLIENTE",
      name: "Jordi Ferrer",
      activatedAt: new Date(),
    },
  });
  const jordiPat = await prisma.patient.create({
    data: { ownerId: jordi.id, name: "Jordi Ferrer", birthDate: new Date("1975-09-02"), consents: consent("web") },
  });
  const caso2 = await prisma.case.create({
    data: {
      patientId: jordiPat.id,
      clinicId: c1.id,
      state: "FABRICACION",
      flow: "B",
      fabPhase: "CONFECCION",
      lot: "L-08",
      delivery: "DOMICILIO",
      designFileUrl: "disenos/demo2.stl",
    },
  });
  await prisma.capture.create({
    data: {
      caseId: caso2.id,
      questionnaire: {
        v: 2,
        motivo: "Metatarsalgia bilateral",
        evolucion: "6-12 meses",
        lado: "Ambos",
        zonas: ["Metatarsos / antepié"],
        tipoSintoma: "Mecánico (duele al cargar o al caminar)",
        dolor: "6",
        momentos: ["Durante la actividad", "Después de la actividad"],
        actividad: "Deportista habitual",
        deporte: "Running, 4 días/semana (~40 km)",
        horasPie: "2-4 h",
        profesion: "Oficina",
        peso: "72",
        altura: "180",
        tallaCalzado: "44",
        calzado: ["Deportivo"],
        desgaste: "Puntera",
        plantillasPrevias: "Sí, sin mejora",
        antecedentes: ["Ninguno relevante"],
        antecedentesDetalle: "",
        medicacion: "",
        tratamientosPrevios: ["Plantillas", "Fisioterapia"],
        observaciones: "Empeora con zapatillas de placa de carbono en tiradas largas.",
      },
      physicalExam: {
        v: 2,
        tobillo: "Normal",
        lungeIzq: "12",
        lungeDcha: "11",
        subastragalina: "Normal",
        primerRadio: "Plantarflexionado",
        hallux: "Normal",
        cadenaPosterior: "Normal",
        fpiIzq: "-3",
        fpiDcho: "-4",
        tipoPie: "Cavo",
        // Núcleo: los 5 generales, que se hacen siempre
        jackIzq: "Positivo (se forma el arco)",
        jackDcho: "Positivo (se forma el arco)",
        navDropIzq: "4",
        navDropDcho: "3",
        resistSupIzq: "Alta",
        resistSupDcho: "Alta",
        singleHeelIzq: "Normal (el talón invierte)",
        singleHeelDcho: "Normal (el talón invierte)",
        // Complementarios de las ramas «antepié / metatarsalgia» y «pie cavo / varo»
        testsSel: [
          "formula_metatarsal",
          "compresion_mtt",
          "mulder",
          "coleman",
          "balance_mono",
        ],
        formulaMetatarsal: "Index plus-minus",
        formulaDigital: "Egipcio",
        compresionMtt: "Positivo",
        mulder: "Negativo",
        coleman: "Retropié corrige (cavo flexible)",
        balanceIzq: "22",
        balanceDcho: "25",
        dismetria: "Sí",
        ladoCorto: "Izquierda",
        lamina: "7 mm",
        alza: "5",
        marchaPatron: "Supinador",
        contactoInicial: "Talón (normal)",
        anguloPaso: "Normal",
        retropieApoyo: "Varo",
        despegue: "Normal",
        marchaObs: "Sobrecarga en columna externa; hiperapoyo en cabezas metatarsales centrales al correr.",
      },
      completedAt: new Date(),
      media: {
        create: [SCAN_KIND, ...CAPTURA_VISUAL, ...BARO_KINDS].map((kind) => ({
          kind,
          url: `media/demo2/${kind}`,
          confirmedAt: new Date(),
        })),
      },
    },
  });
  await prisma.prescription.create({
    data: {
      caseId: caso2.id,
      prescriberId: draSerra.id,
      prescriberName: "Dra. Laia Serra (podóloga)",
      collegiateNum: "COL-1234",
      assessment: "Sobrecarga de cabezas metatarsales centrales en apoyo medio; marcha estable.",
      diagnosis: "Metatarsalgia mecánica bilateral",
      fabricationOrder: "Plantilla semirrígida con descarga retrocapital. Sin alza.",
      usageGuidelines: "Adaptación progresiva 2-3 semanas. Apto para correr desde la semana 3.",
      pdfUrl: "prescripciones/demo2.pdf",
    },
  });
  await prisma.payment.create({
    data: { caseId: caso2.id, paidAt: new Date(), method: "card", providerId: "pi_sim_demo2" },
  });
  for (const t of [
    "Estudio completado",
    "Prescrito por Dra. Serra",
    "Pago 199,99 € recibido (simulado)",
    "Aceptado por el taller. Etiquetas y hoja de trabajo impresas",
    "Diseño terminado (CAD archivado) — a mecanizado CNC",
    "Molde mecanizado (L-08) — pasa a confección a mano",
  ])
    await prisma.caseEvent.create({ data: { caseId: caso2.id, text: t, actor: "sistema (seed)" } });

  // --- Caso demo 3: cita reservada online para el próximo lunes a las 09:45 (agenda de la clínica Girona) ---
  const marta = await prisma.user.create({
    data: {
      email: "marta@demo.com",
      phone: "600555666",
      passwordHash: hash,
      role: "CLIENTE",
      name: "Marta Roca",
      activatedAt: new Date(),
    },
  });
  const martaPat = await prisma.patient.create({
    data: { ownerId: marta.id, name: "Marta Roca", birthDate: new Date("1990-02-20"), consents: consent("web") },
  });
  const lunes = nextMondayMadrid();
  const citaInicio = madrid(lunes.y, lunes.m, lunes.d, 9, 45);
  const caso3 = await prisma.case.create({
    data: { patientId: martaPat.id, clinicId: c1.id, state: "CITA_RESERVADA", flow: "A", appointmentAt: citaInicio },
  });
  await prisma.appointment.create({
    data: {
      clinicId: c1.id,
      caseId: caso3.id,
      professionalId: null,
      kind: "ESTUDIO",
      status: "RESERVADA",
      startsAt: citaInicio,
      endsAt: new Date(citaInicio.getTime() + 45 * 60000),
      source: "web",
      notes: "Motivo indicado al reservar: Dolor",
    },
  });
  await prisma.caseEvent.create({ data: { caseId: caso3.id, text: "Cita reservada online (Flujo A)", actor: "sistema (seed)" } });

  console.log("Seed completado. Cuentas (contraseña «" + PASS + "»):");
  console.log(
    "  admin@ortosend.com · clinica@ortosend.com · profesionalreceta@ortosend.com · profesionalnoreceta@ortosend.com · tecnico.cassa@ortosend.com · recetador@ortosend.com · taller@ortosend.com · jordi@demo.com · pere@demo.com · marta@demo.com"
  );
}

module.exports = { seedDemo, PASS };
