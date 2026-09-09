"use client";

// Foto del par en control de calidad: se hace con el móvil o se elige del PC,
// se reduce en el navegador (máx. 1600 px, JPEG) y se sube a /api/media/calidad.
// El check verde solo aparece cuando el servidor confirma la subida.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

async function reducir(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ko(new Error("No se puede leer la imagen"));
      i.src = url;
    });
    const max = 1600;
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.86));
    return blob ?? file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function FotoCalidad({ caseId, actual }: { caseId: string; actual: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<"idle" | "subiendo" | "error">("idle");
  const [error, setError] = useState("");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setEstado("subiendo");
    setError("");
    try {
      const blob = await reducir(file);
      const fd = new FormData();
      fd.append("caseId", caseId);
      fd.append("file", new File([blob], "par.jpg", { type: blob.type || "image/jpeg" }));
      const r = await fetch("/api/media/calidad", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Error al subir la foto");
      setEstado("idle");
      router.refresh();
    } catch (e) {
      setEstado("error");
      setError(e instanceof Error ? e.message : "Error al subir la foto");
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="qc-foto">
      {actual && actual.startsWith("/api/media/") && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={actual} alt="Foto del par terminado" />
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <div className="row">
        <button type="button" className={actual ? "" : "pri"} disabled={estado === "subiendo"} onClick={() => input.current?.click()}>
          {estado === "subiendo" ? "Subiendo…" : actual ? "Repetir foto" : "Hacer foto del par"}
        </button>
        {estado === "error" && <span className="tiny" style={{ color: "var(--red)" }}>{error}</span>}
      </div>
    </div>
  );
}
