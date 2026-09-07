"use client";

// Pitidos del estudio de captura reproducidos como CONTENIDO MULTIMEDIA
// (elementos <audio> con un WAV generado en memoria), no con Web Audio: en
// iPhone el interruptor de silencio acalla Web Audio pero no la reproducción
// multimedia. Además se pide la sesión de audio "playback" (iOS 17+).
//
// Los navegadores móviles solo dejan reproducir audio tras un toque del
// usuario, así que los elementos se "desbloquean" con el primer toque en
// cualquier parte de la app (AudioPrimer) y a partir de ahí pueden sonar
// solos. Los WAV empiezan con un tramo de silencio para que ese desbloqueo
// (play + pause inmediatos) no se oiga.

export const BEEP_LEAD_MS = 200; // silencio inicial de cada WAV

type Tone = { freq: number; ms: number; gapMs?: number };

const TONES: Record<"start" | "stop", Tone[]> = {
  // Salida: dos tonos ascendentes
  start: [
    { freq: 880, ms: 160, gapMs: 30 },
    { freq: 1320, ms: 280 },
  ],
  // Fin: un tono grave
  stop: [{ freq: 440, ms: 380 }],
};

function wavUrl(tones: Tone[]): string {
  const rate = 22050;
  const lead = Math.round((BEEP_LEAD_MS / 1000) * rate);
  const total =
    lead + tones.reduce((n, t) => n + Math.round(((t.ms + (t.gapMs ?? 0)) / 1000) * rate), 0);
  const pcm = new Int16Array(total);
  let i = lead;
  for (const t of tones) {
    const n = Math.round((t.ms / 1000) * rate);
    for (let k = 0; k < n; k++, i++) {
      // envolvente corta para evitar clics
      const env = Math.min(1, k / (rate * 0.01), (n - k) / (rate * 0.03));
      pcm[i] = Math.round(Math.sin((2 * Math.PI * t.freq * k) / rate) * 0.8 * env * 32767);
    }
    i += Math.round(((t.gapMs ?? 0) / 1000) * rate);
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, j) => v.setUint8(o + j, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

type Beeps = { start: HTMLAudioElement; stop: HTMLAudioElement; primed: boolean };
declare global {
  interface Window {
    __ortosendBeeps?: Beeps;
  }
}

function elements(): Beeps | null {
  if (typeof window === "undefined") return null;
  if (!window.__ortosendBeeps) {
    const make = (tones: Tone[]) => {
      const a = new Audio(wavUrl(tones));
      a.preload = "auto";
      a.setAttribute("playsinline", "");
      return a;
    };
    window.__ortosendBeeps = { start: make(TONES.start), stop: make(TONES.stop), primed: false };
  }
  return window.__ortosendBeeps;
}

// Sesión de audio de reproducción: en iOS 17+ hace que el sonido no dependa
// del interruptor de silencio.
function playbackSession() {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    // no soportado
  }
}

// Desbloqueo con un gesto del usuario: play + pause inmediatos (solo suena el
// silencio inicial del WAV). Idempotente.
export function primeBeeps() {
  const b = elements();
  if (!b || b.primed) return;
  playbackSession();
  for (const el of [b.start, b.stop]) {
    el.play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
      })
      .catch(() => {
        // sin gesto válido todavía; se reintenta con el siguiente toque
        b.primed = false;
      });
  }
  b.primed = true;
}

// Reproduce el pitido. Devuelve false si el navegador no lo permite.
export async function playBeep(kind: "start" | "stop"): Promise<boolean> {
  const b = elements();
  if (!b) return false;
  playbackSession();
  const el = b[kind];
  try {
    el.pause();
    el.currentTime = 0;
    await el.play();
    return true;
  } catch {
    return false;
  }
}
