import type { MetadataRoute } from "next";
import { DOLENCIAS } from "@/lib/dolencias";

const BASE = "https://ortosend.es";

export default function sitemap(): MetadataRoute.Sitemap {
  const fijo = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({
    url: BASE + path,
    changeFrequency: "monthly",
    priority,
  });
  return [
    fijo("/", 1),
    fijo("/como-funciona", 0.8),
    fijo("/buscar", 0.9),
    fijo("/para-clinicas", 0.6),
    fijo("/dolencias", 0.7),
    ...DOLENCIAS.map((d) => fijo(`/dolencias/${d.slug}`, 0.7)),
    fijo("/legal/aviso-legal", 0.2),
    fijo("/legal/privacidad", 0.2),
    fijo("/legal/terminos", 0.2),
    fijo("/legal/cookies", 0.2),
  ];
}
