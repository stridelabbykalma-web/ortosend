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
  const c3 = await prisma.clinic.create({
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
  const drBosch = await prisma.user.create({
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


  // --- Casos de demo del taller: uno por fase, con plazos, lotes e incidencias ---
  // Para ver el tablero poblado: entrada, diseño, mecanizado (dos lotes y uno sin
  // lote), confección con «rehacer», calidad, en tránsito y entregados.
  const ago = (d, h = 10) => {
    const t = new Date();
    t.setDate(t.getDate() - d);
    t.setHours(h, 0, 0, 0);
    return t;
  };
  const RX = {
    serra: { id: draSerra.id, name: "Dra. Laia Serra (podóloga)", col: "COL-1234" },
    bosch: { id: drBosch.id, name: "Dr. Toni Bosch (podólogo)", col: "COL-5678" },
  };
  let seq = 10;
  async function casoTaller(o) {
    seq++;
    const owner = await prisma.user.create({
      data: {
        email: `${o.email}@demo.com`,
        phone: o.phone,
        passwordHash: hash,
        role: "CLIENTE",
        name: o.nombre,
        activatedAt: ago(o.pagado + 6),
      },
    });
    const pat = await prisma.patient.create({
      data: { ownerId: owner.id, name: o.nombre, birthDate: new Date(o.nac), consents: consent("web") },
    });
    const kase = await prisma.case.create({
      data: {
        patientId: pat.id,
        clinicId: o.clinica.id,
        state: o.estado,
        flow: o.flujo ?? "A",
        fabPhase: o.fase ?? null,
        lot: o.lote ?? null,
        material: o.material ?? null,
        delivery: o.entrega,
        designFileUrl: ["FABRICACION", "CALIDAD", "ENVIADO", "ENTREGADO"].includes(o.estado)
          ? `disenos/demo${seq}.stl`
          : null,
        qcPhotoUrl: o.fotoQc ? `calidad/demo${seq}.jpg` : null,
        rxRoute: o.clinica.id === c1.id ? "CLINICA" : "ORTOSEND",
        createdAt: ago(o.pagado + 5),
      },
    });
    await prisma.capture.create({
      data: {
        caseId: kase.id,
        questionnaire: { v: 2, done: true, ...o.q },
        physicalExam: { v: 2, done: true, ...o.e },
        completedAt: ago(o.pagado + 3),
        media: {
          create: [SCAN_KIND, ...CAPTURA_VISUAL, ...BARO_KINDS].map((kind) => ({
            kind,
            url: `media/demo${seq}/${kind}`,
            confirmedAt: ago(o.pagado + 3),
            meta: kind === SCAN_KIND ? { proyecto: `${o.nombre} ${o.phone}` } : undefined,
          })),
        },
      },
    });
    const rx = o.clinica.id === c1.id ? RX.serra : RX.bosch;
    await prisma.prescription.create({
      data: {
        caseId: kase.id,
        prescriberId: rx.id,
        prescriberName: rx.name,
        collegiateNum: rx.col,
        assessment: o.valoracion,
        diagnosis: o.dx,
        fabricationOrder: o.pauta,
        usageGuidelines: "Adaptación progresiva 2-3 semanas: 1 h el primer día y una hora más cada día.",
        pdfUrl: `prescripciones/demo${seq}.pdf`,
        signedAt: ago(o.pagado + 1),
      },
    });
    await prisma.payment.create({
      data: { caseId: kase.id, paidAt: ago(o.pagado), method: seq % 2 ? "card" : "bizum", providerId: `pi_sim_demo${seq}` },
    });
    if (o.envio)
      await prisma.shipment.create({
        data: {
          caseId: kase.id,
          toClinic: o.entrega === "CLINICA",
          carrier: o.envio.carrier,
          tracking: o.envio.tracking,
          shippedAt: ago(o.envio.hace),
          deliveredAt: o.envio.entregadoHace != null ? ago(o.envio.entregadoHace, 12) : null,
        },
      });
    for (const inc of o.incidencias ?? [])
      await prisma.incident.create({
        data: {
          caseId: kase.id,
          type: inc.tipo,
          reason: inc.motivo,
          openedBy: "Taller Ortosend",
          resolution: inc.resolucion ?? null,
          createdAt: ago(inc.hace, 11),
          closedAt: inc.cerradaHace != null ? ago(inc.cerradaHace, 16) : null,
        },
      });
    const eventos = [
      ["Estudio completado por la clínica", o.pagado + 3],
      [`Prescrito por ${rx.name.split(" (")[0]}`, o.pagado + 1],
      ["Pago 199,99 € recibido (simulado)", o.pagado],
      ...(o.eventos ?? []),
    ];
    for (const [text, hace] of eventos)
      await prisma.caseEvent.create({ data: { caseId: kase.id, text, actor: "sistema (seed)", at: ago(hace, 12) } });
    return kase;
  }

  // Cuestionario y exploración mínimos para la ficha de fabricación del taller.
  const Q = (x) => ({
    motivo: x.motivo,
    evolucion: "3-6 meses",
    lado: x.lado,
    zonas: x.zonas,
    tipoSintoma: "Mecánico (duele al cargar o al caminar)",
    dolor: x.dolor ?? "6",
    momentos: ["Durante la actividad"],
    actividad: x.actividad,
    deporte: x.deporte ?? "",
    horasPie: x.horasPie,
    profesion: x.profesion ?? "",
    peso: x.peso,
    altura: x.altura,
    tallaCalzado: x.talla,
    calzado: x.calzado,
    desgaste: x.desgaste,
    plantillasPrevias: x.previas ?? "No, nunca",
    antecedentes: ["Ninguno relevante"],
    tratamientosPrevios: [],
  });
  const E = (x) => ({
    fpiIzq: x.fpi[0],
    fpiDcho: x.fpi[1],
    tipoPie: x.pie,
    dismetria: x.alza ? "Sí" : "No",
    ladoCorto: x.alza ? x.ladoCorto : "",
    lamina: x.alza ? `${Number(x.alza) + 2} mm` : "",
    alza: x.alza ?? "No",
    marchaPatron: x.marcha,
    retropieApoyo: x.retropie,
  });

  // 1 · Entrada: acaba de pagar, en cola de aceptación técnica
  await casoTaller({
    email: "marta", nombre: "Marta Puig", phone: "600555101", nac: "1988-02-14", clinica: c1,
    estado: "ENTRADA_TALLER", entrega: "DOMICILIO", pagado: 1,
    q: Q({ motivo: "Dolor en el talón al levantarse", lado: "Izquierdo", zonas: ["Talón"], dolor: "7", actividad: "Activo", horasPie: "4-8 h", profesion: "Enfermera", peso: "63", altura: "165", talla: "38", calzado: ["Calle / casual", "Seguridad / trabajo"], desgaste: "Borde interno (pronador)" }),
    e: E({ fpi: ["7", "5"], pie: "Plano flexible", marcha: "Pronador", retropie: "Valgo" }),
    valoracion: "Colapso del arco interno izquierdo en apoyo medio con dolor en inserción de la fascia.",
    dx: "Fascitis plantar izquierda con pie plano flexible",
    pauta: "Plantilla de EVA 45 con soporte de arco medial alto, descarga en herradura del talón izquierdo y cuña supinadora de retropié 3º bilateral. Sin alza.",
  });

  // 2 · Diseño: aceptado ayer, pendiente de CAD
  await casoTaller({
    email: "joan", nombre: "Joan Roca", phone: "600555102", nac: "1962-11-03", clinica: c2,
    estado: "DISENO", entrega: "CLINICA", pagado: 2, flujo: "B",
    q: Q({ motivo: "Dolor bajo los metatarsos al caminar", lado: "Ambos", zonas: ["Metatarsos / antepié"], actividad: "Sedentario", horasPie: "2-4 h", profesion: "Jubilado", peso: "88", altura: "174", talla: "43", calzado: ["Calle / casual"], desgaste: "Puntera", previas: "Sí, sin mejora" }),
    e: E({ fpi: ["3", "4"], pie: "Normal", marcha: "Normal", retropie: "Neutro" }),
    valoracion: "Hiperapoyo en cabezas metatarsales centrales; almohadilla plantar adelgazada.",
    dx: "Metatarsalgia mecánica bilateral",
    pauta: "Plantilla semirrígida con almohadilla retrocapital bilateral (barra metatarsal 6 mm) y forro de poron en antepié. Sin alza.",
    eventos: [["Aceptado por el taller. Etiquetas de molde (I/D) y hoja de trabajo impresas", 1]],
  });

  // 3-4 · Mecanizado, lote L-09 (dos moldes listos para la tanda)
  await casoTaller({
    email: "nuria", nombre: "Núria Soler", phone: "600555103", nac: "1995-06-21", clinica: c1,
    estado: "FABRICACION", fase: "MECANIZADO", lote: "L-09", entrega: "DOMICILIO", pagado: 3,
    q: Q({ motivo: "Dolor en la cara interna de la rodilla al correr", lado: "Derecho", zonas: ["Rodilla"], actividad: "Deportista habitual", deporte: "Running, 3 días/semana (~25 km)", horasPie: "2-4 h", profesion: "Diseñadora", peso: "58", altura: "168", talla: "39", calzado: ["Deportivo"], desgaste: "Borde interno (pronador)" }),
    e: E({ fpi: ["6", "8"], pie: "Plano flexible", marcha: "Pronador", retropie: "Valgo" }),
    valoracion: "Pronación excesiva derecha con caída pélvica contralateral en apoyo monopodal.",
    dx: "Síndrome de estrés medial de tibia con hiperpronación",
    pauta: "Plantilla deportiva de EVA 55 con control de retropié (cuña supinadora 4º dcha., 2º izq.), soporte de arco medio y antepié fino para zapatilla de running.",
    eventos: [["Aceptado por el taller", 2], ["Diseño terminado (CAD archivado) — a mecanizado CNC · lote L-09", 1]],
  });
  await casoTaller({
    email: "marc", nombre: "Marc Bosch", phone: "600555104", nac: "1979-09-30", clinica: c3,
    estado: "FABRICACION", fase: "MECANIZADO", lote: "L-09", entrega: "CLINICA", pagado: 4,
    q: Q({ motivo: "Cansancio y dolor en el arco tras la jornada", lado: "Ambos", zonas: ["Arco interno"], actividad: "Activo", horasPie: "Más de 8 h", profesion: "Mozo de almacén", peso: "92", altura: "181", talla: "44", calzado: ["Seguridad / trabajo"], desgaste: "Borde interno (pronador)" }),
    e: E({ fpi: ["8", "8"], pie: "Plano flexible", marcha: "Pronador", retropie: "Valgo", alza: "6", ladoCorto: "Derecha" }),
    valoracion: "Pie plano flexible bilateral con dismetría de 6 mm (derecha más corta) confirmada con nivel pélvico.",
    dx: "Pie plano flexible bilateral sintomático con dismetría",
    pauta: "Plantilla de EVA 45 con soporte de arco medial y estabilizador de talón profundo; alza de 6 mm en la derecha integrada en el talón. Apta para calzado de seguridad.",
    eventos: [["Aceptado por el taller", 3], ["Diseño terminado (CAD archivado) — a mecanizado CNC · lote L-09", 2]],
  });

  // 5 · Mecanizado sin lote asignado
  await casoTaller({
    email: "anna", nombre: "Anna Ferrer", phone: "600555105", nac: "2011-03-08", clinica: c2,
    estado: "FABRICACION", fase: "MECANIZADO", entrega: "CLINICA", pagado: 2, flujo: "B",
    q: Q({ motivo: "Dolor en el talón al hacer deporte (niña de 14 años)", lado: "Ambos", zonas: ["Talón"], actividad: "Deportista habitual", deporte: "Fútbol, 3 días/semana", horasPie: "2-4 h", profesion: "Estudiante", peso: "48", altura: "158", talla: "37", calzado: ["Deportivo"], desgaste: "Talón" }),
    e: E({ fpi: ["5", "6"], pie: "Plano flexible", marcha: "Pronador", retropie: "Valgo" }),
    valoracion: "Dolor a la compresión del calcáneo bilateral, cadena posterior acortada.",
    dx: "Apofisitis del calcáneo (Sever) bilateral",
    pauta: "Plantilla blanda de EVA 35 con talonera de descarga de 5 mm (poron) y soporte de arco suave. Prever reposición por crecimiento en 6-8 meses.",
    eventos: [["Aceptado por el taller", 1], ["Diseño terminado (CAD archivado) — a mecanizado CNC", 0]],
  });

  // 6 · Confección con «rehacer»: no pasó calidad, fuera de plazo
  await casoTaller({
    email: "oriol", nombre: "Oriol Mas", phone: "600555106", nac: "1970-12-19", clinica: c1,
    estado: "FABRICACION", fase: "CONFECCION", lote: "L-08", material: "EVA-45 lote M-2210", entrega: "DOMICILIO", pagado: 9,
    q: Q({ motivo: "Dolor en el dedo gordo y juanete", lado: "Derecho", zonas: ["Dedos / hallux"], actividad: "Activo", horasPie: "4-8 h", profesion: "Comercial", peso: "79", altura: "176", talla: "42", calzado: ["Calle / casual", "Vestir"], desgaste: "Borde interno (pronador)", previas: "Sí, con mejora" }),
    e: E({ fpi: ["4", "7"], pie: "Plano flexible", marcha: "Pronador", retropie: "Valgo" }),
    valoracion: "Hallux limitus funcional derecho con primer radio hipermóvil.",
    dx: "Hallux valgus derecho con hallux limitus funcional",
    pauta: "Plantilla semirrígida con extensión de Morton bajo el primer radio derecho, soporte de arco medial y cuña supinadora 3º. Perfil bajo para calzado de vestir.",
    incidencias: [{ tipo: "REHACER_DEFECTO", motivo: "Extensión de Morton 4 mm más corta que el CAD; no cubre la cabeza del primer metatarsiano", hace: 1 }],
    eventos: [["Aceptado por el taller", 8], ["Diseño terminado (CAD archivado) — a mecanizado CNC · lote L-08", 6], ["Molde mecanizado (L-08) — pasa a confección a mano", 4], ["Confección terminada (material EVA-45 lote M-2210) — a control de calidad", 2], ["No pasa calidad: extensión de Morton 4 mm más corta que el CAD — rehacer con prioridad", 1]],
  });

  // 7 · Control de calidad, con la foto del par ya adjunta
  await casoTaller({
    email: "laura", nombre: "Laura Camps", phone: "600555107", nac: "1984-05-27", clinica: c3,
    estado: "CALIDAD", lote: "L-07", material: "EVA-55 lote M-2208", fotoQc: true, entrega: "CLINICA", pagado: 5,
    q: Q({ motivo: "Dolor en el tendón de Aquiles al empezar a correr", lado: "Izquierdo", zonas: ["Tendón de Aquiles"], actividad: "Deportista habitual", deporte: "Trail, 2 días/semana", horasPie: "2-4 h", profesion: "Profesora", peso: "61", altura: "170", talla: "40", calzado: ["Deportivo", "Calle / casual"], desgaste: "Talón" }),
    e: E({ fpi: ["-2", "-3"], pie: "Cavo", marcha: "Supinador", retropie: "Varo" }),
    valoracion: "Pie cavo con retropié varo; sobrecarga del Aquiles izquierdo en despegue.",
    dx: "Tendinopatía de Aquiles izquierda con pie cavo",
    pauta: "Plantilla de EVA 55 con talonera de 8 mm bilateral (10 mm izq.), cuña pronadora lateral de retropié 3º y relleno de arco externo.",
    eventos: [["Aceptado por el taller", 4], ["Diseño terminado (CAD archivado) — a mecanizado CNC · lote L-07", 3], ["Molde mecanizado (L-07) — pasa a confección a mano", 2], ["Confección terminada (material EVA-55 lote M-2208) — a control de calidad", 1], ["Foto del par adjuntada en control de calidad", 0]],
  });

  // 8 · En tránsito hacia la clínica
  await casoTaller({
    email: "xavier", nombre: "Xavier Vila", phone: "600555108", nac: "1958-08-09", clinica: c2,
    estado: "ENVIADO", lote: "L-07", material: "EVA-45 lote M-2208", fotoQc: true, entrega: "CLINICA", pagado: 5, flujo: "B",
    envio: { carrier: "Correos Express", tracking: "PQ4A2K19305ES", hace: 1 },
    q: Q({ motivo: "Dolor difuso en la planta y calambres", lado: "Ambos", zonas: ["Arco interno", "Metatarsos / antepié"], actividad: "Sedentario", horasPie: "Menos de 2 h", profesion: "Jubilado", peso: "95", altura: "172", talla: "43", calzado: ["Calle / casual"], desgaste: "Uniforme", previas: "Sí, con mejora" }),
    e: E({ fpi: ["6", "6"], pie: "Plano rígido", marcha: "Normal", retropie: "Valgo" }),
    valoracion: "Pie plano rígido bilateral; el paciente es diabético tipo 2 sin neuropatía. Prioridad al acomodo.",
    dx: "Pie plano rígido bilateral en paciente diabético",
    pauta: "Plantilla de acomodo total en EVA 35 + poron 3 mm en toda la superficie, sin correcciones agresivas, bordes redondeados. Comprobar ausencia de puntos de presión.",
    eventos: [["Aceptado por el taller", 4], ["Diseño terminado (CAD archivado) — a mecanizado CNC · lote L-07", 3], ["Molde mecanizado (L-07) — pasa a confección a mano", 2], ["Confección terminada — a control de calidad", 1], ["Calidad superada — enviado (seguimiento PQ4A2K19305ES)", 1]],
  });

  // 9-10 · Entregados (trazabilidad); uno con incidencia de rehacer ya cerrada
  await casoTaller({
    email: "carla", nombre: "Carla Serrat", phone: "600555109", nac: "1991-01-15", clinica: c1,
    estado: "ENTREGADO", lote: "L-06", material: "EVA-45 lote M-2205", fotoQc: true, entrega: "DOMICILIO", pagado: 9,
    envio: { carrier: "Sendcloud (simulado)", tracking: "TRK-DEMO-19-ES", hace: 4, entregadoHace: 2 },
    q: Q({ motivo: "Dolor en la planta tras estar mucho de pie", lado: "Ambos", zonas: ["Talón", "Arco interno"], actividad: "Activo", horasPie: "Más de 8 h", profesion: "Peluquera", peso: "66", altura: "163", talla: "38", calzado: ["Calle / casual"], desgaste: "Borde interno (pronador)" }),
    e: E({ fpi: ["6", "7"], pie: "Plano flexible", marcha: "Pronador", retropie: "Valgo" }),
    valoracion: "Sobrecarga de la fascia bilateral por bipedestación prolongada.",
    dx: "Fasciopatía plantar bilateral",
    pauta: "Plantilla de EVA 45 con soporte de arco medial y descarga de talón bilateral en poron.",
    eventos: [["Aceptado por el taller", 8], ["Diseño terminado (CAD archivado) — a mecanizado CNC · lote L-06", 7], ["Molde mecanizado (L-06) — pasa a confección a mano", 6], ["Confección terminada — a control de calidad", 5], ["Calidad superada — enviado (seguimiento TRK-DEMO-19-ES)", 4], ["Entrega confirmada. Inicia periodo de adaptación (seguimiento día 20)", 2]],
  });
  await casoTaller({
    email: "pau", nombre: "Pau Font", phone: "600555110", nac: "1976-07-02", clinica: c3,
    estado: "ENTREGADO", lote: "L-05", material: "EVA-55 lote M-2203", fotoQc: true, entrega: "CLINICA", pagado: 16,
    envio: { carrier: "Correos Express", tracking: "PQ7H0C55118ES", hace: 11, entregadoHace: 10 },
    incidencias: [{ tipo: "REHACER_DEFECTO", motivo: "Marcado I/D invertido en el par", hace: 13, cerradaHace: 12, resolucion: "Rehecho y calidad superada" }],
    q: Q({ motivo: "Dolor en la parte externa del tobillo, esguinces de repetición", lado: "Derecho", zonas: ["Tobillo"], actividad: "Deportista habitual", deporte: "Pádel, 2 días/semana", horasPie: "2-4 h", profesion: "Informático", peso: "83", altura: "179", talla: "43", calzado: ["Deportivo"], desgaste: "Borde externo (supinador)" }),
    e: E({ fpi: ["-4", "-5"], pie: "Cavo", marcha: "Supinador", retropie: "Varo" }),
    valoracion: "Pie cavo varo con inestabilidad lateral de tobillo derecho.",
    dx: "Inestabilidad crónica de tobillo derecho con pie cavo varo",
    pauta: "Plantilla de EVA 55 con cuña pronadora lateral de retropié 4º y de antepié 2º, talonera estabilizadora profunda.",
    eventos: [["Aceptado por el taller", 15], ["Diseño terminado — a mecanizado CNC · lote L-05", 14], ["Molde mecanizado (L-05) — pasa a confección a mano", 14], ["No pasa calidad: marcado I/D invertido — rehacer con prioridad", 13], ["Calidad superada — enviado (seguimiento PQ7H0C55118ES)", 11], ["Entrega confirmada", 10]],
  });

  // 11 · Devuelto a clínica por captura inválida (incidencia abierta que cierra el taller)
  const elena = await casoTaller({
    email: "elena", nombre: "Elena Mir", phone: "600555111", nac: "1999-10-11", clinica: c2,
    estado: "DEVUELTO_CLINICA", entrega: "CLINICA", pagado: 3, flujo: "B",
    incidencias: [{ tipo: "CAPTURA_INVALIDA", motivo: "El escaneo de las espumas solo tiene el pie derecho; falta el izquierdo", hace: 2 }],
    q: Q({ motivo: "Dolor en el empeine con calzado cerrado", lado: "Izquierdo", zonas: ["Empeine / dorso"], actividad: "Activo", horasPie: "4-8 h", profesion: "Dependienta", peso: "55", altura: "160", talla: "37", calzado: ["Calle / casual", "Vestir"], desgaste: "Uniforme" }),
    e: E({ fpi: ["-1", "-2"], pie: "Cavo", marcha: "Normal", retropie: "Neutro" }),
    valoracion: "Pie cavo con dorso prominente; conflicto con el calzado.",
    dx: "Pie cavo sintomático izquierdo",
    pauta: "Plantilla de perfil muy bajo en EVA 45 con relleno de arco y talonera de 4 mm, para calzado de vestir.",
    eventos: [["Incidencia de captura — devuelto a clínica sin coste para el cliente", 2]],
  });
  await prisma.capture.update({ where: { caseId: elena.id }, data: { completedAt: null } });

  console.log("Seed completado. Cuentas (contraseña «" + PASS + "»):");
  console.log(
    "  admin@ortosend.com · clinica@ortosend.com · profesionalreceta@ortosend.com · profesionalnoreceta@ortosend.com · tecnico.cassa@ortosend.com · recetador@ortosend.com · taller@ortosend.com · jordi@demo.com · pere@demo.com"
  );
}

module.exports = { seedDemo, PASS };
