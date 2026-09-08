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
import { computeHelbing, computePerthes, helbingResumen, type Helbing } from "@/lib/helbing";
import { HelbingOverlay } from "@/components/caso/helbing-overlay";
import { MARCHA_IDX, analizarMarcha, type MarchaFrame, type MarchaInforme, type MarchaTrack } from "@/lib/marcha";
import { InformeMarcha } from "@/components/caso/video-analizado";

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
// Zoom de seguimiento (solo durante la grabación): fracción del alto del
// cuadro que debe ocupar el paciente, constante de tiempo del suavizado y
// velocidad máxima de cambio del zoom (relativa, por segundo) para que la
// imagen se acerque de forma progresiva, sin tirones.
const ZOOM_FILL = 0.85;
const ZOOM_TAU_S = 0.6;
const ZOOM_MAX_RATE = 0.7;

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

// Orientación de la imagen. Con la cámara en el extremo superior del móvil, para
// dejarla a la altura del suelo el teléfono acaba boca abajo o de lado, y el
// modelo de pose no detecta bien personas giradas. Se prueban las cuatro
// rotaciones hasta detectar, y la anatomía (tobillos por encima de talones,
// caderas por encima de tobillos) decide cuál es "arriba". Todo el análisis y la
// foto guardada van ya enderezados.
type Rot = 0 | 90 | 180 | 270;
const ROT_RETRY_MS = 800; // sin detección durante este tiempo → probar la siguiente rotación

// Pinta el frame girado `r` grados en sentido horario en un canvas de tamaño
// (w,h) ya intercambiado si procede.
function drawRotated(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, r: Rot, w: number, h: number) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
  ctx.restore();
}

// Punto normalizado del frame enderezado → coordenadas del frame original
// (para dibujar el esqueleto sobre el vídeo tal y como lo da la cámara).
function toOriginal(p: { x: number; y: number }, r: Rot): { x: number; y: number } {
  switch (r) {
    case 90:
      return { x: p.y, y: 1 - p.x };
    case 180:
      return { x: 1 - p.x, y: 1 - p.y };
    case 270:
      return { x: 1 - p.y, y: p.x };
    default:
      return p;
  }
}

// > 0 si la persona está cabeza arriba en el frame analizado, < 0 si está
// invertida. Suma de pares (arriba, abajo) visibles: cadera→tobillo, rodilla→
// tobillo, tobillo→talón.
function uprightScore(lms: NormalizedLandmark[]): number {
  const vis = (i: number) => lms[i]?.visibility ?? 0;
  const pares: [number, number][] = [
    [L_HIP, L_ANKLE], [R_HIP, R_ANKLE],
    [L_KNEE, L_ANKLE], [R_KNEE, R_ANKLE],
    [L_ANKLE, L_HEEL], [R_ANKLE, R_HEEL],
  ];
  let s = 0;
  for (const [up, down] of pares) {
    if (vis(up) < 0.4 || vis(down) < 0.4) continue;
    s += Math.sign(lms[down].y - lms[up].y);
  }
  return s;
}

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
  // Pies (fotos de cerca). Desde atrás los dedos quedan tapados por el talón y
  // desde delante el talón queda tapado por el pie, así que solo se exige lo que
  // realmente se ve en cada vista: tobillos + talones (posterior) o tobillos +
  // dedos (anterior). La anchura que ocupan en la imagen se mide con los puntos
  // de pie que estén bien detectados (de cerca, los dos pies llenan el ancho).
  const V = 0.45;
  const tobillos = Math.min(vis(L_ANKLE), vis(R_ANKLE)) > V;
  const talones = Math.min(vis(L_HEEL), vis(R_HEEL)) > V;
  const dedos = Math.min(vis(L_FOOT), vis(R_FOOT)) > V;
  const piesVisibles = tobillos && (talones || dedos);
  const feetPts = [L_ANKLE, R_ANKLE, L_HEEL, R_HEEL, L_FOOT, R_FOOT].filter((i) => vis(i) > V);
  const feetXs = feetPts.map((i) => lms[i].x);
  const footSpan = feetXs.length ? Math.max(...feetXs) - Math.min(...feetXs) : 0;
  const feetBottom = feetPts.length ? Math.max(...feetPts.map((i) => lms[i].y)) : 1;
  return {
    persona,
    cintura_a_pies: cinturaAPies,
    perfil,
    lado_dcho: perfil && zR < zL - sideMargin,
    lado_izq: perfil && zL < zR - sideMargin,
    de_frente: abierto && izqEnDerechaImagen,
    de_espaldas: abierto && !izqEnDerechaImagen,
    pies_visibles: piesVisibles,
    pies_de_cerca: piesVisibles && footSpan > 0.3 && feetBottom < 0.97,
    // Orientación por el lado en que cae cada pie (MediaPipe etiqueta izquierdo/
    // derecho del paciente): desde atrás el pie izquierdo del paciente queda a la
    // izquierda de la imagen y se ven los talones; desde delante queda a la
    // derecha y se ven los dedos.
    pies_desde_atras: tobillos && talones && lms[L_HEEL].x < lms[R_HEEL].x,
    pies_de_frente: tobillos && dedos && lms[L_FOOT].x > lms[R_FOOT].x,
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
  perthes?: Helbing | null; // foto posterior: ángulo del calcáneo (regla de Perthes)
  marcha?: { track: MarchaTrack; informe: MarchaInforme } | null; // vídeos posterior/anterior
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
  // Rotación del frame para el análisis y la foto (ver drawRotated)
  const rotRef = useRef<{ r: Rot; missingSince: number; flipVotes: number }>({ r: 0, missingSince: 0, flipVotes: 0 });
  const rotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rotation, setRotation] = useState<Rot>(0);
  // Zoom de seguimiento (marchas en el eje del pasillo). "camara": zoom real de
  // la cámara vía applyConstraints; "digital": recorte del frame alrededor del
  // paciente, reescalado, que es lo que se graba.
  const [follow, setFollow] = useState<boolean>(!!guide.followZoom);
  const [zoomMode, setZoomMode] = useState<"camara" | "digital">("digital");
  const followRef = useRef(!!guide.followZoom);
  const zoomCapsRef = useRef<{ min: number; max: number; step: number } | null>(null);
  const zoomCurRef = useRef(1);
  const zoomLastApplyRef = useRef(0);
  const zoomLastTickRef = useRef(0);
  const zoomBusyRef = useRef(false); // applyConstraints pendiente
  const followRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const followCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastSeenRef = useRef(0);
  // Trayectoria de puntos guardada con el vídeo (análisis de marcha)
  const trackRef = useRef<MarchaFrame[]>([]);
  const trackLastRef = useRef(0);
  const trackDimsRef = useRef({ w: 0, h: 0, digital: false });
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);
  // Linterna (flash en modo antorcha, encendido continuo). Solo donde el
  // navegador lo permite (Android/Chrome con cámara trasera); iOS no lo expone.
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
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
      const rot = rotRef.current;
      if (lm && video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        const now = performance.now();
        try {
          // Fuente del análisis: el vídeo tal cual, o el frame girado si hace falta
          let source: HTMLVideoElement | HTMLCanvasElement = video;
          if (rot.r !== 0) {
            const rc = (rotCanvasRef.current ??= document.createElement("canvas"));
            const rw = rot.r === 180 ? video.videoWidth : video.videoHeight;
            const rh = rot.r === 180 ? video.videoHeight : video.videoWidth;
            if (rc.width !== rw || rc.height !== rh) {
              rc.width = rw;
              rc.height = rh;
            }
            const rctx = rc.getContext("2d");
            if (rctx) {
              drawRotated(rctx, video, rot.r, rw, rh);
              source = rc;
            }
          }
          const res = lm.detectForVideo(source, now);
          lms = res.landmarks[0];
          lastLmsRef.current = lms ?? null;
        } catch {
          // un frame fallido no rompe el estudio
        }
        // Búsqueda de la orientación correcta
        if (!lms) {
          if (!rot.missingSince) rot.missingSince = now;
          else if (now - rot.missingSince > ROT_RETRY_MS && phaseRef.current === "live") {
            rot.r = ((rot.r + 90) % 360) as Rot;
            rot.missingSince = now;
            rot.flipVotes = 0;
            setRotation(rot.r);
          }
        } else {
          rot.missingSince = 0;
          if (uprightScore(lms) < 0) {
            rot.flipVotes++;
            if (rot.flipVotes >= 4 && phaseRef.current === "live") {
              rot.r = ((rot.r + 180) % 360) as Rot;
              rot.flipVotes = 0;
              okHistRef.current = [];
              setRotation(rot.r);
              lms = undefined; // este frame estaba invertido: no se evalúa
            }
          } else rot.flipVotes = 0;
        }
        // Zoom de seguimiento. ANTES de grabar no se toca el zoom: con la imagen
        // acercada el modelo no detecta bien a la persona y los checks fallan.
        // Al empezar a grabar el zoom entra de forma progresiva (suavizado con
        // constante de tiempo y tope de velocidad, sin tirones) para que el
        // paciente ocupe el máximo posible del cuadro; si se pierde, se abre
        // despacio. Al volver al directo se vuelve al plano general.
        if (followRef.current && guide.followZoom && ["live", "countdown", "recording"].includes(phaseRef.current)) {
          const pts = lms?.filter((q) => (q.visibility ?? 0) > 0.4) ?? [];
          if (pts.length >= 4) lastSeenRef.current = now;
          const rec = phaseRef.current === "recording";
          const dt = Math.min(0.1, zoomLastTickRef.current ? (now - zoomLastTickRef.current) / 1000 : 0.033);
          zoomLastTickRef.current = now;
          const tau = rec ? ZOOM_TAU_S : 0.35;
          const alpha = 1 - Math.exp(-dt / tau);
          const maxRel = (rec ? ZOOM_MAX_RATE : 1.5) * dt;
          // Acercamiento suavizado con tope de cambio relativo por segundo
          const approach = (cur: number, target: number) => {
            const d = (target - cur) * alpha;
            const lim = Math.max(1e-6, Math.abs(cur)) * maxRel;
            return cur + Math.max(-lim, Math.min(lim, d));
          };
          const caps = zoomCapsRef.current;
          if (caps) {
            // Zoom real de la cámara
            let target = caps.min;
            if (rec && pts.length >= 4) {
              const hFrac = Math.max(...pts.map((q) => q.y)) - Math.min(...pts.map((q) => q.y));
              if (hFrac > 0.02) {
                // zona muerta alrededor del tamaño objetivo: el zoom no "caza"
                const fuera = hFrac < ZOOM_FILL - 0.06 || hFrac > ZOOM_FILL + 0.06;
                const wanted = fuera ? zoomCurRef.current * (ZOOM_FILL / hFrac) : zoomCurRef.current;
                target = Math.min(caps.max, Math.max(caps.min, wanted));
              } else target = zoomCurRef.current;
            } else if (rec && now - lastSeenRef.current < 1500) target = zoomCurRef.current; // breve pérdida: mantener
            zoomCurRef.current = approach(zoomCurRef.current, target);
            const track = streamRef.current?.getVideoTracks()[0];
            if (track && !zoomBusyRef.current && now - zoomLastApplyRef.current > 100) {
              const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
              const applied = settings.zoom ?? caps.min;
              // en múltiplos del paso de la cámara, para no pedir valores inválidos
              const q = Math.min(caps.max, Math.max(caps.min, Math.round((zoomCurRef.current - caps.min) / caps.step) * caps.step + caps.min));
              if (Math.abs(q - applied) >= caps.step * 0.99) {
                zoomLastApplyRef.current = now;
                zoomBusyRef.current = true;
                track
                  .applyConstraints({ advanced: [{ zoom: q } as MediaTrackConstraintSet] })
                  .catch(() => {})
                  .finally(() => {
                    zoomBusyRef.current = false;
                  });
              }
            }
          } else {
            // Zoom digital: recorte alrededor del paciente (lo que se graba)
            const srcW = rot.r === 0 || rot.r === 180 ? video.videoWidth : video.videoHeight;
            const srcH = rot.r === 0 || rot.r === 180 ? video.videoHeight : video.videoWidth;
            const aspect = srcW / srcH;
            const cur = followRectRef.current ?? { x: 0, y: 0, w: srcW, h: srcH };
            let tw = srcW, th = srcH, tx = 0, ty = 0;
            if (rec && pts.length >= 4) {
              const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
              const bh = (Math.max(...ys) - Math.min(...ys)) * srcH;
              // zona muerta: si ya ocupa aprox. el objetivo, se mantiene el tamaño
              const fillNow = cur.h > 0 ? bh / cur.h : 0;
              const fuera = fillNow < ZOOM_FILL - 0.06 || fillNow > ZOOM_FILL + 0.06;
              th = fuera ? Math.min(srcH, Math.max(bh / ZOOM_FILL, srcH * 0.25)) : cur.h;
              tw = th * aspect;
              if (tw > srcW) { tw = srcW; th = tw / aspect; }
              const cx = ((Math.max(...xs) + Math.min(...xs)) / 2) * srcW;
              const cy = ((Math.max(...ys) + Math.min(...ys)) / 2) * srcH;
              tx = Math.min(srcW - tw, Math.max(0, cx - tw / 2));
              ty = Math.min(srcH - th, Math.max(0, cy - th / 2));
            } else if (rec && now - lastSeenRef.current < 1500 && followRectRef.current) {
              ({ x: tx, y: ty, w: tw, h: th } = followRectRef.current);
            }
            // tamaño con tope de velocidad; el centro sigue al paciente suavizado
            const nh = Math.min(srcH, approach(cur.h, th));
            const nw = Math.min(srcW, nh * aspect);
            const ccx = cur.x + cur.w / 2 + (tx + tw / 2 - (cur.x + cur.w / 2)) * alpha;
            const ccy = cur.y + cur.h / 2 + (ty + th / 2 - (cur.y + cur.h / 2)) * alpha;
            cur.w = nw;
            cur.h = nw / aspect;
            cur.x = Math.min(srcW - cur.w, Math.max(0, ccx - cur.w / 2));
            cur.y = Math.min(srcH - cur.h, Math.max(0, ccy - cur.h / 2));
            followRectRef.current = cur;
            const fc = followCanvasRef.current;
            if (fc) {
              if (fc.width !== srcW || fc.height !== srcH) {
                fc.width = srcW;
                fc.height = srcH;
              }
              const fctx = fc.getContext("2d");
              const src: CanvasImageSource = rot.r === 0 ? video : rotCanvasRef.current ?? video;
              fctx?.drawImage(src, cur.x, cur.y, cur.w, cur.h, 0, 0, srcW, srcH);
            }
          }
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
          // Trayectoria de puntos (≤ 15 fps) en coordenadas del vídeo GRABADO
          if (guide.analisis && lms && now - trackLastRef.current >= 66) {
            trackLastRef.current = now;
            const td = trackDimsRef.current;
            const cur = followRectRef.current;
            const pts: number[] = [];
            for (const idx of MARCHA_IDX) {
              const q = lms[idx];
              let x = q.x, y = q.y;
              if (td.digital && cur && td.w && td.h) {
                // el vídeo grabado es el recorte de seguimiento: reproyectar
                x = (q.x * td.w - cur.x) / cur.w;
                y = (q.y * td.h - cur.y) / cur.h;
              }
              pts.push(x, y, q.visibility ?? 0);
            }
            trackRef.current.push({ t: (now - recStartRef.current) / 1000, p: pts });
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
          // esqueleto detectado sobre el paciente real (fino y translúcido),
          // devuelto a las coordenadas del vídeo tal y como lo da la cámara
          if (lms) {
            const orig = lms.map((p) => ({ ...toOriginal(p, rot.r), visibility: p.visibility }));
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
              const pa = orig[a], pb = orig[b];
              if ((pa?.visibility ?? 0) < 0.4 || (pb?.visibility ?? 0) < 0.4) continue;
              ctx.beginPath();
              ctx.moveTo(pa.x * w, pa.y * h);
              ctx.lineTo(pb.x * w, pb.y * h);
              ctx.stroke();
            }
            for (const p of orig) {
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
      // ¿Permite linterna? (torch en getCapabilities). Si la tenía activada, se reactiva.
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        torch?: boolean;
        zoom?: { min: number; max: number; step?: number };
      };
      const hasTorch = !!caps.torch;
      // Zoom real de la cámara, si el navegador lo expone (Android/Chrome)
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        zoomCapsRef.current = { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 };
        const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
        zoomCurRef.current = settings.zoom ?? caps.zoom.min;
        setZoomMode("camara");
      } else {
        zoomCapsRef.current = null;
        setZoomMode("digital");
      }
      followRectRef.current = null;
      setTorchAvailable(hasTorch);
      let wantTorch = false;
      try {
        wantTorch = localStorage.getItem("ortosend.torch") === "1";
      } catch {}
      if (hasTorch && wantTorch) {
        track
          .applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] })
          .then(() => setTorchOn(true))
          .catch(() => setTorchOn(false));
      } else setTorchOn(false);
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
    rotRef.current = { r: 0, missingSince: 0, flipVotes: 0 };
    setRotation(0);
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

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
      try {
        localStorage.setItem("ortosend.torch", next ? "1" : "0");
      } catch {}
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

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
          // Fotos de los pies: solo hay pies y parte de la pierna en plano, y el
          // modelo (entrenado con cuerpos enteros) detecta con menos confianza.
          minPoseDetectionConfidence: guide.mode === "photo" ? 0.25 : 0.5,
          minPosePresenceConfidence: guide.mode === "photo" ? 0.25 : 0.5,
          minTrackingConfidence: guide.mode === "photo" ? 0.25 : 0.5,
        });
      landmarkerRef.current = await make("GPU").catch(() => make("CPU"));
      setPoseState("activo");
    } catch {
      setPoseState("sin_pose");
    }
  }, [deviceId, guide.mode, loop, openCamera]);

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
      // Análisis preliminar de marcha con la trayectoria guardada
      let marcha: Review["marcha"] = null;
      if (guide.analisis && trackRef.current.length >= 5) {
        const td = trackDimsRef.current;
        const track: MarchaTrack = {
          vista: kind === "video_ant_descalzo" ? "anterior" : "posterior",
          w: td.w || 1280,
          h: td.h || 720,
          frames: trackRef.current,
        };
        marcha = { track, informe: analizarMarcha(track) };
      }
      setReview({
        blob,
        url,
        mime: mime.split(";")[0],
        seconds,
        validPct: total > 0 ? Math.round((100 * valid) / total) : null,
        validSeconds: total > 0 ? Math.round(validMs / 100) / 10 : null,
        marcha,
      });
      setPhase("review");
    },
    [beep, guide.analisis, kind]
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
      // Con el móvil girado se graba el frame enderezado (canvas) en vez del
      // flujo crudo; con el móvil derecho, el flujo de la cámara tal cual.
      const rc = rotCanvasRef.current;
      const fc = followCanvasRef.current;
      const digitalFollow = followRef.current && guide.followZoom && !zoomCapsRef.current && fc;
      const src = digitalFollow
        ? fc.captureStream(30) // recorte de seguimiento (zoom digital)
        : rotRef.current.r !== 0 && rc
          ? rc.captureStream(30)
          : stream;
      trackRef.current = [];
      trackLastRef.current = 0;
      {
        const v = videoRef.current;
        const r = rotRef.current.r;
        const sw = v ? (r === 0 || r === 180 ? v.videoWidth : v.videoHeight) : 0;
        const sh = v ? (r === 0 || r === 180 ? v.videoHeight : v.videoWidth) : 0;
        trackDimsRef.current = { w: sw, h: sh, digital: !!digitalFollow };
      }
      const rec = new MediaRecorder(src, { mimeType: mime, videoBitsPerSecond: 2_000_000 });
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
  }, [beep, finishRecording, guide.followZoom, guide.seconds]);

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
    // La foto se guarda ya enderezada (misma rotación con la que se analizó)
    const r = rotRef.current.r;
    const c = document.createElement("canvas");
    c.width = r === 0 || r === 180 ? video.videoWidth : video.videoHeight;
    c.height = r === 0 || r === 180 ? video.videoHeight : video.videoWidth;
    const cctx = c.getContext("2d");
    if (cctx) drawRotated(cctx, video, r, c.width, c.height);
    // Foto posterior: línea de Helbing y ángulo de Perthes con los puntos del mismo frame
    const helbing =
      kind === "foto_posterior" ? computeHelbing(lastLmsRef.current, c.width, c.height) : null;
    const perthes =
      kind === "foto_posterior" ? computePerthes(lastLmsRef.current, c.width, c.height) : null;
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
          perthes,
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
        perthes: review.perthes ?? undefined,
        marcha: review.marcha ?? undefined,
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
            {/* Zoom digital de seguimiento: lo que realmente se graba */}
            <div
              className="studio-follow"
              hidden={!(follow && guide.followZoom && zoomMode === "digital" && phase !== "review")}
            >
              <canvas ref={followCanvasRef} />
              <span>Lo que se graba</span>
            </div>
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
            <div className={`studio-stage ${review.helbing && review.perthes ? "dual" : ""}`}>
              {isVideo ? (
                <video src={review.url} controls playsInline />
              ) : review.helbing || review.perthes ? (
                // De la única foto salen dos imágenes: Helbing y Perthes por separado
                <>
                  {review.helbing && (
                    <div className="studio-photo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={review.url} alt="Línea de Helbing" />
                      <HelbingOverlay hb={review.helbing} />
                      <div className="studio-photo-cap">Línea de Helbing</div>
                    </div>
                  )}
                  {review.perthes && (
                    <div className="studio-photo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={review.url} alt="Regla de Perthes" />
                      <HelbingOverlay pt={review.perthes} />
                      <div className="studio-photo-cap">Regla de Perthes</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="studio-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={review.url} alt={`Previsualización: ${label}`} />
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
                {torchAvailable && (
                  <button
                    type="button"
                    className={`wfull studio-torch ${torchOn ? "on" : ""}`}
                    onClick={() => void toggleTorch()}
                    style={{ marginBottom: 10 }}
                  >
                    🔦 Linterna {torchOn ? "encendida (se queda fija)" : "apagada"}
                  </button>
                )}
                {guide.followZoom && (
                  <button
                    type="button"
                    className={`wfull studio-torch ${follow ? "on" : ""}`}
                    onClick={() => setFollow((f) => !f)}
                    disabled={phase === "recording"}
                    style={{ marginBottom: 10 }}
                  >
                    🔍 Zoom de seguimiento {follow ? "activado" : "desactivado"}
                    {follow ? (zoomMode === "camara" ? " · zoom de la cámara" : " · digital") : ""}
                  </button>
                )}
                {rotation !== 0 && (
                  <div className="tiny" style={{ marginBottom: 8 }}>
                    Móvil girado {rotation}°: la app analiza y guarda la imagen enderezada.
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
                {isVideo && guide.analisis && (
                  review.marcha ? (
                    <InformeMarcha informe={review.marcha.informe} />
                  ) : (
                    <div className="note a" style={{ marginTop: 8 }}>
                      No se han detectado suficientes puntos durante la grabación para el informe
                      preliminar de marcha. El vídeo se guarda igual.
                    </div>
                  )
                )}
                {kind === "foto_posterior" && (
                  <div className={`note ${review.helbing || review.perthes ? "" : "a"}`} style={{ marginTop: 8 }}>
                    {review.helbing || review.perthes ? (
                      <>
                        <b>Retropié</b> (orientativo, con los puntos de pose):
                        {review.helbing && (
                          <>
                            <br />
                            Línea de Helbing (tendón de Aquiles): {helbingResumen(review.helbing)}
                          </>
                        )}
                        {review.perthes && (
                          <>
                            <br />
                            Regla de Perthes (eje del calcáneo): {helbingResumen(review.perthes)}
                          </>
                        )}
                        <br />
                        De esta única foto salen las dos imágenes (Helbing y Perthes); se guardan
                        con ella y las verán prescriptor y taller.
                      </>
                    ) : (
                      "No se han podido calcular las líneas del retropié (no se detectaron tobillos y talones al disparar). La foto se guarda igual; repite si quieres que salgan."
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
