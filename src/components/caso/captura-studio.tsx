"use client";

// Estudio de captura web (tipo MediaPipe Studio): cámara del dispositivo +
// PoseLandmarker en vivo para validar el encuadre antes de grabar los vídeos
// del protocolo o tomar las fotos clínicas. La subida va a /api/media y el
// check verde solo aparece cuando el servidor confirma.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PoseLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  CAPTURE_GUIDES,
  CHECK_LABEL,
  VIDEO_PREROLL_SECONDS,
  type CheckId,
} from "@/lib/capture-guide";

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // límite del servidor (4 MB)

// Índices de landmarks de MediaPipe Pose
const NOSE = 0,
  L_SHOULDER = 11,
  R_SHOULDER = 12,
  L_HIP = 23,
  R_HIP = 24,
  L_ANKLE = 27,
  R_ANKLE = 28,
  L_HEEL = 29,
  R_HEEL = 30,
  L_FOOT = 31,
  R_FOOT = 32;

type Checks = Partial<Record<CheckId, boolean>>;

function evalChecks(lms: NormalizedLandmark[] | undefined): Checks {
  if (!lms || lms.length < 33) return {};
  const vis = (i: number) => lms[i]?.visibility ?? 0;
  const avg = (...v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const persona = avg(vis(L_SHOULDER), vis(R_SHOULDER), vis(L_HIP), vis(R_HIP)) > 0.5;
  const ys = lms.filter((p) => (p.visibility ?? 0) > 0.4).map((p) => p.y);
  const minY = ys.length ? Math.min(...ys) : 1;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const shoulderDx = Math.abs(lms[L_SHOULDER].x - lms[R_SHOULDER].x);
  const torsoH = Math.abs(
    (lms[L_SHOULDER].y + lms[R_SHOULDER].y) / 2 - (lms[L_HIP].y + lms[R_HIP].y) / 2
  );
  return {
    persona,
    cuerpo_completo:
      persona &&
      vis(NOSE) > 0.4 &&
      Math.min(vis(L_ANKLE), vis(R_ANKLE)) > 0.4 &&
      minY > 0.02 &&
      maxY < 0.98,
    perfil: persona && torsoH > 0 && shoulderDx < 0.5 * torsoH,
    frente_espalda: persona && torsoH > 0 && shoulderDx > 0.45 * torsoH,
    pies_visibles: avg(vis(L_HEEL), vis(R_HEEL), vis(L_FOOT), vis(R_FOOT)) > 0.4,
  };
}

function pickVideoMime(): string {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const c of candidates)
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  return "";
}

type Phase = "init" | "live" | "countdown" | "recording" | "review" | "uploading";

type Review = {
  blob: Blob;
  url: string;
  mime: string;
  seconds: number;
  validPct: number | null; // % de frames con encuadre válido (null si sin pose)
};

export function CapturaStudio({
  caseId,
  kind,
  label,
  redo = false,
}: {
  caseId: string;
  kind: string;
  label: string;
  redo?: boolean;
}) {
  const guide = CAPTURE_GUIDES[kind];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("init");
  const [fatal, setFatal] = useState<string | null>(null);
  const [poseState, setPoseState] = useState<"cargando" | "activo" | "sin_pose">("cargando");
  const [checks, setChecks] = useState<Checks>({});
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [review, setReview] = useState<Review | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const phaseRef = useRef<Phase>("init");
  const checksOkRef = useRef(false);
  const frameStatsRef = useRef({ valid: 0, total: 0 });
  const recStartRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const reviewUrlRef = useRef<string | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const allOk =
    poseState !== "activo" || guide.checks.every((c) => checks[c] === true);

  const clearTimers = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    clearTimers();
    if (recorderRef.current && recorderRef.current.state !== "inactive")
      recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
    reviewUrlRef.current = null;
  }, [clearTimers]);

  const close = useCallback(() => {
    cleanup();
    setOpen(false);
    setPhase("init");
    setFatal(null);
    setReview(null);
    setUploadErr(null);
    setChecks({});
    setElapsed(0);
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  // Bucle de detección + pintado del overlay (esqueleto y marco guía)
  const loop = useCallback(() => {
    const tick = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState >= 2) {
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const ctx = canvas.getContext("2d");
      let lms: NormalizedLandmark[] | undefined;
      const lm = landmarkerRef.current;
      if (lm && video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        try {
          const res = lm.detectForVideo(video, performance.now());
          lms = res.landmarks[0];
        } catch {
          // un frame fallido no rompe el estudio
        }
        const c = evalChecks(lms);
        setChecks(c);
        const ok = guide.checks.every((k) => c[k] === true);
        checksOkRef.current = ok;
        if (phaseRef.current === "recording") {
          frameStatsRef.current.total++;
          if (ok || guide.checks.length === 0) frameStatsRef.current.valid++;
        }
        if (ctx) {
          const { width: w, height: h } = canvas;
          ctx.clearRect(0, 0, w, h);
          // marco guía
          ctx.strokeStyle = "rgba(255,255,255,.55)";
          ctx.setLineDash([10, 8]);
          ctx.lineWidth = 2;
          ctx.strokeRect(w * 0.06, h * 0.04, w * 0.88, h * 0.92);
          ctx.setLineDash([]);
          // esqueleto
          if (lms) {
            const col = ok ? "#37c78f" : "#f0a848";
            ctx.strokeStyle = col;
            ctx.fillStyle = col;
            ctx.lineWidth = 3;
            const CONN: [number, number][] = [
              [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
              [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
              [24, 26], [26, 28], [27, 29], [29, 31], [27, 31],
              [28, 30], [30, 32], [28, 32],
            ];
            for (const [a, b] of CONN) {
              const pa = lms[a], pb = lms[b];
              if ((pa?.visibility ?? 0) < 0.4 || (pb?.visibility ?? 0) < 0.4) continue;
              ctx.beginPath();
              ctx.moveTo(pa.x * w, pa.y * h);
              ctx.lineTo(pb.x * w, pb.y * h);
              ctx.stroke();
            }
            for (const p of lms) {
              if ((p.visibility ?? 0) < 0.4) continue;
              ctx.beginPath();
              ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
      if (phaseRef.current === "recording")
        setElapsed((performance.now() - recStartRef.current) / 1000);
    }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, [guide.checks]);

  // Arranque del estudio: cámara + modelo de pose (CDN) en paralelo
  const start = useCallback(async () => {
    setOpen(true);
    setPhase("init");
    setFatal(null);
    setPoseState("cargando");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("sin vídeo");
      video.srcObject = stream;
      await video.play();
      setPhase("live");
      loop();
    } catch {
      setFatal(
        "No se pudo acceder a la cámara. Comprueba el permiso del navegador o usa el móvil de captura de la clínica."
      );
      return;
    }
    // El modelo se carga aparte: si falla, el estudio sigue en modo manual
    try {
      const visionMod = await import("@mediapipe/tasks-vision");
      const fileset = await visionMod.FilesetResolver.forVisionTasks(WASM_CDN);
      const make = (delegate: "GPU" | "CPU") =>
        visionMod.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate },
          runningMode: "VIDEO",
          numPoses: 1,
        });
      landmarkerRef.current = await make("GPU").catch(() => make("CPU"));
      setPoseState("activo");
    } catch {
      setPoseState("sin_pose");
    }
  }, [loop]);

  const finishRecording = useCallback(
    (mime: string) => {
      const blob = new Blob(chunksRef.current, { type: mime.split(";")[0] });
      chunksRef.current = [];
      const seconds = (performance.now() - recStartRef.current) / 1000;
      const { valid, total } = frameStatsRef.current;
      const url = URL.createObjectURL(blob);
      if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
      reviewUrlRef.current = url;
      setReview({
        blob,
        url,
        mime: mime.split(";")[0],
        seconds,
        validPct: total > 0 ? Math.round((100 * valid) / total) : null,
      });
      setPhase("review");
    },
    []
  );

  const record = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = pickVideoMime();
    if (!mime) {
      setFatal("Este navegador no soporta grabación de vídeo (MediaRecorder).");
      return;
    }
    try {
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_000_000 });
      recorderRef.current = rec;
      chunksRef.current = [];
      frameStatsRef.current = { valid: 0, total: 0 };
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => finishRecording(mime);
      rec.start(250);
      recStartRef.current = performance.now();
      setElapsed(0);
      setPhase("recording");
      // Duración fija asignada a la prueba: el corte es automático
      stopTimerRef.current = setTimeout(() => {
        if (recorderRef.current === rec && rec.state === "recording") rec.stop();
      }, guide.seconds * 1000);
    } catch {
      setFatal("No se pudo iniciar la grabación en este dispositivo.");
    }
  }, [finishRecording, guide.seconds]);

  const stopRecording = useCallback(() => {
    clearTimers();
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") rec.stop();
  }, [clearTimers]);

  // Cuenta atrás compartida: pre-roll antes del vídeo o temporizador de la foto
  const runCountdown = useCallback(
    (seconds: number, then: () => void) => {
      clearTimers();
      let left = seconds;
      setCountdown(left);
      setPhase("countdown");
      countdownRef.current = setInterval(() => {
        left -= 1;
        if (left > 0) {
          setCountdown(left);
          return;
        }
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = null;
        then();
      }, 1000);
    },
    [clearTimers]
  );

  const cancelCountdown = useCallback(() => {
    clearTimers();
    setPhase("live");
  }, [clearTimers]);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      setPhase("live");
      return;
    }
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d")?.drawImage(video, 0, 0);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
        reviewUrlRef.current = url;
        setReview({ blob, url, mime: "image/jpeg", seconds: 0, validPct: null });
        setPhase("review");
      },
      "image/jpeg",
      0.85
    );
  }, []);

  const upload = useCallback(async () => {
    if (!review) return;
    setPhase("uploading");
    setUploadErr(null);
    const ext = review.mime === "image/jpeg" ? "jpg" : review.mime.split("/")[1] || "webm";
    const fd = new FormData();
    fd.set("caseId", caseId);
    fd.set("kind", kind);
    fd.set(
      "meta",
      JSON.stringify({
        seconds: Math.round(review.seconds * 10) / 10,
        targetSeconds: guide.seconds,
        validPct: review.validPct,
        mime: review.mime,
        pose: poseState === "activo" ? "pose_landmarker_lite" : "no_disponible",
      })
    );
    fd.set("file", new File([review.blob], `${kind}.${ext}`, { type: review.mime }));
    try {
      const res = await fetch("/api/media", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Error ${res.status}`);
      close();
      router.refresh();
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : "Fallo de red durante la subida");
      setPhase("review");
    }
  }, [caseId, close, guide.seconds, kind, poseState, review, router]);

  const retake = useCallback(() => {
    clearTimers();
    if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
    reviewUrlRef.current = null;
    setReview(null);
    setUploadErr(null);
    setPhase("live");
  }, [clearTimers]);

  if (!guide) return null;
  const isVideo = guide.mode === "video";
  const remaining = Math.max(0, guide.seconds - elapsed);

  if (!open)
    return (
      <button type="button" onClick={start}>
        {isVideo ? (redo ? "↺ Repetir vídeo" : "● Grabar") : redo ? "↺ Repetir foto" : "📷 Foto"}
      </button>
    );

  const tooBig = !!review && review.blob.size > MAX_UPLOAD_BYTES;
  // Parada manual antes de tiempo: el clip no cubre la duración asignada
  const tooShort = !!review && isVideo && review.seconds < guide.seconds - 1;

  return (
    <div className="studio" role="dialog" aria-label={`Estudio de captura: ${label}`}>
      <div className="studio-head">
        <b>{label}</b>
        <button type="button" className="studio-x" onClick={close}>
          ✕ Cerrar
        </button>
      </div>

      {fatal ? (
        <div className="studio-body">
          <div className="note r">{fatal}</div>
        </div>
      ) : (
        <div className="studio-body">
          <div className="studio-stage" style={{ display: phase === "review" ? "none" : undefined }}>
            <video ref={videoRef} playsInline muted />
            <canvas ref={canvasRef} />
            {phase === "countdown" && (
              <div className="studio-count" aria-live="assertive">
                <div className="n">{countdown}</div>
                <div className="t">{isVideo ? "La grabación empieza en…" : "Foto en… mantén el móvil quieto"}</div>
              </div>
            )}
            {phase === "recording" && (
              <>
                <div className="studio-rec">
                  ● REC · quedan {Math.ceil(remaining)} s de {guide.seconds} s
                </div>
                <div className="studio-bar">
                  <div style={{ width: `${Math.min(100, (100 * elapsed) / guide.seconds)}%` }} />
                </div>
              </>
            )}
          </div>

          {phase === "review" && review && (
            <div className="studio-stage">
              {isVideo ? (
                <video src={review.url} controls playsInline />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={review.url} alt={`Previsualización: ${label}`} />
              )}
            </div>
          )}

          <div className="studio-side">
            {phase !== "review" && (
              <>
                <div className="tiny">ENCUADRE</div>
                {poseState === "cargando" && (
                  <div className="muted">Cargando análisis de pose (MediaPipe)…</div>
                )}
                {poseState === "sin_pose" && (
                  <div className="note a">
                    Análisis de pose no disponible en este dispositivo — captura en modo manual,
                    revisa el encuadre con el marco guía.
                  </div>
                )}
                {poseState === "activo" &&
                  guide.checks.map((c) => (
                    <div key={c} className={`checkline ${checks[c] ? "ok" : ""}`}>
                      <span>{checks[c] ? "✓" : "○"}</span>
                      {CHECK_LABEL[c]}
                    </div>
                  ))}
                <div className="sp" />
                <div className="tiny">DURACIÓN ASIGNADA</div>
                <div className="muted">
                  {isVideo
                    ? `Cuenta atrás de ${VIDEO_PREROLL_SECONDS} s y grabación fija de ${guide.seconds} s (corte automático).`
                    : `Temporizador de ${guide.seconds} s y disparo automático.`}
                </div>
                <div className="sp" />
                <div className="tiny">INSTRUCCIONES</div>
                <ul className="studio-tips">
                  {guide.tips.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <div className="sp" />
                {phase === "live" && isVideo && (
                  <button
                    type="button"
                    className="pri wfull"
                    onClick={() => runCountdown(VIDEO_PREROLL_SECONDS, record)}
                    disabled={!allOk}
                  >
                    {allOk ? `● Grabar ${guide.seconds} s` : "Ajusta el encuadre para grabar"}
                  </button>
                )}
                {phase === "live" && !isVideo && (
                  <button
                    type="button"
                    className="pri wfull"
                    onClick={() => runCountdown(guide.seconds, takePhoto)}
                  >
                    📷 Foto con temporizador ({guide.seconds} s)
                  </button>
                )}
                {phase === "countdown" && (
                  <button type="button" className="wfull" onClick={cancelCountdown}>
                    Cancelar cuenta atrás
                  </button>
                )}
                {phase === "recording" && (
                  <button type="button" className="dang wfull" onClick={stopRecording}>
                    ■ Parar antes de tiempo
                  </button>
                )}
              </>
            )}

            {phase === "review" && review && (
              <>
                <div className="tiny">REVISIÓN</div>
                <div className="muted">
                  {isVideo && (
                    <>
                      Duración: {review.seconds.toFixed(1)} s de {guide.seconds} s ·{" "}
                    </>
                  )}
                  {review.validPct !== null && <>Encuadre válido: {review.validPct}% · </>}
                  Tamaño: {(review.blob.size / 1024 / 1024).toFixed(2)} MB
                </div>
                {tooShort && (
                  <div className="note a">
                    Clip incompleto: se paró antes de los {guide.seconds} s asignados. Comprueba
                    que se ven pasos completos o repite la grabación.
                  </div>
                )}
                {tooBig && (
                  <div className="note r">
                    El archivo supera los 4 MB del prototipo — repite la captura (se corta antes
                    o baja la duración).
                  </div>
                )}
                {uploadErr && <div className="note r">Error al subir: {uploadErr}</div>}
                <div className="sp" />
                <div className="row">
                  <button type="button" onClick={retake}>
                    ↺ Repetir
                  </button>
                  <button type="button" className="pri" onClick={upload} disabled={tooBig}>
                    ✓ Usar y subir
                  </button>
                </div>
                <div className="tiny" style={{ marginTop: 8 }}>
                  El check verde del protocolo solo aparece cuando el servidor confirma la subida.
                </div>
              </>
            )}

            {phase === "uploading" && <div className="note">Subiendo y confirmando en el servidor…</div>}
          </div>
        </div>
      )}
    </div>
  );
}
