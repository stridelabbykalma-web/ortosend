import type { Metadata } from "next";
import { Sora, Inter } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";

const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["400", "600", "700"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Ortosend — Plantillas a medida",
  description:
    "Estudio completo de la pisada en clínicas asociadas: escáner 3D, análisis de la marcha y baropodometría. Solo pagas si un profesional colegiado prescribe tu tratamiento.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sora.variable} ${inter.variable}`}>
      <body>
        <Nav />
        {children}
        <div className="footer">
          <div className="wrap row between">
            <span>© 2026 Ortosend</span>
            <span>
              <a href="/legal/privacidad">Privacidad</a> · <a href="/legal/terminos">Términos</a>
            </span>
          </div>
        </div>
      </body>
    </html>
  );
}
