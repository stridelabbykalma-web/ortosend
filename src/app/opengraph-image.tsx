import { ImageResponse } from "next/og";
import { PRICE_LABEL } from "@/lib/format";

// Tarjeta que aparece al compartir ortosend.es (WhatsApp, redes…).
export const alt = "Ortosend — Plantillas a medida, sin sorpresas";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #ecfeff 0%, #ffffff 55%, #d5f3fa 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              background: "#0e7490",
              display: "flex",
            }}
          />
          <div style={{ display: "flex", fontSize: 52, color: "#164e63", letterSpacing: -1 }}>
            <span>orto</span>
            <span style={{ fontWeight: 800 }}>send</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontSize: 84,
              fontWeight: 800,
              color: "#164e63",
              lineHeight: 1.05,
              letterSpacing: -2,
            }}
          >
            Plantillas a medida, sin sorpresas
          </div>
          <div style={{ fontSize: 34, color: "#3f5b63" }}>
            Estudio completo de la pisada en una clínica cerca de ti
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              background: "#0e7490",
              color: "#ffffff",
              borderRadius: 999,
              padding: "16px 34px",
              fontSize: 32,
              fontWeight: 700,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {PRICE_LABEL} · todo incluido
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#3f5b63", marginLeft: 28 }}>
            Solo pagas si un profesional colegiado lo prescribe
          </div>
        </div>
      </div>
    ),
    size
  );
}
