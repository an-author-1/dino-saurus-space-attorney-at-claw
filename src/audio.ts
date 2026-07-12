// All sound is synthesized in code with the Web Audio API. No audio files.

let ctx: AudioContext | null = null;

// Must be called from a user gesture (browsers block audio otherwise).
export function initAudio() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return;
  }
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  ctx = new AC();
}

function tone(
  type: OscillatorType,
  startFreq: number,
  endFreq: number,
  dur: number,
  vol: number,
) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(startFreq, t);
  if (endFreq !== startFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Short square tick per revealed character, pitch slightly randomized.
export function blip() {
  const f = 440 + Math.floor(Math.random() * 120) - 60;
  tone("square", f, f, 0.02, 0.05);
}

// Low thud for menu confirm.
export function thud() {
  tone("square", 150, 70, 0.12, 0.12);
}

// Soft tick for menu movement.
export function tick() {
  tone("square", 320, 320, 0.02, 0.05);
}

// Harsh sting for OBJECTION!
export function sting() {
  if (!ctx) return;
  tone("sawtooth", 220, 880, 0.18, 0.16);
  tone("square", 110, 440, 0.22, 0.12);
  // add a little noise-ish grit with a detuned partial
  tone("sawtooth", 330, 990, 0.15, 0.08);
}

// Descending buzz for wrong objections / rebukes.
export function buzz() {
  tone("sawtooth", 400, 90, 0.4, 0.14);
}

// Bright chime for the correct objection / verdict fanfare.
export function chime() {
  tone("square", 523, 523, 0.12, 0.1);
  tone("square", 659, 659, 0.12, 0.1);
  tone("square", 784, 784, 0.18, 0.1);
}
