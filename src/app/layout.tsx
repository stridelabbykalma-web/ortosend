import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { CookieBanner } from "@/components/cookies";
import { SoloWeb } from "@/components/solo-web";

// Tipografía médica limpia (skill ui-ux-pro-max para healthcare): Figtree en
// toda la app — pesos altos para display, normales para cuerpo y UI. Las
// variables --font-display/--font-inter/--font-sora apuntan todas a ella.
const sans = Figtree({ variable: "--font-inter", subsets: ["latin"], weight: ["300", "400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://ortosend.es"),
  title: {
    default: "Ortosend — Plantillas a medida por 199,99 €",
    template: "%s — Ortosend",
  },
  description:
    "Plantillas ortopédicas a medida baratas de verdad: 199,99 € todo incluido, con estudio biomecánico completo (escáner 3D, análisis de la marcha y baropodometría) en clínicas asociadas. Solo pagas si un profesional colegiado prescribe tu tratamiento.",
  keywords: [
    "plantillas ortopédicas baratas",
    "plantillas a medida precio",
    "ortopedia barata",
    "plantillas a medida baratas",
    "estudio de la pisada",
    "estudio biomecánico de la marcha",
  ],
  openGraph: {
    type: "website",
    locale: "es_ES",
    siteName: "Ortosend",
    title: "Ortosend — Plantillas a medida por 199,99 €",
    description:
      "Plantillas ortopédicas a medida por 199,99 € todo incluido, con estudio biomecánico completo en una clínica cerca de ti. Solo pagas si un colegiado lo prescribe.",
    url: "/",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sans.variable}`}>
      <body>
        <SoloWeb>
          <Nav />
        </SoloWeb>
        {children}
        <SoloWeb>
          <CookieBanner />
          <footer className="ox-footer">
            <figure className="ox-footer-foto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/rx-lateral.jpg"
                alt="Radiografía lateral de un pie"
                className="ox-img"
                width={1920}
                height={962}
                loading="lazy"
              />
            </figure>
            <div className="ox-footer-menu">
              <span className="logo">
                orto<b>send</b>
              </span>
              <nav className="ox-footer-links" aria-label="Secciones">
                <a href="/como-funciona">Cómo funciona</a>
                <a href="/buscar">Buscar clínica</a>
                <a href="/dolencias">Guías de dolencias</a>
                <a href="/para-clinicas">Para clínicas</a>
                <a href="/login">Mi panel</a>
              </nav>
              <div className="ox-footer-dual">
                <div>
                  <b style={{ color: "#fff" }}>Escríbenos</b>
                  <div style={{ marginTop: 6 }}>
                    <a href="mailto:hola@ortosend.es">hola@ortosend.es</a>
                  </div>
                </div>
                <div>
                  <b style={{ color: "#fff" }}>Producto sanitario a medida</b>
                  <div style={{ marginTop: 6 }}>Reglamento (UE) 2017/745</div>
                </div>
              </div>
              <div className="ox-footer-legal">
                © 2026 Ortosend · <a href="/legal/aviso-legal">Aviso legal</a> ·{" "}
                <a href="/legal/privacidad">Privacidad</a> · <a href="/legal/terminos">Términos</a> ·{" "}
                <a href="/legal/cookies">Cookies</a>
                <p className="ox-credits">
                  Imágenes: radiografías del pie de{" "}
                  <a href="https://commons.wikimedia.org/w/index.php?curid=61347913">Mikael Häggström, M.D.</a>{" "}
                  (CC0, Wikimedia Commons) ·{" "}
                  <a href="https://commons.wikimedia.org/w/index.php?curid=67570958">fresadora CNC</a> por Creative
                  Tools (CC BY 2.0) ·{" "}
                  <a href="https://commons.wikimedia.org/w/index.php?curid=99037953">captura de movimiento</a> por
                  Raíssa Ruschel (CC BY 2.0). Muestran la tecnología del estudio y del taller, no nuestras clínicas.
                  El mapa de presiones es un gráfico ilustrativo propio.
                </p>
              </div>
            </div>
          </footer>
        </SoloWeb>
      </body>
    </html>
  );
}
