// Datos del titular para los textos legales. Un único sitio a rellenar cuando
// estén los datos definitivos de la sociedad — se propagan a todas las páginas.
export const EMPRESA = {
  nombreComercial: "Ortosend",
  razonSocial: "[RAZÓN SOCIAL PENDIENTE — p. ej. Ortosend, S.L.]",
  cif: "[CIF PENDIENTE]",
  domicilio: "[DOMICILIO SOCIAL PENDIENTE]",
  registro: "[DATOS DE INSCRIPCIÓN EN EL REGISTRO MERCANTIL PENDIENTES]",
  email: "hola@ortosend.com",
  web: "https://ortosend-five.vercel.app",
  // WhatsApp de la empresa (ManyChat), en formato internacional sin «+».
  whatsapp: process.env.WHATSAPP_EMPRESA || "34644954520",
};

// Versión vigente de los textos de consentimiento. Se guarda junto a cada
// consentimiento del paciente; súbela cuando cambie el texto legal.
// v3: menores gestionados por su tutor hasta los 16 años y traspaso de la
// cuenta al propio paciente al cumplirlos.
export const CONSENT_VERSION = "v3";

export const FECHA_TEXTOS = "septiembre de 2026";

// Enlace que abre WhatsApp con «ALTA» ya escrito hacia el número de la empresa.
export const enlaceAlta = () => `https://wa.me/${EMPRESA.whatsapp}?text=ALTA`;
