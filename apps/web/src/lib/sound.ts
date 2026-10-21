import { store } from './store.ts';

// Music and effects, effects only, or silence. Players who had muted the app before stay silent.
export type SoundMode = 'all' | 'effects' | 'off';
const wasMuted = (() => {
  try {
    return localStorage.getItem('bb.muted') === 'true';
  } catch {
    return false;
  }
})();
export const soundMode = store<SoundMode>(wasMuted ? 'off' : 'all', 'bb.sound');

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function audio(): AudioContext | null {
  return soundMode.get() === 'off' ? null : audioContext();
}

function tone(freq: number, start: number, length: number, type: OscillatorType = 'square', volume = 0.08): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + length);
}

function noise(start: number, length: number, volume = 0.5): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const buffer = a.createBuffer(1, Math.floor(a.sampleRate * length), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = a.createBufferSource();
  const filter = a.createBiquadFilter();
  const gain = a.createGain();
  src.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, t);
  filter.frequency.exponentialRampToValueAtTime(60, t + length);
  gain.gain.setValueAtTime(volume, t);
  src.connect(filter).connect(gain).connect(a.destination);
  src.start(t);
}

const buzz = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
};

export const sfx = {
  tap() {
    tone(660, 0, 0.06);
    buzz(15);
  },
  coin() {
    tone(988, 0, 0.08);
    tone(1319, 0.08, 0.25);
    buzz(30);
  },
  lead() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.18, 'triangle', 0.1));
    buzz([40, 40, 80]);
  },
  outbid() {
    tone(220, 0, 0.15, 'sawtooth', 0.07);
    tone(174, 0.15, 0.25, 'sawtooth', 0.07);
    buzz([120, 60, 120]);
  },
  block() {
    tone(392, 0, 0.12, 'triangle', 0.1);
    tone(523, 0.1, 0.2, 'triangle', 0.1);
  },
  win() {
    noise(0, 1.6, 0.6);
    const notes = [523, 659, 784, 1047, 784, 1047, 1319, 1568];
    notes.forEach((f, i) => tone(f, 0.35 + i * 0.11, 0.3, 'square', 0.06));
    tone(2093, 0.35 + notes.length * 0.11, 0.9, 'triangle', 0.08);
    buzz([200, 80, 200, 80, 400]);
  },
  lose() {
    [392, 349, 311, 262].forEach((f, i) => tone(f, i * 0.16, 0.22, 'triangle', 0.08));
    buzz(200);
  },
};
