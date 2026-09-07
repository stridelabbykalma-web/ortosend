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
import { BEEP_LEAD_MS, playBeep, primeBeeps } from "@/lib/beeps";
import { computeHelbing, helbingResumen, type Helbing } from "@/lib/helbing";
import { HelbingOverlay } from "@/components/caso/helbing-overlay";

// El WASM del modelo pesa 12 MB y se sirve desde el CDN de jsDelivr; el modelo
// de pose (5,8 MB) va con la app para no depender de terceros para lo clínico.
const WASM_CDN =
  process.env.NEXT_PUBLIC_MEDIAPIPE_WASM ??
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const POSE_MODEL = "/mediapipe/pose_landmarker_lite.task";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // límite del servidor (4 MB)
// La grabación arranca en silencio y el pitido de salida suena este tiempo
// después, para que quede grabado el arranque del paciente desde parado.
// (El WAV lleva un silencio inicial de BEEP_LEAD_MS que se descuenta.)
const START_BEEP_DELAY_MS = 500;

// Tonos con Web Audio (sin archivos). Devuelve false si el navegador no deja
// sonar (política de autoplay) para poder avisar visualmente.
function playTones(ctx: AudioContext, tones: { freq: number; ms: number; at: number }[]) {
  const t0 = ctx.currentTime;
  for (const { freq, ms, at } of tones) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    const t = t0 + at / 1000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
    g.gain.setValueAtTime(0.5, t + ms / 1000 - 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + ms / 1000 + 0.02);
  }
}

// Índices de landmarks de MediaPipe Pose
const L_SHOULDER = 11,
  R_SHOULDER = 12,
  L_HIP = 23,
  R_HIP = 24,
  L_ANKLE = 27,
  R_ANKLE = 28,
  L_HEEL = 29,
  R_HEEL = 30,
  L_FOOT = 31,
  R_FOOT = 32,
  L_KNEE = 25,
  R_KNEE = 26;

type Checks = Partial<Record<CheckId, boolean>>;

// Los checks se basan en caderas, rodillas y tobillos, que son lo que siempre
// está en plano en una marcha: la cabeza y los hombros pueden quedar fuera al
// principio (paciente cerca de la cámara) y no debe bloquear la grabación.
function evalChecks(lms: NormalizedLandmark[] | undefined): Checks {
  if (!lms || lms.length < 33) return {};
  const vis = (i: number) => lms[i]?.visibility ?? 0;
  const avg = (...v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const persona = avg(vis(L_HIP), vis(R_HIP)) > 0.5 && avg(vis(L_KNEE), vis(R_KNEE)) > 0.4;
  const hipMidY = (lms[L_HIP].y + lms[R_HIP].y) / 2;
  const ankleMidY = (lms[L_ANKLE].y + lms[R_ANKLE].y) / 2;
  // Escala del cuerpo: longitud de la pierna (cadera → tobillo), siempre visible
  const legLen = Math.abs(ankleMidY - hipMidY);
  const feetY = Math.max(lms[L_ANKLE].y, lms[R_ANKLE].y, lms[L_HEEL].y, lms[R_HEEL].y);
  const cinturaAPies =
    persona &&
    Math.min(vis(L_ANKLE), vis(R_ANKLE)) > 0.4 &&
    Math.min(lms[L_HIP].y, lms[R_HIP].y) > 0.02 && // caderas dentro por arriba
    feetY < 0.98; // pies sin cortar por abajo
  // Orientación por la anchura de caderas respecto a la pierna: de perfil las
  // caderas se superponen; de frente o de espaldas se abren (~0,3 de la pierna).
  const hipDx = Math.abs(lms[L_HIP].x - lms[R_HIP].x);
  const perfil = persona && legLen > 0 && hipDx < 0.15 * legLen;
  const abierto = persona && legLen > 0 && hipDx > 0.22 * legLen;
  // z de MediaPipe: menor = más cerca de la cámara. En perfil, el lado del
  // paciente que da a la cámara tiene la cadera (y el hombro, si se ve) con z
  // más pequeña. Los índices "L/R" son el lado izquierdo/derecho del paciente.
  const shouldersOk = Math.min(vis(L_SHOULDER), vis(R_SHOULDER)) > 0.5;
  const zL = shouldersOk ? (lms[L_SHOULDER].z + lms[L_HIP].z) / 2 : lms[L_HIP].z;
  const zR = shouldersOk ? (lms[R_SHOULDER].z + lms[R_HIP].z) / 2 : lms[R_HIP].z;
  const sideMargin = 0.02;
  // De frente o de espaldas: la imagen no está espejada, así que de frente la
  // cadera izquierda del paciente cae a la derecha de la imagen (x mayor).
  const izqEnDerechaImagen = lms[L_HIP].x > lms[R_HIP].x;
  // Pies (fotos de cerca): talones y dedos de los dos pies con buena confianza,
  // y anchura que ocupan en la imagen (de cerca, los dos pies llenan el ancho).
  const piesVisibles = Math.min(vis(L_HEEL), vis(R_HEEL), vis(L_FOOT), vis(R_FOOT)) > 0.5;
  const feetXs = [lms[L_HEEL].x, lms[R_HEEL].x, lms[L_FOOT].x, lms[R_FOOT].x];
  const footSpan = Math.max(...feetXs) - Math.min(...feetXs);
  const feetBottom = Math.max(lms[L_HEEL].y, lms[R_HEEL].y, lms[L_FOOT].y, lms[R_FOOT].y);
  return {
    persona,
    cintura_a_pies: cinturaAPies,
    perfil,
    lado_dcho: perfil && zR < zL - sideMargin,
    lado_izq: perfil && zL < zR - sideMargin,
    de_frente: abierto && izqEnDerechaImagen,
    de_espaldas: abierto && !izqEnDerechaImagen,
    pies_visibles: piesVisibles,
    pies_de_cerca: piesVisibles && footSpan > 0.35 && feetBottom < 0.97,
    // Perspectiva con la cámara a la altura del tobillo: lo que está más lejos
    // sale más alto en la imagen. Desde atrás los dedos quedan por encima de los
    // talones y el pie izquierdo del paciente cae a la izquierda de la imagen;
    // desde delante, al revés.
    pies_desde_atras:
      piesVisibles &&
      lms[L_FOOT].y < lms[L_HEEL].y &&
      lms[R_FOOT].y < lms[R_HEEL].y &&
      lms[L_HEEL].x < lms[R_HEEL].x,
    pies_de_frente:
      piesVisibles &&
      lms[L_FOOT].y > lms[L_HEEL].y &&
      lms[R_FOOT].y > lms[R_HEEL].y &&
      lms[L_FOOT].x > lms[R_FOOT].x,
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
  helbing?: Helbing | null; // foto posterior: línea de Helbing calculada al disparar
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
  // Selección de cámara (PC con varias cámaras o con cámaras virtuales) y
  // aviso cuando la fuente no envía imagen (tecla/interruptor de privacidad,
  // bloqueo en los ajustes del sistema, cámara ocupada por otro programa).
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState<string>(() => {
    try {
      return localStorage.getItem("ortosend.cameraId") ?? "";
    } catch {
      return "";
    }
  });
  const [camMuted, setCamMuted] = useState(false);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const phaseRef = useRef<Phase>("init");
  const checksOkRef = useRef(false);
  // Estabilidad de los checks: el botón y el arranque automático no dependen
  // de un solo frame (parpadea) sino de la mayoría de los últimos.
  const okHistRef = useRef<boolean[]>([]);
  const [stableOk, setStableOk] = useState(false);
  const stableOkRef = useRef(false);
  const armedRef = useRef(true); // listo para arrancar solo la próxima vez que todo esté en verde
  const autoRecordRef = useRef<() => void>(() => {});
  const lastLmsRef = useRef<NormalizedLandmark[] | null>(null); // últimos puntos detectados
  const takePhotoRef = useRef<() => void>(() => {}); // takePhoto se define más abajo
  // valid/total: frames; validMs: tiempo real acumulado con encuadre válido
  const frameStatsRef = useRef({ valid: 0, total: 0, validMs: 0, lastTs: 0 });
  const recStartRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const reviewUrlRef = useRef<string | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const [beeped, setBeeped] = useState(false); // ya ha sonado la salida en esta grabación

  // Pitidos: salida (dos tonos ascendentes) y fin (un tono grave). Si el
  // navegador bloquea el audio, la señal visual "¡YA!" sigue apareciendo.
  // Primero como contenido multimedia (<audio>: en iPhone no lo silencia el
  // interruptor lateral); si el navegador no lo permite, Web Audio de respaldo.
  const beep = useCallback(async (kind: "start" | "stop") => {
    try {
      if (navigator.vibrate) navigator.vibrate(kind === "start" ? [120, 60, 160] : 200);
      if (await playBeep(kind)) return;
      const ctx = (audioRef.current ??= new AudioContext());
      if (ctx.state === "suspended") await ctx.resume();
      if (kind === "start")
        playTones(ctx, [
          { freq: 880, ms: 160, at: 0 },
          { freq: 1320, ms: 280, at: 190 },
        ]);
      else playTones(ctx, [{ freq: 440, ms: 380, at: 0 }]);
    } catch {
      // sin audio disponible: queda la señal visual
    }
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const allOk = poseState !== "activo" || stableOk;

  const clearTimers = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (beepTimerRef.current) clearTimeout(beepTimerRef.current);
    beepTimerRef.current = null;
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
          lastLmsRef.current = lms ?? null;
        } catch {
          // un frame fallido no rompe el estudio
        }
        const c = evalChecks(lms);
        setChecks(c);
        const ok = guide.checks.every((k) => c[k] === true);
        checksOkRef.current = ok;
        // Mayoría de los últimos ~15 frames (≈ 1 s): estable en verde
        const oh = okHistRef.current;
        oh.push(ok);
        if (oh.length > 15) oh.shift();
        const stable = oh.length >= 10 && oh.filter(Boolean).length >= 0.75 * oh.length;
        if (stable !== stableOkRef.current) {
          stableOkRef.current = stable;
          setStableOk(stable);
        }
        if (!stable) armedRef.current = true;
        else if (armedRef.current && phaseRef.current === "live" && guide.checks.length > 0) {
          // Todo en verde de forma estable: la cuenta atrás arranca sola (vídeo o foto)
          armedRef.current = false;
          autoRecordRef.current();
        }
        if (phaseRef.current === "recording") {
          const st = frameStatsRef.current;
          const now = performance.now();
          const dt = st.lastTs ? now - st.lastTs : 0;
          st.lastTs = now;
          st.total++;
          if (ok || guide.checks.length === 0) {
            st.valid++;
            st.validMs += dt;
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
  // Abre (o cambia) la cámara. Con deviceId vacío deja elegir al navegador
  // (en móvil, la trasera). Rellena la lista de cámaras disponibles.
  const openCamera = useCallback(async (id: string) => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setCamMuted(false);
    const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (id) video.deviceId = { exact: id };
    else video.facingMode = "environment";
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      // la cámara guardada ya no existe: se vuelve a la elección automática
      if (id) {
        try {
          localStorage.removeItem("ortosend.cameraId");
        } catch {}
        setDeviceId("");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } else throw e;
    }
    streamRef.current = stream;
    const track = stream.getVideoTracks()[0];
    if (track) {
      setCamMuted(track.muted);
      track.onmute = () => setCamMuted(true);
      track.onunmute = () => setCamMuted(false);
      track.onended = () => setCamMuted(true);
    }
    const el = videoRef.current;
    if (!el) throw new Error("sin vídeo");
    el.srcObject = stream;
    await el.play();
    lastVideoTimeRef.current = -1;
    // Con permiso concedido, las etiquetas de las cámaras ya son legibles
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Cámara ${i + 1}` }))
      );
    } catch {
      // sin lista: se sigue con la cámara actual
    }
  }, []);

  const switchCamera = useCallback(
    async (id: string) => {
      setDeviceId(id);
      try {
        if (id) localStorage.setItem("ortosend.cameraId", id);
        else localStorage.removeItem("ortosend.cameraId");
      } catch {}
      try {
        await openCamera(id);
      } catch {
        setFatal("No se pudo abrir esa cámara. Prueba con otra de la lista.");
      }
    },
    [openCamera]
  );

  const start = useCallback(async () => {
    primeBeeps();
    setOpen(true);
    setPhase("init");
    setFatal(null);
    setPoseState("cargando");
    try {
      await openCamera(deviceId);
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
  }, [deviceId, loop, openCamera]);

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
      void beep("stop");
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
    [beep]
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
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => finishRecording(mime);
      rec.start(250);
      setBeeped(false);
      beepTimerRef.current = setTimeout(() => {
        beepTimerRef.current = null;
        void beep("start");
        // la señal visual, alineada con el momento en que se oye el tono
        setTimeout(() => setBeeped(true), BEEP_LEAD_MS);
      }, Math.max(0, START_BEEP_DELAY_MS - BEEP_LEAD_MS));
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
  }, [beep, finishRecording, guide.seconds]);

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
    // No vuelve a arrancar solo hasta que los checks pasen por rojo otra vez
    armedRef.current = false;
    setPhase("live");
  }, [clearTimers]);

  useEffect(() => {
    autoRecordRef.current = () =>
      guide.mode === "video"
        ? runCountdown(VIDEO_PREROLL_SECONDS, record)
        : takePhotoRef.current(); // fotos: disparo inmediato, sin cuenta atrás
  }, [guide.mode, runCountdown, record]);

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
    // Foto posterior: línea de Helbing con los puntos del mismo frame
    const helbing =
      kind === "foto_posterior" ? computeHelbing(lastLmsRef.current, c.width, c.height) : null;
    c.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
        reviewUrlRef.current = url;
        setReview({
          blob,
          url,
          mime: "image/jpeg",
          seconds: 0,
          validPct: null,
          validSeconds: null,
          helbing,
        });
        setPhase("review");
      },
      "image/jpeg",
      0.85
    );
  }, [kind]);

  // Fotos: sin cuenta atrás. Disparan solas en cuanto la app ve los dos pies de
  // cerca (mismo mecanismo de estabilidad que los vídeos); si el análisis de
  // pose no está disponible, solo queda el botón manual.

  useEffect(() => {
    takePhotoRef.current = takePhoto;
  }, [takePhoto]);

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
        mime: review.mime,
        pose: poseState === "activo" ? "pose_landmarker_lite" : "no_disponible",
        helbing: review.helbing ?? undefined,
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
  }, [caseId, close, guide.seconds, kind, nextHref, poseState, review, router]);

  const retake = useCallback(() => {
    clearTimers();
    // Vuelve a exigir ~1 s estable en verde antes de arrancar solo otra vez
    okHistRef.current = [];
    armedRef.current = true;
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
            : "📷 Abrir la cámara y hacer la foto"
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

  return (
    <div className="studio" role="dialog" aria-label={`Estudio de captura: ${label}`}>
      <div className={`studio-head ${phase === "recording" ? "recording" : ""}`}>
        <b>
          {phase === "recording" && <span className="studio-rec-badge">● GRABANDO</span>}
          {label}
        </b>
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
          <div
            className={`studio-stage ${phase === "recording" ? "recording" : ""}`}
            style={{ display: phase === "review" ? "none" : undefined }}
          >
            <video ref={videoRef} playsInline muted />
            <canvas ref={canvasRef} />
            {phase === "countdown" && (
              <div className="studio-count" aria-live="assertive">
                <div className="n">{countdown}</div>
                <div className="t">
                  {isVideo
                    ? "La grabación empieza en… el paciente espera quieto y arranca con el pitido"
                    : "Foto en… mantén el móvil quieto"}
                </div>
              </div>
            )}
            {phase === "recording" && (
              <>
                <div className="studio-rec" aria-live="polite">
                  <span className="dot" /> GRABANDO
                </div>
                {beeped && elapsed < 2.2 && <div className="studio-go">¡YA! · a andar</div>}
                <div className="studio-remaining">
                  <div className="n">{Math.ceil(remaining)}</div>
                  <div className="t">
                    segundos · de {guide.seconds} s
                  </div>
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
                <div className="studio-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={review.url} alt={`Previsualización: ${label}`} />
                  {review.helbing && <HelbingOverlay hb={review.helbing} />}
                </div>
              )}
            </div>
          )}

          <div className="studio-side">
            {phase !== "review" && (
              <>
                {camMuted && (
                  <div className="note r" style={{ marginBottom: 10 }}>
                    <b>La cámara no envía imagen.</b> Suele ser la tecla o el interruptor de
                    privacidad de la cámara, el bloqueo en los ajustes de privacidad del sistema,
                    o que otro programa la está usando. Si aparece un icono de cámara tachada, el
                    navegador ha elegido una cámara virtual: escoge la webcam real abajo.
                  </div>
                )}
                {devices.length > 1 && (
                  <div style={{ marginBottom: 12 }}>
                    <div className="tiny">CÁMARA</div>
                    <select
                      className="studio-select"
                      value={deviceId}
                      onChange={(e) => void switchCamera(e.target.value)}
                      disabled={phase === "recording" || phase === "countdown"}
                    >
                      <option value="">Automática (trasera en el móvil)</option>
                      {devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
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
                    ? `Cuenta atrás de ${VIDEO_PREROLL_SECONDS} s y grabación fija de ${guide.seconds} s (corte automático). El pitido de salida suena medio segundo después de empezar a grabar, para captar el arranque desde parado; otro tono grave avisa del final. Los checks solo hacen falta para arrancar; durante la grabación no se exige nada.`
                    : guide.checks.length > 0
                      ? "La foto se dispara sola, al instante y sin cuenta atrás, en cuanto la app ve los dos pies de cerca con la orientación correcta."
                      : "Sin comprobación automática: pulsa el botón para hacer la foto."}
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
                    {allOk ? `● Grabar ${guide.seconds} s ahora` : "Ajusta el encuadre para grabar"}
                  </button>
                )}
                {phase === "live" && isVideo && poseState === "activo" && (
                  <div className="tiny" style={{ marginTop: 6 }}>
                    No hay que pulsar nada: con todos los checks en verde durante un segundo la
                    cuenta atrás arranca sola y graba.
                  </div>
                )}
                {phase === "live" && !isVideo && (
                  <>
                    <button
                      type="button"
                      className={allOk ? "pri wfull" : "wfull"}
                      onClick={takePhoto}
                    >
                      {allOk ? "📷 Hacer la foto ahora" : "📷 Hacer la foto sin comprobar"}
                    </button>
                    {poseState === "activo" && guide.checks.length > 0 && (
                      <div className="tiny" style={{ marginTop: 6 }}>
                        Se dispara sola cuando ve los dos pies de cerca. Si no consigue detectarlos
                        (poca luz, calcetines, encuadre muy cerrado), usa el botón.
                      </div>
                    )}
                  </>
                )}
                {phase === "countdown" && (
                  <button type="button" className="wfull" onClick={cancelCountdown}>
                    Cancelar cuenta atrás
                  </button>
                )}
                {phase === "recording" && (
                  <>
                    <div className="note r studio-rec-note">
                      <b>● Grabando…</b> quedan {Math.ceil(remaining)} s. No toques el móvil: se corta
                      sola al llegar a {guide.seconds} s.
                    </div>
                    <div className="sp" />
                    <button type="button" className="dang wfull" onClick={stopRecording}>
                      ■ Parar antes de tiempo
                    </button>
                  </>
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
                      Encuadre válido (informativo): {review.validSeconds.toFixed(1)} s
                      {review.validPct !== null ? ` · ${review.validPct}% de los frames` : ""} ·{" "}
                    </>
                  )}
                  Tamaño: {(review.blob.size / 1024 / 1024).toFixed(2)} MB
                </div>
                {kind === "foto_posterior" && (
                  <div className={`note ${review.helbing ? "" : "a"}`} style={{ marginTop: 8 }}>
                    {review.helbing ? (
                      <>
                        <b>Línea de Helbing</b> (orientativa, calculada con los puntos de pose):{" "}
                        {helbingResumen(review.helbing)}. Se guarda con la foto y la verán
                        prescriptor y taller.
                      </>
                    ) : (
                      "No se ha podido calcular la línea de Helbing (no se detectaron tobillos y talones al disparar). La foto se guarda igual; repite si quieres que salga."
                    )}
                  </div>
                )}
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
                  <button
                    type="button"
                    className="pri"
                    onClick={upload}
                    disabled={tooBig}
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
