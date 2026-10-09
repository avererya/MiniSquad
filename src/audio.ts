// Tiny synthesized sound effects. Low priority: cheap, throttled, mutable.
type Sfx = 'shot' | 'eshot' | 'hit' | 'boom' | 'down' | 'pickup' | 'throw' | 'deny' | 'heal' | 'suppress';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let muted = false;
const lastPlayed: Record<string, number> = {};

export function isMuted() { return muted; }
export function setMuted(m: boolean) { muted = m; }

export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new AudioContext();
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
}

function env(g: GainNode, t: number, peak: number, dur: number) {
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function noiseHit(freq: number, type: BiquadFilterType, peak: number, dur: number) {
  if (!ctx || !noise) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  const g = ctx.createGain();
  env(g, t, peak, dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(f0: number, f1: number, type: OscillatorType, peak: number, dur: number) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  env(g, t, peak, dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}

const MIN_GAP: Record<Sfx, number> = { shot: 0.04, eshot: 0.06, hit: 0.05, boom: 0.05, down: 0.3, pickup: 0.1, throw: 0.1, deny: 0.25, heal: 0.2, suppress: 0.2 };

export function sfx(kind: Sfx) {
  if (muted || !ctx) return;
  const now = ctx.currentTime;
  if (now - (lastPlayed[kind] ?? -1) < MIN_GAP[kind]) return;
  lastPlayed[kind] = now;
  switch (kind) {
    case 'shot': noiseHit(2400, 'highpass', 0.12, 0.06); break;
    case 'eshot': noiseHit(1400, 'bandpass', 0.1, 0.07); break;
    case 'hit': tone(220, 90, 'square', 0.06, 0.08); break;
    case 'boom': noiseHit(500, 'lowpass', 0.6, 0.6); tone(90, 30, 'sine', 0.4, 0.5); break;
    case 'down': tone(600, 200, 'sawtooth', 0.1, 0.4); break;
    case 'pickup': tone(500, 1200, 'triangle', 0.15, 0.15); break;
    case 'throw': tone(300, 500, 'triangle', 0.06, 0.12); break;
    case 'deny': tone(180, 140, 'square', 0.06, 0.12); break;
    case 'heal': tone(520, 1040, 'sine', 0.14, 0.3); break;
    case 'suppress': tone(160, 90, 'sawtooth', 0.1, 0.25); noiseHit(900, 'bandpass', 0.15, 0.2); break;
  }
}
