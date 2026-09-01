"use client";

// Captura guiada con cámara: previsualización en vivo con la silueta de encuadre
// superpuesta (cómo debe colocarse el paciente) y checklist bloqueante — hasta que
// todo el encuadre está confirmado no se habilita el botón de captura.
import { useEffect, useRef, useState } from "react";
import { markMediaAction } from "@/app/panel/clinica-actions";

export type OverlayKind = "marcha_post" | "marcha_ant" | "marcha_lat" | "marcha_general";

// Silueta de encuadre que se dibuja sobre la imagen de la cámara.
function Overlay({ kind }: { kind: OverlayKind }) {
  const guide = "rgba(255,255,255,0.9)";
  const zone = "rgba(45,212,191,0.85)"; // teal
  const common = { fill: "none", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  // Figura humana de perfil, a mitad de zancada (marcha lateral)
  const figuraLateral = (
    <>
      <circle cx={150} cy={70} r={22} />
      <path d="M150 92 L146 200" />
      <path d="M146 130 L110 175 M146 130 L185 168" />
      <path d="M146 200 L105 280 L92 345 M146 200 L185 270 L210 340" />
      <path d="M92 345 L70 352 M210 340 L235 345" />
    </>
  );

  const lateral = (
    <g stroke={zone} {...common}>
      {figuraLateral}
    </g>
  );

  // Figura humana de espaldas (marcha posterior)
  const posterior = (
    <g stroke={zone} {...common}>
      <circle cx={150} cy={65} r={22} />
      <path d="M150 87 L150 190" />
      <path d="M108 120 L150 100 L192 120 M108 120 L100 185 M192 120 L200 185" />
      <path d="M150 190 L128 275 L126 345 M150 190 L172 275 L174 345" />
      <path d="M114 350 L138 350 M162 350 L186 350" />
      <path d="M150 20 L150 45 M150 375 L150 395" stroke={guide} strokeDasharray="6 7" strokeWidth={2} />
      <text x={150} y={388} textAnchor="middle" fill={guide} fontSize={12} stroke="none">
        el paciente se aleja de la cámara
      </text>
    </g>
  );

  // Figura de frente, caminando hacia la cámara (marcha anterior)
  const anterior = (
    <g stroke={zone} {...common}>
      <circle cx={150} cy={65} r={22} />
      <path d="M142 62 L143 62 M157 62 L158 62" strokeWidth={4} />
      <path d="M144 74 Q150 78 156 74" strokeWidth={2} />
      <path d="M150 87 L150 190" />
      <path d="M108 120 L150 100 L192 120 M108 120 L100 185 M192 120 L200 185" />
      <path d="M150 190 L130 270 L128 340 M150 190 L172 262 L176 330" />
      <path d="M120 346 L136 346 M168 336 L184 336" />
      <path d="M150 20 L150 42" stroke={guide} strokeDasharray="6 7" strokeWidth={2} />
      <text x={150} y={388} textAnchor="middle" fill={guide} fontSize={12} stroke="none">
        el paciente camina hacia la cámara
      </text>
    </g>
  );

  // Plano general: cámara alejada, cuerpo entero pequeño con aire alrededor
  const general = (
    <g stroke={zone} {...common}>
      <rect x={22} y={28} width={256} height={336} rx={10} stroke={guide} strokeDasharray="10 8" strokeWidth={2} />
      <g transform="translate(58 118) scale(0.6)">{figuraLateral}</g>
      <path d="M45 340 L255 340" stroke={guide} strokeWidth={2} strokeDasharray="2 6" />
      <path d="M70 355 L230 355 M230 355 L216 347 M230 355 L216 363" stroke={guide} strokeWidth={2} />
      <text x={150} y={388} textAnchor="middle" fill={guide} fontSize={12} stroke="none">
        plano general: cuerpo entero con aire alrededor
      </text>
    </g>
  );

  const walkArrow = (
    <g stroke={guide} strokeWidth={2} fill="none">
      <path d="M60 372 L240 372 M240 372 L224 362 M240 372 L224 382" />
      <path d="M30 352 L270 352" strokeDasharray="2 6" strokeWidth={1.5} />
    </g>
  );

  return (
    <svg className="cam-overlay" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet" aria-hidden>
      {kind === "marcha_lat" && (
        <>
          {lateral}
          {walkArrow}
        </>
      )}
      {kind === "marcha_post" && posterior}
      {kind === "marcha_ant" && anterior}
      {kind === "marcha_general" && general}
    </svg>
  );
}

export function CamaraGuiada({
  caseId,
  kind,
  overlay,
  mode,
  checks,
  next,
}: {
  caseId: string;
  kind: string; // kind de MediaAsset (video_posterior, scan_L…)
  overlay: OverlayKind;
  mode: "foto" | "video";
  checks: string[];
  next: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [cam, setCam] = useState<"pidiendo" | "activa" | "no">("pidiendo");
  const [checked, setChecked] = useState<boolean[]>(() => checks.map(() => false));
  const [capturando, setCapturando] = useState(false);
  const allOk = checked.every(Boolean);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCam("activa");
      } catch {
        if (!cancelled) setCam("no");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capturar = () => {
    if (!allOk || capturando) return;
    setCapturando(true);
    // Simulación de grabación/subida; en producción: MediaRecorder + subida por
    // fragmentos a R2/S3 y el check verde solo con confirmación del servidor.
    setTimeout(() => formRef.current?.requestSubmit(), mode === "video" ? 1600 : 700);
  };

  return (
    <div>
      <div className="cam-box">
        {cam !== "no" ? (
          <video ref={videoRef} className="cam-video" autoPlay playsInline muted />
        ) : (
          <div className="cam-off">
            Cámara no disponible en este dispositivo.
            <br />
            La silueta indica igualmente cómo colocar al paciente.
          </div>
        )}
        <Overlay kind={overlay} />
        {capturando && (
          <div className="cam-rec">{mode === "video" ? "● Grabando…" : "Capturando…"}</div>
        )}
      </div>

      <div className="sp" />
      <b style={{ fontSize: 14 }}>Comprueba el encuadre</b>
      {checks.map((c, i) => (
        <label className="chk" key={c}>
          <input
            type="checkbox"
            checked={checked[i]}
            onChange={(ev) =>
              setChecked((prev) => prev.map((v, j) => (j === i ? ev.target.checked : v)))
            }
          />{" "}
          {c}
        </label>
      ))}

      <div className="sp" />
      <form ref={formRef} action={markMediaAction}>
        <input type="hidden" name="caseId" value={caseId} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="next" value={next} />
        <button
          type="button"
          className="pri wfull"
          disabled={!allOk || capturando}
          onClick={capturar}
        >
          {capturando
            ? mode === "video"
              ? "Grabando y subiendo…"
              : "Capturando y subiendo…"
            : mode === "video"
              ? "● Grabar"
              : "Capturar"}
        </button>
      </form>
      {!allOk && (
        <div className="tiny" style={{ marginTop: 6 }}>
          El botón se activa cuando el encuadre coincide con la silueta y todos los puntos están
          marcados. Si no está correcto, no se hace la captura.
        </div>
      )}
    </div>
  );
}
