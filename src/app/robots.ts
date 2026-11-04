import type { MetadataRoute } from "next";

// Solo se indexa la web pública. Las zonas privadas además llevan su propia
// meta noindex; esto evita incluso el rastreo.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/panel",
        "/caso/",
        "/equipo",
        "/taller",
        "/api/",
        "/acceso",
        "/alta/",
        "/l/",
        "/consentimientos/",
        "/pago/",
        "/login",
        "/recuperar",
        "/restablecer",
        "/activar",
        "/verificar",
        "/mayoria",
        "/invitacion",
        "/reserva/",
      ],
    },
    sitemap: "https://ortosend.es/sitemap.xml",
  };
}
