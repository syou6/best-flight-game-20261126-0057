// WebAudio synth only: engine hum tied to throttle, wind, ring chime, landing fanfare,
// crash thud and warning beep. No audio files. Everything is created lazily after a user gesture.

import { mulberry32 } from './rng.js';

let ac = null;
let master = null;
let eng = null;
let muted = false;

function tone(freq, start, dur, type, vol) {
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noiseBuffer(seconds) {
  const rng = mulberry32(99);
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = rng() * 2 - 1;
  return buf;
}

export function initAudio() {
  if (ac) {
    if (ac.state === 'suspended') ac.resume();
    return;
  }
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ac = new Ctor();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ac.destination);

    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    const filt = ac.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 400;
    const eg = ac.createGain();
    eg.gain.value = 0;
    o1.connect(filt);
    o2.connect(filt);
    filt.connect(eg);
    eg.connect(master);
    o1.start();
    o2.start();

    const wind = ac.createBufferSource();
    wind.buffer = noiseBuffer(2);
    wind.loop = true;
    const wf = ac.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 700;
    wf.Q.value = 0.5;
    const wg = ac.createGain();
    wg.gain.value = 0;
    wind.connect(wf);
    wf.connect(wg);
    wg.connect(master);
    wind.start();

    eng = { o1: o1, o2: o2, filt: filt, eg: eg, wg: wg };
  } catch (e) {
    ac = null;
  }
}

export function setEngine(on, throttle, speed) {
  if (!ac || !eng) return;
  const t = ac.currentTime;
  const base = 42 + throttle * 78;
  eng.o1.frequency.setTargetAtTime(base, t, 0.08);
  eng.o2.frequency.setTargetAtTime(base * 2.01, t, 0.08);
  eng.filt.frequency.setTargetAtTime(280 + throttle * 900, t, 0.1);
  eng.eg.gain.setTargetAtTime(on ? 0.05 + 0.08 * throttle : 0, t, 0.12);
  eng.wg.gain.setTargetAtTime(on ? Math.min(0.12, (speed / 330) * 0.1) : 0, t, 0.2);
}

export function chime(n) {
  const base = 523.25 * Math.pow(2, ((n - 1) * 2) / 12);
  tone(base, 0, 0.35, 'sine', 0.22);
  tone(base * 1.26, 0.08, 0.35, 'sine', 0.2);
  tone(base * 1.5, 0.16, 0.5, 'sine', 0.2);
  tone(base * 2, 0.24, 0.6, 'triangle', 0.14);
}

export function fanfare() {
  const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
  const times = [0, 0.16, 0.32, 0.48, 0.74, 0.9, 1.06];
  for (let i = 0; i < notes.length; i++) {
    tone(notes[i], times[i], i === 6 ? 1.2 : 0.3, 'triangle', 0.22);
    tone(notes[i] / 2, times[i], i === 6 ? 1.2 : 0.3, 'square', 0.06);
  }
}

export function crashSound() {
  if (!ac) return;
  const t0 = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(1.4);
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1400, t0);
  f.frequency.exponentialRampToValueAtTime(70, t0 + 1.2);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.9, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.3);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0);
  const o = ac.createOscillator();
  const og = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(90, t0);
  o.frequency.exponentialRampToValueAtTime(28, t0 + 0.8);
  og.gain.setValueAtTime(0.8, t0);
  og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
  o.connect(og);
  og.connect(master);
  o.start(t0);
  o.stop(t0 + 1);
}

export function beep() {
  tone(880, 0, 0.09, 'square', 0.12);
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.6;
  return muted;
}

export function suspendAudio() {
  if (ac && ac.state === 'running') ac.suspend();
}

export function resumeAudio() {
  if (ac && ac.state === 'suspended') ac.resume();
}
