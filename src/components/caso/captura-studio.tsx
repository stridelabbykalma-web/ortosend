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

// El WASM del modelo pesa 12 MB y se sirve desde el CDN de jsDelivr; el modelo
// de pose (5,8 MB) va con la app para no depender de terceros para lo clínico.
const WASM_CDN =
  process.env.NEXT_PUBLIC_MEDIAPIPE_WASM ??
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const POSE_MODEL = "/mediapipe/pose_landmarker_lite.task";
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
  const perfil = persona && torsoH > 0 && shoulderDx < 0.5 * torsoH;
  // z de MediaPipe: menor = más cerca de la cámara. En perfil, el lado del
  // paciente que da a la cámara tiene hombro y cadera con z más pequeña.
  // (Los índices "L/R" de MediaPipe son el lado izquierdo/derecho del paciente.)
  const zL = (lms[L_SHOULDER].z + lms[L_HIP].z) / 2;
  const zR = (lms[R_SHOULDER].z + lms[R_HIP].z) / 2;
  const sideMargin = 0.02;
  // De frente o de espaldas: hombros abiertos. La imagen no está espejada, así
  // que de frente el hombro izquierdo del paciente cae a la derecha de la
  // imagen (x mayor) y de espaldas a la izquierda.
  const abierto = persona && torsoH > 0 && shoulderDx > 0.45 * torsoH;
  const izqEnDerechaImagen = lms[L_SHOULDER].x > lms[R_SHOULDER].x;
  return {
    persona,
    cuerpo_completo:
      persona &&
      vis(NOSE) > 0.4 &&
      Math.min(vis(L_ANKLE), vis(R_ANKLE)) > 0.4 &&
      minY > 0.02 &&
      maxY < 0.98,
    perfil,
    lado_dcho: perfil && zR < zL - sideMargin,
    lado_izq: perfil && zL < zR - sideMargin,
    de_frente: abierto && izqEnDerechaImagen,
    de_espaldas: abierto && !izqEnDerechaImagen,
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
  validSeconds: number | null; // tiempo acumulado con todos los checks en verde
};

export function CapturaStudio({
  caseId,
  kind,
  label,
  redo = false,
  autoStart = false,
  nextHref,
}: {
  caseId: string;
  kind: string;
  label: string;
  redo?: boolean;
  autoStart?: boolean; // abre la cámara al entrar en la pantalla (protocolo guiado)
  nextHref?: string; // a dónde ir cuando el servidor confirma la subida
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
  // valid/total: frames; validMs: tiempo real acumulado con encuadre válido
  const frameStatsRef = useRef({ valid: 0, total: 0, validMs: 0, lastTs: 0 });
  const [validLive, setValidLive] = useState(0);
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
      // El vídeo se muestra con object-fit: contain; el canvas debe cubrir
      // exactamente el área visible del vídeo (sin las bandas), no todo el marco.
      const box = video.getBoundingClientRect();
      if (box.width && video.videoWidth) {
        const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
        const dw = video.videoWidth * scale;
        const dh = video.videoHeight * scale;
        const st = canvas.style;
        const left = `${(box.width - dw) / 2}px`;
        const top = `${(box.height - dh) / 2}px`;
        if (st.left !== left || st.top !== top || st.width !== `${dw}px`) {
          st.left = left;
          st.top = top;
          st.width = `${dw}px`;
          st.height = `${dh}px`;
        }
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
          const st = frameStatsRef.current;
          const now = performance.now();
          const dt = st.lastTs ? now - st.lastTs : 0;
          st.lastTs = now;
          st.total++;
          if (ok || guide.checks.length === 0) {
            st.valid++;
            st.validMs += dt;
            setValidLive(st.validMs / 1000);
          }
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
          // flecha con el sentido de la marcha (vistas laterales)
          if (guide.direction) {
            const y = h * 0.93;
            const x0 = guide.direction === "ltr" ? w * 0.42 : w * 0.58;
            const x1 = guide.direction === "ltr" ? w * 0.58 : w * 0.42;
            const s = guide.direction === "ltr" ? 1 : -1;
            ctx.strokeStyle = "rgba(255,255,255,.6)";
            ctx.fillStyle = "rgba(255,255,255,.6)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x1 + s * 10, y);
            ctx.lineTo(x1 - s * 2, y - 6);
            ctx.lineTo(x1 - s * 2, y + 6);
            ctx.closePath();
            ctx.fill();
          }
          // esqueleto detectado sobre el paciente real (fino y translúcido)
          if (lms) {
            const col = ok ? "rgba(55,199,143,.8)" : "rgba(240,168,72,.8)";
            ctx.strokeStyle = col;
            ctx.fillStyle = col;
            ctx.lineWidth = 2;
            ctx.lineJoin = "round";
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
              ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
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
  }, [guide]);

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

  // Protocolo guiado: la cámara se abre sola al entrar en la pantalla
  const startedRef = useRef(false);
  useEffect(() => {
    if (autoStart && !startedRef.current) {
      startedRef.current = true;
      start();
    }
  }, [autoStart, start]);

  const finishRecording = useCallback(
    (mime: string) => {
      const blob = new Blob(chunksRef.current, { type: mime.split(";")[0] });
      chunksRef.current = [];
      const seconds = (performance.now() - recStartRef.current) / 1000;
      const { valid, total, validMs } = frameStatsRef.current;
      const url = URL.createObjectURL(blob);
      if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
      reviewUrlRef.current = url;
      setReview({
        blob,
        url,
        mime: mime.split(";")[0],
        seconds,
        validPct: total > 0 ? Math.round((100 * valid) / total) : null,
        validSeconds: total > 0 ? Math.round(validMs / 100) / 10 : null,
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
      frameStatsRef.current = { valid: 0, total: 0, validMs: 0, lastTs: 0 };
      setValidLive(0);
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
        setReview({ blob, url, mime: "image/jpeg", seconds: 0, validPct: null, validSeconds: null });
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
        validSeconds: review.validSeconds,
        minValidSeconds: guide.minValidSeconds ?? null,
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
      if (nextHref) router.push(nextHref);
      else router.refresh();
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : "Fallo de red durante la subida");
      setPhase("review");
    }
  }, [caseId, close, guide.seconds, guide.minValidSeconds, kind, nextHref, poseState, review, router]);

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
      <button type="button" className={autoStart ? "pri wfull" : undefined} onClick={start}>
        {autoStart
          ? isVideo
            ? `● Abrir la cámara y grabar (${guide.seconds} s)`
            : `📷 Abrir la cámara y hacer la foto (${guide.seconds} s)`
          : isVideo
            ? redo
              ? "↺ Repetir vídeo"
              : "● Grabar"
            : redo
              ? "↺ Repetir foto"
              : "📷 Foto"}
      </button>
    );

  const tooBig = !!review && review.blob.size > MAX_UPLOAD_BYTES;
  // Parada manual antes de tiempo: el clip no cubre la duración asignada
  const tooShort = !!review && isVideo && review.seconds < guide.seconds - 1;
  // Umbral de calidad: tiempo mínimo con todos los checks en verde. Solo se
  // puede exigir cuando el análisis de pose ha funcionado durante el clip.
  const tooFewValid =
    !!review &&
    isVideo &&
    poseState === "activo" &&
    !!guide.minValidSeconds &&
    review.validSeconds !== null &&
    review.validSeconds < guide.minValidSeconds;

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
                  {poseState === "activo" && guide.minValidSeconds
                    ? ` · válido ${validLive.toFixed(1)} s / mín. ${guide.minValidSeconds} s`
                    : ""}
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
                    ? `Cuenta atrás de ${VIDEO_PREROLL_SECONDS} s y grabación fija de ${guide.seconds} s (corte automático).${
                        guide.minValidSeconds
                          ? ` Para aceptar el clip: al menos ${guide.minValidSeconds} s con todos los checks en verde.`
                          : ""
                      }`
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
                  {review.validSeconds !== null && (
                    <>
                      Encuadre válido: {review.validSeconds.toFixed(1)} s
                      {guide.minValidSeconds ? ` (mín. ${guide.minValidSeconds} s)` : ""}
                      {review.validPct !== null ? ` · ${review.validPct}% de los frames` : ""} ·{" "}
                    </>
                  )}
                  Tamaño: {(review.blob.size / 1024 / 1024).toFixed(2)} MB
                </div>
                {tooFewValid && (
                  <div className="note r">
                    Solo {review.validSeconds?.toFixed(1)} s con el encuadre correcto; el protocolo
                    exige al menos {guide.minValidSeconds} s con todos los checks en verde (unos 3
                    pasos completos). Repite la grabación.
                  </div>
                )}
                {tooShort && !tooFewValid && (
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
                  <button
                    type="button"
                    className="pri"
                    onClick={upload}
                    disabled={tooBig || tooFewValid}
                  >
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
