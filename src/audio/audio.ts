/*
 * All sound is synthesized in code — no audio files. A single AudioContext is
 * created lazily and resumed on the first user gesture (browsers block audio
 * until then).
 */

import type { Cue } from "../engine/state";

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** Turn an engine Cue into sound. */
  play(cue: Cue): void {
    switch (cue.kind) {
      case "blip":
        this.blip(cue.seed ?? 0);
        break;
      case "move":
        this.move();
        break;
      case "confirm":
        this.thud();
        break;
      case "objection":
        this.sting();
        break;
      case "wrong":
        this.buzz();
        break;
      case "sustain":
        this.sustainChime();
        break;
      case "fanfare":
        this.fanfare();
        break;
    }
  }

  /** Call from a user-gesture handler (keydown / pointerdown) to unlock audio. */
  resume(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** A single oscillator with a linear-ramped pitch and a fast decay envelope. */
  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master) return;
    const t = this.now() + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f1, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.now() + delay;
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Deterministic-ish LCG so we don't need Math.random; sound is the same shape each time.
    let s = 1234567;
    for (let i = 0; i < frames; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (s / 0x3fffffff - 1) * (1 - i / frames);
    }
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buf;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  /** Typewriter tick — one per revealed character, pitch jittered by index. */
  blip(seed: number): void {
    const f = 700 + ((seed * 53) % 260);
    this.tone("square", f, f, 0.02, 0.06);
  }

  /** Low thud for menu confirm / selection. */
  thud(): void {
    this.tone("square", 150, 90, 0.12, 0.28);
  }

  /** Soft tick for menu cursor movement. */
  move(): void {
    this.tone("square", 480, 480, 0.02, 0.09);
  }

  /** Harsh sting for OBJECTION! — the slam. */
  sting(): void {
    this.tone("sawtooth", 900, 180, 0.28, 0.32);
    this.tone("square", 300, 140, 0.32, 0.22);
    this.noise(0.18, 0.3);
  }

  /** Descending buzz for a wrong objection. */
  buzz(): void {
    this.tone("square", 320, 90, 0.3, 0.28);
    this.tone("sawtooth", 240, 70, 0.3, 0.14);
  }

  /** Bright rising flourish for a correct objection / breakdown. */
  sustainChime(): void {
    this.tone("square", 440, 660, 0.09, 0.24);
    this.tone("square", 660, 880, 0.12, 0.24, 0.09);
  }

  /** Little victory arpeggio for the verdict. */
  fanfare(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => this.tone("square", f, f, 0.14, 0.24, i * 0.11));
  }
}
