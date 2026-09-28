export const SOUND_IDS = ["message", "attention", "success", "failure", "silent"] as const;

export type SoundId = (typeof SOUND_IDS)[number];

/** Pico relativo 0–1. 1 = volume atual do beep (~0.08 de gain). */
export const SOUND_VOLUME = 1;

const PICO = 0.08;

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/** Desbloqueia autoplay — chamar no clique que ativa os alertas. */
export async function resumeAudio(): Promise<void> {
  const audio = getContext();
  if (audio && audio.state === "suspended") await audio.resume();
}

function beep(
  audio: AudioContext,
  freq: number,
  duration: number,
  type: OscillatorType,
  startAt = 0,
  volume = SOUND_VOLUME,
): void {
  const peak = PICO * Math.min(1, Math.max(0, volume));
  if (peak <= 0) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const t = audio.currentTime + startAt;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export function playSound(id: SoundId, volume = SOUND_VOLUME): void {
  if (id === "silent" || volume <= 0) return;
  const audio = getContext();
  if (!audio) return;
  void audio.resume();
  if (id === "message") {
    beep(audio, 880, 0.09, "sine", 0, volume);
    beep(audio, 1174, 0.11, "sine", 0.1, volume);
    return;
  }
  if (id === "attention") {
    beep(audio, 740, 0.12, "triangle", 0, volume);
    beep(audio, 740, 0.12, "triangle", 0.16, volume);
    return;
  }
  if (id === "failure") {
    beep(audio, 392, 0.12, "triangle", 0, volume);
    beep(audio, 262, 0.18, "triangle", 0.12, volume);
    return;
  }
  beep(audio, 523, 0.08, "sine", 0, volume);
  beep(audio, 784, 0.14, "sine", 0.09, volume);
}
