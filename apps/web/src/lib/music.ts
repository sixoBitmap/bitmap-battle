import { type Mood, mood } from './mood.ts';
import { audioContext, soundMode } from './sound.ts';

// The arena's soundtrack, played live by the browser, no audio files: war drums, a dark drone, a plucked lyre
// over i–VI–VII–V in D minor, and a horn call. It follows the battle: quiet while watching, drums when fighters
// arrive, the horn when you mint or lead, more urgency when you are outbid.

type Level = 0 | 1 | 2 | 3;

const BPM = 92;
const STEP = 60 / BPM / 4;
const VOLUME = 0.22;
const CHORDS = [
  [50, 57, 62, 65],
  [46, 53, 58, 62],
  [48, 55, 60, 64],
  [45, 52, 57, 61],
];
const OSTINATO = [0, 1, 2, 1, 3, 1, 2, 1, 0, 1, 2, 1, 3, 2, 1, 2];
const HORN: [number, number, number][] = [
  [62, 0, 6],
  [69, 6, 2],
  [67, 8, 2],
  [65, 10, 2],
  [64, 12, 6],
  [62, 20, 10],
];

const LEVELS: Record<Mood, Level> = {
  quiet: 0,
  connect: 0,
  taken: 0,
  left: 0,
  lost: 0,
  won: 0,
  crowd: 1,
  joining: 1,
  ready: 1,
  mint: 2,
  sending: 2,
  leading: 2,
  behind: 3,
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private drone: { a: OscillatorNode; b: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;
  private noise: AudioBuffer | null = null;
  private timer = 0;
  private next = 0;
  private step = 0;
  private level: Level = 0;
  private wanted: Level = 0;
  private ducked = false;

  get playing(): boolean {
    return this.out !== null;
  }

  start(): void {
    if (this.out || document.hidden) return;
    const ctx = audioContext();
    if (!ctx || ctx.state !== 'running') return;
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(comp).connect(ctx.destination);
    this.out.gain.setTargetAtTime(this.ducked ? 0 : VOLUME, ctx.currentTime, 0.8);
    this.noise ??= this.makeNoise(ctx);
    this.startDrone(ctx);
    this.level = this.wanted;
    this.step = 0;
    this.next = ctx.currentTime + 0.12;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out) return;
    clearInterval(this.timer);
    out.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    const drone = this.drone;
    setTimeout(() => {
      drone?.a.stop();
      drone?.b.stop();
      drone?.lfo.stop();
      out.disconnect();
    }, 1500);
    this.out = null;
    this.drone = null;
  }

  setLevel(level: Level): void {
    this.wanted = level;
  }

  duck(on: boolean): void {
    this.ducked = on;
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(on ? 0 : VOLUME, this.ctx.currentTime, on ? 0.15 : 1.2);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private startDrone(ctx: AudioContext): void {
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    a.type = 'sawtooth';
    b.type = 'triangle';
    a.frequency.value = hz(38);
    b.frequency.value = hz(45);
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    lfo.frequency.value = 0.07;
    depth.gain.value = 140;
    lfo.connect(depth).connect(filter.frequency);
    gain.gain.value = 0.05;
    a.connect(filter);
    b.connect(filter);
    filter.connect(gain).connect(this.out!);
    a.start();
    b.start();
    lfo.start();
    this.drone = { a, b, lfo, gain };
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    while (this.next < ctx.currentTime + 0.12) {
      this.play(this.step, this.next);
      this.next += STEP * (this.level === 3 ? 0.9 : 1);
      this.step = (this.step + 1) % 64;
    }
  }

  private play(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    if (s === 0) {
      this.level = this.wanted;
      const root = CHORDS[bar][0];
      this.drone?.a.frequency.setTargetAtTime(hz(root - 12), t, 0.4);
      this.drone?.b.frequency.setTargetAtTime(hz(root - 5), t, 0.4);
      this.drone?.gain.gain.setTargetAtTime(0.045 + this.level * 0.012, t, 0.6);
    }
    const level = this.level;
    const chord = CHORDS[bar];

    if (s === 0 || s === 8 || (level >= 1 && (s === 6 || s === 14)) || (level >= 1 && bar === 3 && s >= 12)) {
      this.drum(t, s === 0 ? 1 : 0.65);
    }
    if (level >= 2 && s % 4 === 2) this.frameDrum(t, 0.35);
    if (level >= 3 && s % 2 === 1) this.frameDrum(t, 0.18);
    if (level >= 1 || s % 2 === 0) this.pluck(t, hz(chord[OSTINATO[s]] + (level >= 3 ? 12 : 0)), level === 0 ? 0.045 : 0.075);
    if (level >= 2 && bar < 2) {
      for (const [note, start, length] of HORN) if (step === start) this.horn(t, hz(note - 12), length * STEP);
    }
  }

  private drum(t: number, velocity: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.2);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9 * velocity, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(gain).connect(this.out!);
    osc.start(t);
    osc.stop(t + 0.6);
    this.hit(t, 700, 0.25 * velocity, 0.09, 'lowpass');
  }

  private frameDrum(t: number, velocity: number): void {
    this.hit(t, 1900, 0.3 * velocity, 0.12, 'bandpass');
  }

  private hit(t: number, freq: number, volume: number, length: number, type: BiquadFilterType): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = this.noise;
    filter.type = type;
    filter.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(filter).connect(gain).connect(this.out!);
    src.start(t, Math.random() * 0.5, length + 0.05);
  }

  private pluck(t: number, freq: number, volume: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + 0.3);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    osc.connect(filter).connect(gain).connect(this.out!);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  private horn(t: number, freq: number, length: number): void {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(280, t);
    filter.frequency.linearRampToValueAtTime(1500, t + 0.12);
    filter.frequency.linearRampToValueAtTime(950, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.09, t + 0.09);
    gain.gain.setValueAtTime(0.09, t + length);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.3);
    filter.connect(gain).connect(this.out!);
    for (const cents of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + length + 0.35);
    }
  }
}

export const music = new Music();

// Browsers allow sound only after a tap: the soundtrack starts with the first one, follows the battle's mood,
// stops in the background, and goes off with the sound mode.
export function setUpMusic(): void {
  const sync = () => {
    if (soundMode.get() === 'all' && !document.hidden) music.start();
    else music.stop();
  };
  const unlock = () => {
    const ctx = audioContext();
    if (ctx && ctx.state !== 'running') ctx.resume().then(sync, () => {});
    else sync();
  };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('visibilitychange', sync);
  soundMode.subscribe(sync);
  mood.subscribe(() => music.setLevel(LEVELS[mood.get()]));
  music.setLevel(LEVELS[mood.get()]);
}
