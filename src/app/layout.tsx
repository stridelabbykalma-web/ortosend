import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { AudioPrimer } from "@/components/audio-primer";
import { CookieBanner } from "@/components/cookies";
import { SoloWeb } from "@/components/solo-web";

// Tipografía médica limpia (skill ui-ux-pro-max para healthcare): Figtree en
// toda la app — pesos altos para display, normales para cuerpo y UI. Las
// variables --font-display/--font-inter/--font-sora apuntan todas a ella.
const sans = Figtree({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "Ortosend — Plantillas a medida",
  description:
    "Estudio completo de la pisada en clínicas asociadas: escáner 3D, análisis de la marcha y baropodometría. Solo pagas si un profesional colegiado prescribe tu tratamiento.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sans.variable}`}>
      <body>
        <AudioPrimer />
        <SoloWeb>
          <Nav />
        </SoloWeb>
        {children}
        <SoloWeb>
          <CookieBanner />
          <div className="px-footer">
            <div className="wrap">
              <div className="px-fcols">
                <div>
                  <span className="logo">
                    orto<b>send</b>
                  </span>
                  <div style={{ marginTop: 10, maxWidth: 320 }}>
                    Plantillas ortopédicas a medida, con estudio completo de la pisada en clínicas
                    asociadas y prescripción de profesionales colegiados.
                  </div>
                </div>
                <nav>
                  <div className="t">Ortosend</div>
                  <a href="/como-funciona">Cómo funciona</a>
                  <a href="/buscar">Buscar clínica</a>
                  <a href="/para-clinicas">Para clínicas</a>
                </nav>
                <nav>
                  <div className="t">Legal</div>
                  <a href="/legal/aviso-legal">Aviso legal</a>
                  <a href="/legal/privacidad">Privacidad</a>
                  <a href="/legal/terminos">Términos</a>
                  <a href="/legal/cookies">Cookies</a>
                </nav>
              </div>
              <div className="px-fbase">
                <span>© 2026 Ortosend</span>
                <span>Producto sanitario a medida — Reglamento (UE) 2017/745</span>
              </div>
            </div>
          </div>
        </SoloWeb>
      </body>
    </html>
  );
}
