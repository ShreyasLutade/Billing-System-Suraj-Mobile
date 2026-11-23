/**
 * Retail checkout barcode-scanner beep.
 * Plays a short WAV sample (piezo-style POS tone). Falls back to Web Audio
 * if the file can't load (offline/CDN edge cases).
 */

const BEEP_URL = "/sounds/retail-scan-beep.wav";

let sharedAudio: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;

function getAudioElement(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio(BEEP_URL);
    sharedAudio.preload = "auto";
    sharedAudio.volume = 1;
  }
  return sharedAudio;
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Synthetic fallback — same piezo / checkout character as the WAV. */
function playSynthBeep(): void {
  const audioCtx = getContext();
  if (!audioCtx) return;

  const t0 = audioCtx.currentTime;
  const duration = 0.1;
  const freq = 2730;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(freq, t0);

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(5500, t0);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.003);
  gain.gain.setValueAtTime(0.28, t0 + 0.045);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Retail checkout scanner beep on successful IMEI scan. */
export function playScanBeep(): void {
  try {
    const audio = getAudioElement();
    audio.currentTime = 0;
    const play = audio.play();
    if (play && typeof play.catch === "function") {
      play.catch(() => playSynthBeep());
    }
  } catch {
    playSynthBeep();
  }
}

/**
 * Two-tone falling alert for destructive confirmations (e.g. delete a bill).
 * Synthesised, so it needs no file; call it from a click.
 */
export function playWarningSound(): void {
  try {
    const audioCtx = getContext();
    if (!audioCtx) return;
    const start = audioCtx.currentTime + 0.01;
    [
      { freq: 880, at: 0 },
      { freq: 587, at: 0.2 },
    ].forEach(({ freq, at }) => {
      const t0 = start + at;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    });
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([90, 60, 90]);
    }
  } catch {
    // Sound is a nice-to-have.
  }
}

export function vibrateOnDetect(): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(50);
  }
}
