"use client";

// Captura guiada con cámara: previsualización en vivo con la silueta de encuadre
// superpuesta (cómo debe colocarse el paciente) y checklist bloqueante — hasta que
// todo el encuadre está confirmado no se habilita el botón de captura.
import { useEffect, useRef, useState } from "react";
import { markMediaAction } from "@/app/panel/clinica-actions";

export type OverlayKind =
  | "marcha_lat_dcha"
  | "marcha_lat_izq"
  | "marcha_post"
  | "heel_rise"
  | "pie_izq"
  | "pie_dcho"
  | "baro_estatica"
  | "baro_dinamica";

// Silueta de encuadre que se dibuja sobre la imagen de la cámara.
function Overlay({ kind }: { kind: OverlayKind }) {
  const guide = "rgba(255,255,255,0.9)";
  const zone = "rgba(45,212,191,0.85)"; // teal
  const common = { fill: "none", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  // Figura humana de perfil, a mitad de zancada (marcha lateral)
  const lateral = (flip: boolean) => (
    <g stroke={zone} {...common} transform={flip ? "translate(300,0) scale(-1,1)" : undefined}>
      <circle cx={150} cy={70} r={22} />
      <path d="M150 92 L146 200" />
      <path d="M146 130 L110 175 M146 130 L185 168" />
      <path d="M146 200 L105 280 L92 345 M146 200 L185 270 L210 340" />
      <path d="M92 345 L70 352 M210 340 L235 345" />
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
    </g>
  );

  // De espaldas, de puntillas: talones elevados (heel rise)
  const heelRise = (
    <g stroke={zone} {...common}>
      <circle cx={150} cy={60} r={20} />
      <path d="M150 80 L150 185" />
      <path d="M112 112 L150 95 L188 112 M112 112 L96 60 M188 112 L204 60" />
      <path d="M150 185 L131 268 L129 322 M150 185 L169 268 L171 322" />
      <path d="M121 322 L137 322 M163 322 L179 322" />
      <path d="M100 345 L200 345" stroke={guide} strokeWidth={2} />
      <path d="M129 322 L129 338 M171 322 L171 338" strokeDasharray="4 5" strokeWidth={2} />
      <text x={150} y={368} textAnchor="middle" fill={guide} fontSize={13} stroke="none">
        talones despegados del suelo
      </text>
    </g>
  );

  // Contorno de pie (escaneo 3D), planta hacia la cámara
  const pie = (flip: boolean) => (
    <g stroke={zone} {...common} transform={flip ? "translate(300,0) scale(-1,1)" : undefined}>
      <path d="M150 355 C 105 345 98 290 108 230 C 116 178 112 140 124 105 C 133 78 168 72 184 96 C 198 118 196 170 192 225 C 188 285 192 345 150 355 Z" />
      <circle cx={131} cy={84} r={11} />
      <circle cx={156} cy={72} r={9} />
      <circle cx={177} cy={78} r={8} />
    </g>
  );

  // Dos pies sobre la plataforma de presiones
  const baro = (walking: boolean) => (
    <g stroke={zone} {...common}>
      <rect x={40} y={40} width={220} height={320} rx={12} stroke={guide} strokeDasharray="8 8" strokeWidth={2} />
      <path d="M118 300 C 95 293 92 258 98 218 C 102 190 100 165 108 145 C 114 128 136 125 144 140 C 151 154 149 190 147 220 C 145 260 143 295 118 300 Z" />
      <path d="M182 300 C 205 293 208 258 202 218 C 198 190 200 165 192 145 C 186 128 164 125 156 140 C 149 154 151 190 153 220 C 155 260 157 295 182 300 Z" />
      {walking && (
        <>
          <path d="M150 330 L150 70" stroke={guide} strokeDasharray="5 8" strokeWidth={2} />
          <path d="M150 70 L138 88 M150 70 L162 88" stroke={guide} strokeWidth={2} />
        </>
      )}
    </g>
  );

  const walkArrow = (flip: boolean) => (
    <g stroke={guide} strokeWidth={2} fill="none" transform={flip ? "translate(300,0) scale(-1,1)" : undefined}>
      <path d="M60 372 L240 372 M240 372 L224 362 M240 372 L224 382" />
      <path d="M30 352 L270 352" strokeDasharray="2 6" strokeWidth={1.5} />
    </g>
  );

  return (
    <svg className="cam-overlay" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet" aria-hidden>
      {kind === "marcha_lat_dcha" && (
        <>
          {lateral(false)}
          {walkArrow(false)}
        </>
      )}
      {kind === "marcha_lat_izq" && (
        <>
          {lateral(true)}
          {walkArrow(true)}
        </>
      )}
      {kind === "marcha_post" && posterior}
      {kind === "heel_rise" && heelRise}
      {kind === "pie_izq" && pie(false)}
      {kind === "pie_dcho" && pie(true)}
      {kind === "baro_estatica" && baro(false)}
      {kind === "baro_dinamica" && baro(true)}
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
  kind: string; // kind de MediaAsset (video_lat_dcha_descalzo, scan_L…)
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
