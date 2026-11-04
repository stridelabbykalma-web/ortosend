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
  title: { default: "Ortosend — Plantillas a medida", template: "%s — Ortosend" },
  description:
    "Estudio completo de la pisada en clínicas asociadas: escáner 3D, análisis de la marcha y baropodometría. Solo pagas si un profesional colegiado prescribe tu tratamiento.",
  openGraph: {
    type: "website",
    locale: "es_ES",
    siteName: "Ortosend",
    title: "Ortosend — Plantillas a medida",
    description:
      "Estudio completo de la pisada en clínicas asociadas. Solo pagas si un profesional colegiado prescribe tu tratamiento.",
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
                src="/img/huellas-arena.jpg"
                alt="Huellas de pasos en la arena de una playa"
                className="ox-img"
                width={1024}
                height={576}
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
                  Imágenes: <a href="https://commons.wikimedia.org/w/index.php?curid=140094963">«Venus de Milo foot»</a>{" "}
                  por Caeciliusinhorto (CC BY-SA 4.0) ·{" "}
                  <a href="https://collections.museumsvictoria.com.au/items/1333096">«Shoe Last, Wooden»</a> Museums
                  Victoria (CC BY 4.0) ·{" "}
                  <a href="https://commons.wikimedia.org/w/index.php?curid=36665653">«A man walking», Muybridge 1887</a>{" "}
                  Wellcome (CC BY 4.0) ·{" "}
                  <a href="https://www.rawpixel.com/image/10081532/shoe-last-1938-michael-fallon">«Shoe Last», M. Fallon 1938</a>{" "}
                  (CC0) · <a href="https://www.rawpixel.com/image/13967934/image-paper-person-skeleton">lámina anatómica</a>{" "}
                  (CC0) · <a href="https://www.rawpixel.com/image/3298401/free-photo-image-beach-png-png-filtering">huellas en la arena</a>{" "}
                  (CC0) · <a href="https://www.rawpixel.com/image/5968947/walking-feet">«Walking Feet»</a> (CC0). Muestran
                  el mundo del pie y del oficio, no nuestras clínicas ni nuestro producto.
                </p>
              </div>
            </div>
          </footer>
        </SoloWeb>
      </body>
    </html>
  );
}
