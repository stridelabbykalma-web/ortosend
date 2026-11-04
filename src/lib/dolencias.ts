// Guías informativas por dolencia para la web pública (/dolencias/[slug]).
// Tono: informativo y honesto. Aquí NUNCA se diagnostica ni se prometen
// resultados (publicidad de productos sanitarios, RD 192/2023): se explica la
// dolencia, en qué puede ayudar una plantilla a medida y, con la misma
// claridad, en qué no. La valoración es siempre del profesional colegiado.

export type Dolencia = {
  slug: string;
  nombre: string; // nombre corto (menús, píldoras)
  titulo: string; // <title> de la página
  descripcion: string; // meta description
  queEs: string[];
  sintomas: string[];
  ayuda: string[]; // en qué puede ayudar una plantilla a medida
  noHace: string[]; // qué NO hace (honestidad)
  consulta: string[]; // señales para consultar a un médico/podólogo sin esperar
};

// Lámina de cada guía: radiografías reales del pie (CC0, colecciones
// abiertas; créditos en el pie de la web). pos = object-position del recorte,
// apuntando a la zona de la dolencia.
export const DOLENCIA_IMG: Record<string, { src: string; alt: string; pos?: string }> = {
  "fascitis-plantar": { src: "/img/rx-lateral.jpg", alt: "Radiografía lateral de un pie: el talón y el arco", pos: "72% 60%" },
  "espolon-calcaneo": { src: "/img/rx-lateral.jpg", alt: "Radiografía lateral de un pie: la zona del talón", pos: "88% 70%" },
  metatarsalgia: { src: "/img/rx-dorsoplantar.jpg", alt: "Radiografía dorsoplantar de un pie: los metatarsianos", pos: "50% 22%" },
  "pie-plano-infantil": { src: "/img/rx-oblicua.jpg", alt: "Radiografía oblicua de un pie: el arco interno", pos: "50% 55%" },
  "juanete-hallux-valgus": { src: "/img/rx-dorsoplantar.jpg", alt: "Radiografía dorsoplantar de un pie: el dedo gordo", pos: "18% 24%" },
};

export const DOLENCIAS: Dolencia[] = [
  {
    slug: "fascitis-plantar",
    nombre: "Fascitis plantar",
    titulo: "Plantillas para la fascitis plantar",
    descripcion:
      "Qué es la fascitis plantar, por qué duele el talón al dar los primeros pasos y en qué puede ayudar una plantilla a medida. Información sin diagnóstico: te valora un profesional colegiado.",
    queEs: [
      "La fascia plantar es una banda de tejido que recorre la planta del pie, del talón a los dedos, y sostiene el arco. Cuando trabaja por encima de lo que tolera —de golpe o durante meses— su inserción en el talón se irrita y duele. Es la causa más frecuente de dolor de talón en adultos.",
      "Suele aparecer tras un aumento de actividad (empezar a correr o caminar mucho más), por calzado con poca sujeción, por muchas horas de pie en suelos duros o por una pisada que sobrecarga la fascia.",
    ],
    sintomas: [
      "Dolor en el talón, sobre todo con los primeros pasos de la mañana o tras estar un rato sentado.",
      "Mejora al «calentar» andando y vuelve a empeorar al final del día.",
      "Dolor al presionar la parte interna del talón.",
    ],
    ayuda: [
      "Una plantilla a medida reparte la carga y sostiene el arco, de forma que la fascia trabaja menos en cada paso mientras se recupera.",
      "La baropodometría del estudio muestra dónde se concentra la presión en tu caso concreto, y la plantilla se fabrica con descargas en esos puntos exactos.",
      "Suele formar parte de un plan que incluye estiramientos de la fascia y de la musculatura de la pantorrilla; el profesional que te valore te indicará la pauta.",
    ],
    noHace: [
      "No quita el dolor de un día para otro: la fascitis mejora en semanas o meses, con constancia.",
      "No sustituye los estiramientos ni el resto del tratamiento que indique el profesional.",
      "Si tu caso no es compatible con el tratamiento con plantillas, el profesional no lo prescribirá y no pagarás nada.",
    ],
    consulta: [
      "Dolor que no cede en reposo o que te despierta por la noche.",
      "Talón hinchado, caliente o con fiebre.",
      "Dolor tras un golpe o caída (hay que descartar fractura).",
      "Hormigueo o pérdida de sensibilidad en el pie.",
    ],
  },
  {
    slug: "espolon-calcaneo",
    nombre: "Espolón calcáneo",
    titulo: "Plantillas para el espolón calcáneo",
    descripcion:
      "Qué es el espolón calcáneo, su relación con la fascitis plantar y en qué puede ayudar una plantilla a medida con descargas. Información sin diagnóstico: te valora un profesional colegiado.",
    queEs: [
      "El espolón es una pequeña calcificación en forma de pico en la zona donde la fascia plantar se une al hueso del talón. Se forma cuando esa inserción lleva mucho tiempo trabajando sobrecargada.",
      "Un detalle que sorprende: el dolor no suele venir del «pincho» en sí, sino de la fascia irritada de alrededor. Hay personas con espolón en la radiografía que no tienen ningún dolor, y dolores de talón intensos sin espolón.",
    ],
    sintomas: [
      "Dolor punzante bajo el talón, como una piedrecita clavada, sobre todo al empezar a andar.",
      "Molestia que empeora tras mucho rato de pie o caminando por suelo duro.",
      "Con frecuencia, los mismos síntomas que la fascitis plantar.",
    ],
    ayuda: [
      "Una plantilla a medida puede incluir una descarga selectiva justo bajo la zona dolorosa, de modo que el talón apoye alrededor del punto sensible y no sobre él.",
      "Al sostener el arco y repartir la presión, reduce la tracción de la fascia sobre su inserción, que es lo que mantiene la irritación.",
      "El estudio con baropodometría localiza el punto exacto de máxima presión de tu talón para fabricar la descarga donde toca.",
    ],
    noHace: [
      "No elimina el espolón: la calcificación no desaparece con plantillas. El objetivo es que deje de doler, y para eso no hace falta que desaparezca.",
      "No evita por sí sola que el dolor vuelva si se mantienen los hábitos que sobrecargan el talón (calzado plano y duro, picos bruscos de actividad).",
    ],
    consulta: [
      "Dolor en reposo o nocturno que no mejora.",
      "Talón hinchado, rojo o caliente.",
      "Dolor tras un traumatismo.",
      "Si tienes diabetes y notas cualquier herida o cambio en la piel del pie, consulta siempre antes con tu médico.",
    ],
  },
  {
    slug: "metatarsalgia",
    nombre: "Metatarsalgia",
    titulo: "Plantillas para la metatarsalgia",
    descripcion:
      "Dolor en la planta del antepié al caminar: qué es la metatarsalgia y cómo una plantilla a medida con apoyo retrocapital puede repartir la presión. Te valora un profesional colegiado.",
    queEs: [
      "La metatarsalgia es el dolor en la zona delantera de la planta, bajo las cabezas de los metatarsianos (los huesos que van a los dedos). Aparece cuando esa zona soporta más presión de la que le corresponde.",
      "Las causas habituales: calzado estrecho o de tacón, dedos en garra, un pie cavo que concentra el apoyo, la pérdida de la almohadilla grasa con la edad o deportes con mucha carrera y salto.",
    ],
    sintomas: [
      "Dolor o quemazón bajo la base de los dedos, que empeora al caminar, correr o estar de puntillas.",
      "Sensación de caminar sobre una piedra o de tener un calcetín arrugado.",
      "A veces, callosidades en la zona de máxima presión.",
    ],
    ayuda: [
      "La baropodometría del estudio mide exactamente qué cabezas metatarsales están sobrecargadas en tu pisada, en estática y caminando.",
      "La plantilla a medida puede incorporar un apoyo retrocapital (una pieza justo detrás de la zona dolorosa) que levanta y reparte la presión, además de amortiguación en el antepié.",
      "Al corregir el reparto de cargas de toda la pisada, descarga el antepié sin crear un problema nuevo en otra zona.",
    ],
    noHace: [
      "No corrige deformidades ya establecidas (dedos en garra, hallux valgus): alivia la sobrecarga que producen.",
      "Si el dolor viene de otra causa —por ejemplo un neuroma de Morton o una fractura por estrés—, el tratamiento puede ser distinto: por eso la valoración es siempre de un profesional colegiado.",
      "No compensa un calzado inadecuado: con tacón alto o puntera estrecha, ninguna plantilla funciona bien.",
    ],
    consulta: [
      "Dolor que apareció de forma brusca durante el deporte y no cede (descartar fractura por estrés).",
      "Hormigueo o calambre eléctrico hacia los dedos.",
      "Hinchazón o deformidad visible.",
      "Si tienes diabetes, cualquier dolor o herida en el antepié debe valorarla tu médico cuanto antes.",
    ],
  },
  {
    slug: "pie-plano-infantil",
    nombre: "Pie plano infantil",
    titulo: "Pie plano en niños: cuándo preocuparse",
    descripcion:
      "El pie plano flexible es normal en muchos niños pequeños. Cuándo conviene un estudio de la pisada, qué puede hacer una plantilla a medida y cada cuánto revisarla mientras el pie crece.",
    queEs: [
      "Casi todos los niños pequeños tienen el pie «plano»: el arco se desarrolla progresivamente hasta los 6-10 años. En la mayoría de los casos es un pie plano flexible, sin dolor, que no necesita ningún tratamiento.",
      "El estudio tiene sentido cuando hay señales de que ese pie está dando problemas: dolor, cansancio desproporcionado, torpeza o un desgaste del calzado muy asimétrico. La decisión de tratar —o de solo vigilar— es siempre del profesional que explora al niño.",
    ],
    sintomas: [
      "Dolor en pies, tobillos o piernas al caminar o hacer deporte, o cansancio antes que los demás niños.",
      "Tropiezos y caídas frecuentes para su edad.",
      "Desgaste muy marcado del borde interno del zapato.",
      "Un arco que tampoco aparece al ponerse de puntillas (pie plano rígido: esta sí es razón de consulta directa).",
    ],
    ayuda: [
      "Cuando el profesional lo indica, una plantilla a medida alinea el apoyo y reduce el dolor y la fatiga, acompañando el crecimiento del pie.",
      "El estudio completo (escáner 3D, marcha y presiones) deja medido el punto de partida, lo que permite comparar en las revisiones y ver la evolución real.",
      "En niños el pie cambia rápido: recomendamos revisar la plantilla aproximadamente cada 6 meses hasta los 14 años, y la revisión está incluida.",
    ],
    noHace: [
      "Un pie plano flexible que no duele, en general, no necesita plantillas: no las prescribimos «por si acaso».",
      "La plantilla no «fabrica» el arco: acompaña y alinea el apoyo mientras el pie se desarrolla, y trata los síntomas cuando los hay.",
      "No sustituye a la exploración del pediatra cuando hay señales de alarma neurológica u ortopédica.",
    ],
    consulta: [
      "Pie plano rígido (el arco no aparece ni de puntillas) o doloroso.",
      "Pie plano de un solo lado, o que aparece de nuevo tras años de arco normal.",
      "Dolor nocturno, cojera o rechazo a caminar.",
      "Cualquier duda sobre el desarrollo: el pediatra es siempre la primera parada.",
    ],
  },
  {
    slug: "juanete-hallux-valgus",
    nombre: "Juanete (hallux valgus)",
    titulo: "Plantillas y juanetes (hallux valgus)",
    descripcion:
      "Qué es el hallux valgus, qué puede aportar una plantilla a medida —y qué no: una plantilla no endereza el juanete—. Información honesta, con valoración de un profesional colegiado.",
    queEs: [
      "El juanete es la desviación progresiva del dedo gordo hacia los demás dedos, con el bulto característico en el lateral del pie. Tiene un componente hereditario y biomecánico (cómo pisas), y el calzado estrecho o de tacón lo empeora.",
      "Además del bulto, el problema funcional es que el dedo gordo deja de hacer bien su trabajo en el despegue del paso, y otras zonas del pie acaban sobrecargadas.",
    ],
    sintomas: [
      "Bulto en la base del dedo gordo que roza con el calzado, a veces enrojecido o inflamado.",
      "Dolor al caminar, sobre todo con zapato estrecho.",
      "Con el tiempo, dolor también bajo los otros metatarsianos (metatarsalgia de transferencia).",
    ],
    ayuda: [
      "Una plantilla a medida puede mejorar el apoyo y el reparto de cargas durante la marcha, aliviando el dolor y la sobrecarga que el juanete provoca en el resto del pie.",
      "Puede frenar los factores biomecánicos que aceleran la deformidad (por ejemplo, un apoyo excesivo del borde interno), siempre tras valorar tu pisada en el estudio.",
      "Combinada con calzado de horma ancha, suele permitir caminar con mucho menos dolor.",
    ],
    noHace: [
      "Una plantilla NO endereza el dedo ni elimina el bulto: ningún tratamiento conservador revierte un hallux valgus establecido.",
      "Si la deformidad es avanzada y muy dolorosa, la opción de cirugía debe valorarla un especialista; la plantilla puede ayudar antes y después, pero no la sustituye.",
      "No evita usar un calzado adecuado: con puntera estrecha, el juanete seguirá sufriendo.",
    ],
    consulta: [
      "Dolor que no cede o que limita tu día a día pese a calzado ancho.",
      "Inflamación importante, enrojecimiento o herida sobre el bulto.",
      "Pérdida de sensibilidad o cambios de color en el dedo.",
      "Si tienes diabetes, cualquier rozadura o herida en esa zona debe verla tu médico pronto.",
    ],
  },
];

export function dolencia(slug: string): Dolencia | undefined {
  return DOLENCIAS.find((d) => d.slug === slug);
}
