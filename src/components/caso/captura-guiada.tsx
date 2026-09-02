"use client";

// Modo captura guiado: cámara con silueta de encuadre, comprobación automática del
// paciente (pose, MediaPipe vía CDN con fallback manual), cuenta atrás, foto o
// grabación (MediaRecorder) y subida con confirmación del servidor.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PASOS_CAPTURA, type Orientacion, type PasoCaptura } from "@/lib/captura-pasos";

type Landmark = { x: number; y: number; z: number; visibility?: number };
type Landmarker = {
  detectForVideo: (v: HTMLVideoElement, ts: number) => { landmarks: Landmark[][] };
  close?: () => void;
};

const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODELO =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const MAX_BYTES = 4 * 1024 * 1024;

// Import dinámico en tiempo de ejecución (URL externa): opaco para el bundler.
const importarUrl = (u: string) =>
  (new Function("u", "return import(u)") as (u: string) => Promise<unknown>)(u);

async function cargarLandmarker(): Promise<Landmarker> {
  const vision = (await importarUrl(CDN)) as {
    FilesetResolver: { forVisionTasks: (p: string) => Promise<unknown> };
    PoseLandmarker: {
      createFromOptions: (f: unknown, o: unknown) => Promise<Landmarker>;
    };
  };
  const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  return vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODELO, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

// Etiquetas de "Lo que debe verse" por orientación (mismo orden que evaluar()).
function etiquetas(o: Orientacion): string[] {
  return [
    o === "frontal" ? "Se ve el cuerpo entero, cara incluida" : "Se ve el cuerpo entero, de la cabeza a los pies",
    o === "lateral" ? "Se ve el pie de apoyo, con talón y punta" : "Se ven los dos pies, con talones y puntas",
    o === "frontal" ? "El paciente está de frente" : o === "posterior" ? "El paciente está de espaldas" : "El paciente está de perfil",
    "Está lo bastante cerca (llena al menos media pantalla)",
  ];
}

// Índices BlazePose: 0 nariz, 2/5 ojos, 7/8 orejas, 11/12 hombros, 23/24 caderas,
// 27/28 tobillos, 29/30 talones, 31/32 puntas.
function evaluar(lms: Landmark[] | null, o: Orientacion): boolean[] {
  const vis = (i: number) => {
    const l = lms?.[i];
    return !!l && (l.visibility ?? 1) > 0.5 && l.x > 0.02 && l.x < 0.98 && l.y > 0.02 && l.y < 0.98;
  };
  if (!lms || lms.length === 0) return [false, false, false, false];
  const cabeza = o === "frontal" ? vis(0) && (vis(2) || vis(5)) : vis(0) || vis(7) || vis(8);
  const cuerpo = cabeza && vis(27) && vis(28);
  const pies =
    o === "lateral"
      ? (vis(29) || vis(30)) && (vis(31) || vis(32))
      : vis(29) && vis(30) && vis(31) && vis(32);
  const dx = (lms[11]?.x ?? 0) - (lms[12]?.x ?? 0);
  const orient = o === "frontal" ? dx > 0.04 : o === "posterior" ? dx < -0.04 : Math.abs(dx) < 0.06;
  const ys = lms.filter((l) => (l.visibility ?? 1) > 0.5).map((l) => l.y);
  const cerca = ys.length > 3 && Math.max(...ys) - Math.min(...ys) >= 0.5;
  return [cuerpo, pies, orient, cerca];
}

// Silueta de encuadre (figura de palo, como en la guía del protocolo).
function Silueta({ o, modo }: { o: Orientacion; modo: "foto" | "video" }) {
  const marcha = modo === "video" && o !== "frontal";
  return (
    <svg className="cap-silueta" viewBox="0 0 200 400" aria-hidden>
      <g stroke="#6ee0c8" strokeWidth="5" fill="none" strokeLinecap="round">
        <circle cx="100" cy="52" r="27" />
        {o === "frontal" && (
          <g stroke="none" fill="#6ee0c8">
            <circle cx="91" cy="46" r="3.4" />
            <circle cx="109" cy="46" r="3.4" />
            <path d="M89 60 Q100 69 111 60" stroke="#6ee0c8" strokeWidth="4" fill="none" />
          </g>
        )}
        <path d="M100 79 L100 205" />
        {marcha ? (
          <>
            <path d="M100 115 L64 178" />
            <path d="M100 115 L138 172" />
            <path d="M100 205 L66 330" />
            <path d="M100 205 L134 330" />
            <path d="M56 336 L80 336" />
            <path d="M124 336 L148 336" />
          </>
        ) : (
          <>
            <path d="M100 108 L56 176" />
            <path d="M100 108 L144 176" />
            <path d="M100 205 L92 332" />
            <path d="M100 205 L108 332" />
            <path d="M80 338 L104 338" />
            <path d="M96 338 L120 338" />
          </>
        )}
      </g>
    </svg>
  );
}

type Fase =
  | "camara"
  | "buscando"
  | "cuenta"
  | "grabando"
  | "subiendo"
  | "confirmado"
  | "error";

export function CapturaGuiada({
  caseId,
  paso,
  hechos,
}: {
  caseId: string;
  paso: PasoCaptura;
  hechos: string[]; // kinds ya confirmadas por el servidor
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<Landmarker | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const estableDesdeRef = useRef<number | null>(null);
  const finCuentaRef = useRef(0);
  const finGrabRef = useRef(0);
  const manualRef = useRef(false);
  const faseRef = useRef<Fase>("camara");
  const vivoRef = useRef(true);

  const [fase, setFaseEstado] = useState<Fase>("camara");
  const [checks, setChecks] = useState<boolean[]>([false, false, false, false]);
  const [deteccion, setDeteccion] = useState<"cargando" | "activa" | "no">("cargando");
  const [restante, setRestante] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewEsVideo, setPreviewEsVideo] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const setFase = useCallback((f: Fase) => {
    faseRef.current = f;
    setFaseEstado(f);
  }, []);

  const subir = useCallback(
    async (blob: Blob) => {
      if (blob.size > MAX_BYTES) {
        setErrMsg("La captura pesa demasiado (máx. 4 MB). Repite la toma.");
        setFase("buscando");
        return;
      }
      setPreviewEsVideo(paso.modo === "video");
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
      setFase("subiendo");
      try {
        const fd = new FormData();
        fd.set("kind", paso.kind);
        const ext = paso.modo === "foto" ? "jpg" : blob.type.includes("mp4") ? "mp4" : "webm";
        fd.set("file", blob, `${paso.kind}.${ext}`);
        const res = await fetch(`/api/casos/${caseId}/media`, { method: "POST", body: fd });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? "No se pudo confirmar la subida");
        // Si mientras subía se pulsó "Repetir", no pisamos ese estado.
        if (faseRef.current === "subiendo") setFase("confirmado");
        router.refresh();
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : "Fallo al subir — comprueba la conexión");
        if (faseRef.current === "subiendo") setFase("buscando");
      }
    },
    [caseId, paso.kind, paso.modo, router, setFase]
  );

  const capturarFoto = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const escala = Math.min(1, 1280 / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * escala);
    c.height = Math.round(v.videoHeight * escala);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((b) => b && subir(b), "image/jpeg", 0.85);
  }, [subir]);

  const empezarGrabacion = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)
    );
    try {
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_000_000 });
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime?.split(";")[0] ?? "video/webm" });
        if (vivoRef.current) subir(blob);
      };
      rec.start(1000);
      recorderRef.current = rec;
      finGrabRef.current = performance.now() + (paso.duracionS ?? 8) * 1000;
      setRestante(paso.duracionS ?? 8);
      setFase("grabando");
    } catch {
      setErrMsg("Este navegador no permite grabar vídeo (MediaRecorder)");
      setFase("error");
    }
  }, [paso.duracionS, setFase, subir]);

  const pararGrabacion = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    recorderRef.current = null;
  }, []);

  // Disparo manual (también cuando la comprobación automática no está disponible).
  const capturarManual = useCallback(() => {
    if (!["buscando", "camara"].includes(faseRef.current)) return;
    manualRef.current = true;
    finCuentaRef.current = performance.now() + 3000;
    setRestante(3);
    setFase("cuenta");
  }, [setFase]);

  const repetir = useCallback(() => {
    manualRef.current = false;
    estableDesdeRef.current = null;
    setErrMsg(null);
    setFase("buscando");
  }, [setFase]);

  const siguiente = useCallback(() => {
    const listos = new Set([...hechos, paso.kind]);
    const prox = PASOS_CAPTURA.find((p) => !listos.has(p.kind));
    router.push(prox ? `/caso/${caseId}?paso=${prox.paso}` : `/caso/${caseId}`);
  }, [caseId, hechos, paso.kind, router]);

  // Cámara + detector + bucle de comprobación.
  useEffect(() => {
    vivoRef.current = true;
    let intervalo: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!vivoRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => undefined);
        setFase("buscando");
      } catch {
        setErrMsg("No se pudo acceder a la cámara. Revisa los permisos del navegador.");
        setFase("error");
        return;
      }

      try {
        const lm = await cargarLandmarker();
        if (!vivoRef.current) {
          lm.close?.();
          return;
        }
        landmarkerRef.current = lm;
        setDeteccion("activa");
      } catch {
        setDeteccion("no"); // sin red al CDN o navegador sin WASM: modo manual
      }

      intervalo = setInterval(() => {
        const v = videoRef.current;
        const f = faseRef.current;
        const ahora = performance.now();

        if (f === "cuenta") {
          const resta = finCuentaRef.current - ahora;
          setRestante(Math.max(0, Math.ceil(resta / 1000)));
          if (resta <= 0) {
            manualRef.current = false;
            if (paso.modo === "foto") capturarFoto();
            else empezarGrabacion();
          }
          return;
        }
        if (f === "grabando") {
          const resta = finGrabRef.current - ahora;
          setRestante(Math.max(0, Math.ceil(resta / 1000)));
          if (resta <= 0) pararGrabacion();
          return;
        }
        if (f !== "buscando") return;

        const lm = landmarkerRef.current;
        if (!lm || !v || !v.videoWidth) return;
        let resultado: boolean[] = [false, false, false, false];
        try {
          const det = lm.detectForVideo(v, ahora);
          resultado = evaluar(det.landmarks?.[0] ?? null, paso.orientacion);
        } catch {
          /* frame no procesable: se reintenta en el siguiente tic */
        }
        setChecks(resultado);
        if (resultado.every(Boolean)) {
          if (estableDesdeRef.current == null) estableDesdeRef.current = ahora;
          if (ahora - estableDesdeRef.current > 1200) {
            finCuentaRef.current = ahora + 3000;
            setRestante(3);
            setFase("cuenta");
          }
        } else {
          estableDesdeRef.current = null;
        }
      }, 150);
    })();

    return () => {
      vivoRef.current = false;
      if (intervalo) clearInterval(intervalo);
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      recorderRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      landmarkerRef.current?.close?.();
      landmarkerRef.current = null;
    };
    // El componente se remonta por key={paso.paso}; el bucle depende solo del paso actual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso.paso]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const labels = etiquetas(paso.orientacion);
  const idx = PASOS_CAPTURA.findIndex((p) => p.kind === paso.kind);
  const enCurso = ["camara", "buscando", "cuenta", "grabando"].includes(fase);
  const personaVista = checks.some(Boolean);
  const estado =
    fase === "camara"
      ? "Encendiendo la cámara…"
      : fase === "cuenta"
      ? `Prepárate… ${restante || 1}`
      : fase === "grabando"
      ? `● Grabando — ${restante}s`
      : fase === "subiendo"
      ? "Subiendo al servidor…"
      : fase === "confirmado"
      ? "✓ Confirmado por el servidor"
      : personaVista
      ? "Casi — revisa los puntos de la lista"
      : "Buscando al paciente en la imagen…";

  return (
    <div className="cap-wrap">
      <div className="row between" style={{ alignItems: "baseline" }}>
        <div>
          <div className="tiny">
            CAPTURA GUIADA · PASO {idx + 1} DE {PASOS_CAPTURA.length} ·{" "}
            {paso.modo === "foto" ? "FOTO" : `VÍDEO ${paso.duracionS}s`}
          </div>
          <h2 style={{ margin: "2px 0 0" }}>{paso.titulo}</h2>
        </div>
        <Link href={`/caso/${caseId}`}>← Volver al asistente</Link>
      </div>
      <p className="muted" style={{ margin: "6px 0 14px" }}>
        {paso.descripcion}
      </p>

      <div className="cap-stage">
        <video ref={videoRef} playsInline muted className="cap-video" hidden={!enCurso} />
        {enCurso && fase !== "grabando" && <Silueta o={paso.orientacion} modo={paso.modo} />}
        {enCurso && <div className="cap-estado">{estado}</div>}
        {fase === "cuenta" && <div className="cap-cuenta">{restante || 1}</div>}
        {enCurso && <div className="cap-caption">{paso.caption}</div>}
        {fase === "grabando" && (
          <button className="cap-stop" onClick={pararGrabacion}>
            ■ Terminar ya
          </button>
        )}
        {!enCurso && fase !== "error" && previewUrl && (
          <>
            {previewEsVideo ? (
              <video src={previewUrl} className="cap-video" autoPlay muted loop controls playsInline />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={previewUrl} alt={paso.titulo} className="cap-video" />
            )}
            <div className="cap-estado">{estado}</div>
          </>
        )}
        {fase === "error" && (
          <div className="cap-error">
            <p>{errMsg}</p>
            <button onClick={() => location.reload()}>Reintentar</button>
          </div>
        )}
      </div>

      {errMsg && fase !== "error" && <div className="note r" style={{ marginTop: 10 }}>{errMsg}</div>}

      {enCurso && (
        <div className="card" style={{ marginTop: 14 }}>
          <b>Lo que debe verse {deteccion === "activa" ? "(se comprueba solo)" : "(comprobación manual)"}</b>
          <ul className="cap-checks">
            {labels.map((l, i) => (
              <li key={l} className={deteccion === "activa" && checks[i] ? "ok" : ""}>
                {deteccion === "activa" && checks[i] ? "✓" : "·"} {l}
              </li>
            ))}
          </ul>
          {deteccion === "cargando" && (
            <div className="tiny">Cargando la comprobación automática de encuadre…</div>
          )}
          {deteccion === "no" && (
            <div className="tiny">
              La comprobación automática no está disponible en este navegador o sin conexión:
              revisa la lista y captura manualmente.
            </div>
          )}
          <div className="sp" />
          <button onClick={capturarManual} disabled={fase === "cuenta" || fase === "grabando"}>
            {paso.modo === "foto" ? "Hacer la foto manualmente" : "Empezar a grabar manualmente"}
          </button>
        </div>
      )}

      {(fase === "subiendo" || fase === "confirmado") && (
        <div className="card" style={{ marginTop: 14 }}>
          {fase === "confirmado" ? (
            <div className="note g">
              <b>Captura confirmada por el servidor.</b> Ya cuenta en la checklist del caso.
            </div>
          ) : (
            <div className="note">Subiendo la captura — no cierres esta página…</div>
          )}
          <div className="sp" />
          <div className="row" style={{ gap: 10 }}>
            <button onClick={repetir}>↻ Repetir la toma</button>
            <button className="pri" onClick={siguiente} disabled={fase !== "confirmado"}>
              Continuar →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
