// Datos de demo compartidos: usados por `npx prisma db seed` y por /api/seed.
const bcrypt = require("bcryptjs");

const PASS = "ortosend123";

const VIDEO_KINDS = [
  "video_lat_dcha_descalzo",
  "video_lat_dcha_calzado",
  "video_lat_izq_descalzo",
  "video_lat_izq_calzado",
  "video_post_descalzo",
  "video_post_calzado",
  "video_heel_rise",
];
const BARO_KINDS = ["baro_est_1", "baro_est_2", "baro_din", "baro_informe"];

function inDays(d, h = 10, m = 0) {
  const t = new Date();
  t.setDate(t.getDate() + d);
  t.setHours(h, m, 0, 0);
  return t;
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
      slots: { create: [1, 2, 3, 4, 5].map((d) => ({ startsAt: inDays(d + 1, 9 + d) })) },
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
      slots: { create: [2, 3, 4].map((d) => ({ startsAt: inDays(d + 1, 10 + d, 30) })) },
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
      slots: { create: [1, 2].map((d) => ({ startsAt: inDays(d + 2, 11) })) },
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
  await prisma.user.create({
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
        tobillo: "Limitada rodilla extendida (gastrocnemios)",
        lungeIzq: "8",
        lungeDcha: "6.5",
        subastragalina: "Normal",
        primerRadio: "Normal",
        hallux: "Normal",
        cadenaPosterior: "Acortamiento leve",
        fpiIzq: "6",
        fpiDcho: "8",
        jackIzq: "Positivo (arco se restaura)",
        jackDcho: "Positivo (arco se restaura)",
        navDropIzq: "9",
        navDropDcho: "12",
        heelRise: "Normal bilateral",
        tipoPie: "Plano flexible",
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
        create: ["scan_L", "scan_R", ...VIDEO_KINDS, ...BARO_KINDS].map((kind) => ({
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
        jackIzq: "Positivo (arco se restaura)",
        jackDcho: "Positivo (arco se restaura)",
        navDropIzq: "4",
        navDropDcho: "3",
        heelRise: "Normal bilateral",
        tipoPie: "Cavo",
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
        create: ["scan_L", "scan_R", ...VIDEO_KINDS, ...BARO_KINDS].map((kind) => ({
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

  console.log("Seed completado. Cuentas (contraseña «" + PASS + "»):");
  console.log(
    "  admin@ortosend.com · clinica@ortosend.com · profesionalreceta@ortosend.com · profesionalnoreceta@ortosend.com · tecnico.cassa@ortosend.com · recetador@ortosend.com · taller@ortosend.com · jordi@demo.com · pere@demo.com"
  );
}

module.exports = { seedDemo, PASS };
