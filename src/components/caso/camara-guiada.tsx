"use client";

// Captura guiada con cámara: previsualización en vivo con una guía de encuadre
// discreta (área segura, suelo, leyenda) y validación automática del encuadre.
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

// Guía de encuadre que se dibuja sobre la imagen de la cámara: área segura,
// línea de suelo donde deben apoyar los pies y una leyenda corta. Deliberadamente
// sin figuras dibujadas: la referencia real es el esqueleto que pinta la
// detección de postura sobre el propio paciente.
const LEYENDA: Record<OverlayKind, string> = {
  pie_post: "de pie, quieto, de espaldas · cuerpo entero",
  pie_ant: "de pie, quieto, de frente · cuerpo entero",
  marcha_post: "parte junto a la cámara y se aleja",
  marcha_ant: "parte al fondo y camina hacia la cámara",
  marcha_lat: "cruza el encuadre de perfil · cámara a su lado",
  retropie: "de rodilla para abajo · los dos talones desde atrás",
};

function Overlay({ kind }: { kind: OverlayKind }) {
  const guide = "rgba(255,255,255,0.6)";
  const zone = "rgba(45,212,191,0.8)"; // teal
  const cuerpoEntero = kind !== "retropie";
  // Los pies quedan sobre la línea de suelo en las capturas estáticas y en la
  // lateral; en las marchas en eje el paciente cambia de tamaño y no aplica.
  const conSuelo = kind === "pie_post" || kind === "pie_ant" || kind === "marcha_lat" || kind === "retropie";
  const x0 = 22;
  const x1 = 278;
  const yTop = 20;
  const yBot = 370;
  const ySuelo = cuerpoEntero ? 352 : 296;
  const esquina = 16;
  return (
    <svg className="cam-overlay" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet" aria-hidden>
      {/* esquinas del área segura */}
      <g stroke={guide} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={`M${x0} ${yTop + esquina} V${yTop} H${x0 + esquina}`} />
        <path d={`M${x1 - esquina} ${yTop} H${x1} V${yTop + esquina}`} />
        <path d={`M${x0} ${yBot - esquina} V${yBot} H${x0 + esquina}`} />
        <path d={`M${x1 - esquina} ${yBot} H${x1} V${yBot - esquina}`} />
      </g>
      {/* eje central: el paciente centrado */}
      {cuerpoEntero && (
        <path d={`M150 ${yTop + 10} V${yBot - 10}`} stroke={guide} strokeWidth={1} strokeDasharray="2 9" />
      )}
      {/* línea de suelo: los pies apoyan aquí */}
      {conSuelo && (
        <path d={`M${x0 + 10} ${ySuelo} H${x1 - 10}`} stroke={zone} strokeWidth={2} strokeDasharray="8 6" />
      )}
      {/* talones: eje vertical de cada pierna, con el que se compara el calcáneo */}
      {kind === "retropie" && (
        <g stroke={zone} strokeWidth={1.5} strokeDasharray="5 6" fill="none">
          <path d={`M105 130 V${ySuelo}`} />
          <path d={`M195 130 V${ySuelo}`} />
        </g>
      )}
      {/* marcha lateral: sentido en que cruza el encuadre */}
      {kind === "marcha_lat" && (
        <g stroke={guide} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={`M120 ${ySuelo + 11} H180 M180 ${ySuelo + 11} L171 ${ySuelo + 6} M180 ${ySuelo + 11} L171 ${ySuelo + 16}`} />
        </g>
      )}
      {/* leyenda */}
      <rect x={30} y={378} width={240} height={18} rx={9} fill="rgba(28,27,24,0.62)" />
      <text x={150} y={390.5} textAnchor="middle" fill="#fff" fontSize={10.5} fontWeight={600}>
        {LEYENDA[kind]}
      </text>
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
            La leyenda de la guía indica igualmente cómo colocar al paciente.
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
            ? "El botón se activa cuando el encuadre sigue la guía y todos los puntos están marcados. Si no está correcto, no se hace la captura."
            : "El botón se activa solo cuando la cámara detecta al paciente colocado como pide la lista y lo mantiene un segundo. Si no está correcto, no se hace la captura."}
        </div>
      )}
    </div>
  );
}
