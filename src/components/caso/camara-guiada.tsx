"use client";

// Captura guiada con cámara: previsualización en vivo con la silueta de encuadre
// superpuesta (cómo debe colocarse el paciente) y validación del encuadre.
//
// La validación es automática: un modelo de pose (MediaPipe Pose Landmarker)
// corre en el propio navegador, detecta los 33 puntos del cuerpo y comprueba
// las reglas de esa captura (src/lib/encuadre.ts): qué debe verse, hacia dónde
// mira el paciente, tamaño, centrado, quietud. La checklist se pone en verde
// sola y el botón solo se activa cuando lleva ~1 s todo en verde. Si el modelo
// no puede cargarse en el dispositivo, se vuelve a la checklist manual.
import { useEffect, useRef, useState } from "react";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { markMediaAction } from "@/app/panel/clinica-actions";
import {
  FOTOGRAMAS_ESTABLES,
  HUESOS,
  REGLAS,
  centroTobillos,
  evaluarEncuadre,
  type Historial,
  type Punto,
  type Resultado,
} from "@/lib/encuadre";

// El WASM del modelo pesa 12 MB y se sirve desde el CDN de jsDelivr; el modelo
// de pose (5,8 MB) va con la app para no depender de terceros para lo clínico.
const WASM_BASE =
  process.env.NEXT_PUBLIC_MEDIAPIPE_WASM ??
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODELO = "/mediapipe/pose_landmarker_lite.task";
const CARGA_MAX_MS = 30000;

export type OverlayKind =
  | "pie_post"
  | "pie_ant"
  | "marcha_post"
  | "marcha_ant"
  | "marcha_lat"
  | "retropie";

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

  // De pie quieto, de espaldas: piernas juntas y brazos al costado
  const piePost = (
    <g stroke={zone} {...common}>
      <circle cx={150} cy={62} r={22} />
      <path d="M150 84 L150 196" />
      <path d="M110 116 L150 100 L190 116 M110 116 L102 200 M190 116 L198 200" />
      <path d="M150 196 L136 280 L134 346 M150 196 L164 280 L166 346" />
      <path d="M120 350 L148 350 M152 350 L180 350" />
      <path d="M150 18 L150 40 M150 372 L150 392" stroke={guide} strokeDasharray="6 7" strokeWidth={2} />
      <text x={150} y={388} textAnchor="middle" fill={guide} fontSize={12} stroke="none">
        de pie, quieto, mirando al frente
      </text>
    </g>
  );

  // De pie quieto, de frente
  const pieAnt = (
    <g stroke={zone} {...common}>
      <circle cx={150} cy={62} r={22} />
      <path d="M142 58 L143 58 M157 58 L158 58" strokeWidth={4} />
      <path d="M144 72 Q150 76 156 72" strokeWidth={2} />
      <path d="M150 84 L150 196" />
      <path d="M110 116 L150 100 L190 116 M110 116 L102 200 M190 116 L198 200" />
      <path d="M150 196 L136 280 L134 346 M150 196 L164 280 L166 346" />
      <path d="M120 350 L148 350 M152 350 L180 350" />
      <path d="M150 18 L150 40" stroke={guide} strokeDasharray="6 7" strokeWidth={2} />
      <text x={150} y={388} textAnchor="middle" fill={guide} fontSize={12} stroke="none">
        de pie, quieto, de frente a la cámara
      </text>
    </g>
  );

  // De espaldas, de puntillas: talones despegados del suelo
  // Primer plano de los dos talones desde atrás: lo que se mide sobre la foto es
  // la inclinación del eje del calcáneo respecto a la vertical de la pierna.
  const retropie = (
    <g stroke={zone} {...common}>
      {/* pierna y talón izquierdos */}
      <path d="M78 52 C80 168, 88 224, 96 262" />
      <path d="M142 52 C140 168, 132 224, 124 262" />
      <path d="M96 262 Q110 274 124 262" />
      {/* pierna y talón derechos */}
      <path d="M158 52 C160 168, 168 224, 176 262" />
      <path d="M222 52 C220 168, 212 224, 204 262" />
      <path d="M176 262 Q190 274 204 262" />
      {/* eje del calcáneo: es lo que se compara con la vertical */}
      <path d="M110 150 L110 268" strokeDasharray="5 6" strokeWidth={2} stroke={guide} />
      <path d="M190 150 L190 268" strokeDasharray="5 6" strokeWidth={2} stroke={guide} />
      {/* suelo */}
      <path d="M46 280 L254 280" stroke={guide} strokeWidth={2} />
      <text x={150} y={32} textAnchor="middle" fill={guide} fontSize={12} stroke="none">
        de rodilla para abajo, los dos talones
      </text>
      <text x={150} y={306} textAnchor="middle" fill={guide} fontSize={12} stroke="none">
        cámara a la altura del suelo, perpendicular
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
      {kind === "pie_post" && piePost}
      {kind === "pie_ant" && pieAnt}
      {kind === "retropie" && retropie}
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
  kind: string; // kind de MediaAsset (video_pie_post, foto_retropie…)
  overlay: OverlayKind;
  mode: "foto" | "video";
  checks: string[]; // checklist manual, solo si la visión no está disponible
  next: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [cam, setCam] = useState<"pidiendo" | "activa" | "no">("pidiendo");
  const [vision, setVision] = useState<"cargando" | "activa" | "no">("cargando");
  const [auto, setAuto] = useState<{ checks: Resultado[]; detectado: boolean; estable: boolean }>({
    checks: REGLAS[overlay].map((r) => ({ label: r.label, ok: false })),
    detectado: false,
    estable: false,
  });
  const [manual, setManual] = useState<boolean[]>(() => checks.map(() => false));
  const [capturando, setCapturando] = useState(false);

  const autoOk = vision === "activa" && auto.estable;
  const manualOk = vision === "no" && manual.every(Boolean);
  const allOk = autoOk || manualOk;
  const todoVerde = auto.checks.every((c) => c.ok);

  // --- Cámara ---
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
        if (!cancelled) {
          setCam("no");
          setVision("no");
        }
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // --- Visión: carga el modelo y evalúa cada fotograma ---
  useEffect(() => {
    if (cam !== "activa") return;
    let cancelado = false;
    let landmarker: PoseLandmarker | null = null;
    let raf = 0;
    let lastTs = -1;
    let estable = 0;
    let ultimaClave = "";
    const historial: Historial = [];

    const dibujar = (lm: Punto[] | null) => {
      const c = canvasRef.current;
      const v = videoRef.current;
      if (!c || !v) return;
      if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      if (!lm) return;
      const px = (p: Punto) => [p.x * c.width, p.y * c.height] as const;
      ctx.lineWidth = Math.max(2, c.width / 240);
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      for (const [a, b] of HUESOS) {
        if ((lm[a].visibility ?? 1) < 0.5 || (lm[b].visibility ?? 1) < 0.5) continue;
        ctx.beginPath();
        ctx.moveTo(...px(lm[a]));
        ctx.lineTo(...px(lm[b]));
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(45,212,191,0.95)";
      for (const p of lm) {
        if ((p.visibility ?? 1) < 0.5) continue;
        const [x, y] = px(p);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(3, c.width / 160), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const aviso = setTimeout(() => {
      if (!cancelado && !landmarker) {
        console.warn("Validación automática: el modelo tardó demasiado en cargar");
        setVision("no");
      }
    }, CARGA_MAX_MS);

    (async () => {
      try {
        const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
        const files = await FilesetResolver.forVisionTasks(WASM_BASE);
        const crear = (delegate: "GPU" | "CPU") =>
          PoseLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetPath: MODELO, delegate },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        try {
          landmarker = await crear("GPU");
        } catch {
          landmarker = await crear("CPU");
        }
        clearTimeout(aviso);
        if (cancelado) {
          landmarker.close();
          return;
        }
        setVision("activa");

        const loop = () => {
          if (cancelado || !landmarker) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2 && v.videoWidth > 0) {
            const ts = performance.now();
            if (ts > lastTs) {
              lastTs = ts;
              const res = landmarker.detectForVideo(v, ts);
              const lm = (res.landmarks?.[0] as Punto[] | undefined) ?? null;
              if (lm) {
                historial.push(centroTobillos(lm));
                if (historial.length > 24) historial.shift();
              } else historial.length = 0;
              const ev = evaluarEncuadre(overlay, lm, historial);
              estable = ev.ok ? Math.min(estable + 1, FOTOGRAMAS_ESTABLES) : 0;
              dibujar(lm);
              // Solo se vuelve a pintar la checklist cuando cambia algo visible.
              const clave =
                ev.checks.map((c) => (c.ok ? "1" : "0")).join("") +
                (ev.detectado ? "d" : "n") +
                (estable >= FOTOGRAMAS_ESTABLES ? "S" : "s");
              if (clave !== ultimaClave) {
                ultimaClave = clave;
                setAuto({ checks: ev.checks, detectado: ev.detectado, estable: estable >= FOTOGRAMAS_ESTABLES });
              }
            }
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (err) {
        clearTimeout(aviso);
        console.warn("Validación automática no disponible en este dispositivo", err);
        if (!cancelado) setVision("no");
      }
    })();

    return () => {
      cancelado = true;
      clearTimeout(aviso);
      cancelAnimationFrame(raf);
      landmarker?.close();
    };
  }, [cam, overlay]);

  const capturar = () => {
    if (!allOk || capturando) return;
    setCapturando(true);
    // Simulación de grabación/subida; en producción: MediaRecorder + subida por
    // fragmentos a R2/S3 y el check verde solo con confirmación del servidor.
    setTimeout(() => formRef.current?.requestSubmit(), mode === "video" ? 1600 : 700);
  };

  const estadoVision =
    cam === "no"
      ? null
      : vision === "cargando"
        ? { txt: "Cargando la detección de postura…", cls: "n" }
        : vision === "no"
          ? { txt: "Sin detección automática: confirma tú el encuadre", cls: "a" }
          : !auto.detectado
            ? { txt: "Buscando al paciente en la imagen…", cls: "n" }
            : auto.estable
              ? { txt: "Encuadre correcto", cls: "g" }
              : todoVerde
                ? { txt: "Todo en verde: mantén la posición un segundo…", cls: "g" }
                : { txt: "Ajusta el encuadre: mira la lista", cls: "a" };

  return (
    <div>
      <div className="cam-box">
        {cam !== "no" ? (
          <>
            <video ref={videoRef} className="cam-video" autoPlay playsInline muted />
            <canvas ref={canvasRef} className="cam-video cam-pose" />
          </>
        ) : (
          <div className="cam-off">
            Cámara no disponible en este dispositivo.
            <br />
            La silueta indica igualmente cómo colocar al paciente.
          </div>
        )}
        <Overlay kind={overlay} />
        {estadoVision && !capturando && (
          <div className={`cam-vision ${estadoVision.cls}`}>{estadoVision.txt}</div>
        )}
        {capturando && (
          <div className="cam-rec">{mode === "video" ? "● Grabando…" : "Capturando…"}</div>
        )}
      </div>

      <div className="sp" />
      {vision === "no" ? (
        <>
          <b style={{ fontSize: 14 }}>Comprueba el encuadre</b>
          {checks.map((c, i) => (
            <label className="chk" key={c}>
              <input
                type="checkbox"
                checked={manual[i]}
                onChange={(ev) =>
                  setManual((prev) => prev.map((v, j) => (j === i ? ev.target.checked : v)))
                }
              />{" "}
              {c}
            </label>
          ))}
        </>
      ) : (
        <>
          <b style={{ fontSize: 14 }}>Lo que debe verse (se comprueba solo)</b>
          {auto.checks.map((c) => (
            <div className={`chk ${c.ok ? "ok" : ""}`} key={c.label} data-ok={c.ok ? "1" : "0"}>
              <span className={`pill ${c.ok ? "g" : "n"}`} style={{ minWidth: 24, textAlign: "center" }}>
                {c.ok ? "✓" : "·"}
              </span>{" "}
              {c.label}
            </div>
          ))}
        </>
      )}

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
          {vision === "no"
            ? "El botón se activa cuando el encuadre coincide con la silueta y todos los puntos están marcados. Si no está correcto, no se hace la captura."
            : "El botón se activa solo cuando la cámara detecta al paciente colocado como pide la lista y lo mantiene un segundo. Si no está correcto, no se hace la captura."}
        </div>
      )}
    </div>
  );
}
