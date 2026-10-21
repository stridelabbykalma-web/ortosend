import type { NextConfig } from "next";

// Cabeceras de seguridad. CSP completa pendiente: Google Maps y MediaPipe
// cargan scripts y workers propios y una CSP estricta los rompería; se
// documenta como mejora futura.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // La cámara y el micro solo los usa la propia app (asistente de captura).
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
