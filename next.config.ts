import type { NextConfig } from "next";

// Cabeceras de seguridad. La CSP va de momento en modo «solo informe»: el navegador avisa
// (consola) de lo que bloquearía sin bloquear nada. Cuando se haya comprobado que Google Maps,
// MediaPipe, Turnstile y Stripe funcionan sin avisos, se pasa a «Content-Security-Policy».
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://maps.googleapis.com https://cdn.jsdelivr.net https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com",
  "media-src 'self' blob:",
  "connect-src 'self' https://*.googleapis.com https://cdn.jsdelivr.net https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com https://checkout.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  "object-src 'none'",
].join("; ");

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
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Content-Security-Policy-Report-Only", value: CSP },
        ],
      },
    ];
  },
};

export default nextConfig;
