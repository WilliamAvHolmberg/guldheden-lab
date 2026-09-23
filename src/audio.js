// Procedural audio: a little 1940s swing combo whose layers (and "radio" EQ) open up
// as more neighbours join, plus ambient wind/birds. The installation bus is spatialised
// at the LED wall so it gets louder as you walk up to it.

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

const CHORDS = [
  { root: 41, notes: [53, 57, 60, 64] }, // Fmaj7
  { root: 38, notes: [50, 53, 57, 60] }, // Dm7
  { root: 43, notes: [55, 58, 62, 65] }, // Gm7
  { root: 36, notes: [52, 55, 58, 60] }, // C7
];
const SCALE = [65, 67, 69, 72, 74, 77, 79, 81]; // F major pentatonic-ish

const LAYERS = [
  // pad, crackle, piano, bass, drums, melody, lowpass, highpass
  [0.05, 0.06, 0.0, 0.0, 0.0, 0.0, 1400, 400],
  [0.06, 0.12, 0.2, 0.0, 0.0, 0.0, 1900, 330],
  [0.05, 0.08, 0.24, 0.28, 0.1, 0.0, 3800, 180],
  [0.04, 0.03, 0.26, 0.32, 0.22, 0.0, 9000, 60],
  [0.04, 0.015, 0.26, 0.34, 0.26, 0.2, 16000, 30],
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.level = 0;
    this.instMuted = false;
    this.masterMuted = false;
    this.step = 0;
    this.nextTime = 0;
    this.melodyPos = 3;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // installation bus: layers -> radio EQ -> panner at the screen -> master
    this.inst = ctx.createGain();
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 400;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 1400;
    this.panner = ctx.createPanner();
    Object.assign(this.panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 5, rolloffFactor: 1.1, maxDistance: 200 });
    this.inst.connect(this.hp).connect(this.lp).connect(this.panner).connect(this.master);
    this.setPannerPos(20.7, 2, 0);

    this.bus = {};
    for (const k of ['pad', 'crackle', 'piano', 'bass', 'drums', 'melody']) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.inst);
      this.bus[k] = g;
    }
    this.noiseBuf = this.makeNoise(2, 'white');
    this.brownBuf = this.makeNoise(4, 'brown');
    this.startCrackle();
    this.startPad();
    this.startAmbient();
    this.applyLevel(0, true);
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  makeNoise(seconds, kind) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  setPannerPos(x, y, z) {
    const p = this.panner;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.position;
    const f = camera.getWorldDirection(this._f ?? (this._f = camera.position.clone()));
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  setLevel(level) {
    this.level = level;
    if (this.ctx) this.applyLevel(level);
  }

  applyLevel(level, instant = false) {
    const t = this.ctx.currentTime, tc = instant ? 0.01 : 1.2;
    const L = LAYERS[level];
    ['pad', 'crackle', 'piano', 'bass', 'drums', 'melody'].forEach((k, i) => this.bus[k].gain.setTargetAtTime(L[i], t, tc));
    this.lp.frequency.setTargetAtTime(L[6], t, tc);
    this.hp.frequency.setTargetAtTime(L[7], t, tc);
  }

  setInstallationMuted(m) {
    this.instMuted = m;
    if (this.ctx) this.inst.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.2);
  }

  setMasterMuted(m) {
    this.masterMuted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.1);
  }

  // ------------------------------------------------------------------
  startCrackle() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.04;
      if (Math.random() < 0.0009) d[i] = (Math.random() * 2 - 1) * 0.9;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 0.5;
    src.connect(f).connect(this.bus.crackle);
    src.start();
  }

  startPad() {
    const ctx = this.ctx;
    this.padOsc = [];
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    lp.connect(this.bus.pad);
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = (i - 1.5) * 6;
      const g = ctx.createGain(); g.gain.value = 0.12;
      o.connect(g).connect(lp);
      o.start();
      this.padOsc.push(o);
    }
  }

  startAmbient() {
    const ctx = this.ctx;
    const wind = ctx.createBufferSource();
    wind.buffer = this.brownBuf;
    wind.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.07;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.035;
    lfo.connect(lfoG).connect(g.gain);
    lfo.start();
    wind.connect(lp).connect(g).connect(this.master);
    wind.start();
    this.ambientGain = g;
    this.birdTimer = setInterval(() => { if (!this.night && Math.random() < 0.55) this.bird(); }, 2600);
  }

  setNight(n) { this.night = n > 0.6; }

  bird() {
    const ctx = this.ctx, t = ctx.currentTime;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    const g = ctx.createGain(); g.gain.value = 0;
    p.connect(this.master);
    g.connect(p);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.connect(g);
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2800 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.12;
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), s + 0.07);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.025, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, s + 0.09);
    }
    o.start(t);
    o.stop(t + n * 0.12 + 0.2);
  }

  // ------------------------------------------------------------------
  schedule() {
    const ctx = this.ctx;
    const beat = 60 / (this.level >= 4 ? 132 : 112);
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime, beat);
      // swung eighths
      const swing = this.step % 2 === 0 ? 0.62 : 0.38;
      this.nextTime += beat * 2 * swing;
      this.step = (this.step + 1) % 32; // 4 bars * 8 eighths
    }
  }

  playStep(step, t, beat) {
    const bar = Math.floor(step / 8), e8 = step % 8, onBeat = e8 % 2 === 0, beatIdx = e8 / 2;
    const chord = CHORDS[bar];
    if (e8 === 0) {
      chord.notes.forEach((n, i) => this.padOsc[i].frequency.setTargetAtTime(midiHz(n - 12), t, 0.3));
    }
    // piano comping: Charleston rhythm (1, and-of-2)
    if (e8 === 0 || e8 === 3 || (this.level >= 3 && e8 === 6)) {
      chord.notes.forEach((n) => this.piano(t, n, e8 === 0 ? 0.4 : 0.25, 0.09));
    }
    // walking bass on every beat
    if (onBeat) {
      const walk = [chord.root, chord.root + 4, chord.root + 7, chord.root + (beatIdx === 3 ? 6 : 9)];
      this.bassNote(t, walk[beatIdx], beat * 0.9);
    }
    // drums: brushes on 2 & 4, ride on swung eighths, soft kick on 1
    if (onBeat && (beatIdx === 1 || beatIdx === 3)) this.brush(t, 0.5);
    if (onBeat && beatIdx === 0) this.kick(t);
    if (this.level >= 3) this.ride(t, onBeat ? 0.25 : 0.15);
    // clarinet-ish melody
    if (this.level >= 4 && (onBeat || Math.random() < 0.4) && Math.random() < 0.75) {
      this.melodyPos = Math.max(0, Math.min(SCALE.length - 1, this.melodyPos + Math.floor(Math.random() * 5) - 2));
      this.lead(t, SCALE[this.melodyPos], beat * (onBeat ? 0.9 : 0.45));
    }
  }

  piano(t, midi, dur, vel) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    g.connect(this.bus.piano);
    for (const [type, mul, amp] of [['triangle', 1, 1], ['sine', 2, 0.35], ['sine', 3, 0.12]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = midiHz(midi) * mul;
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.7);
    }
  }

  bassNote(t, midi, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midiHz(midi);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(lp).connect(g).connect(this.bus.bass);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseHit(t, type, freq, q, dur, amp, bus) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  brush(t, amp) { this.noiseHit(t, 'bandpass', 2400, 0.6, 0.22, amp, this.bus.drums); }
  ride(t, amp) { this.noiseHit(t, 'highpass', 7500, 0.7, 0.08, amp, this.bus.drums); }

  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.bus.drums);
    o.start(t);
    o.stop(t + 0.25);
  }

  lead(t, midi, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = midiHz(midi);
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
    const vg = ctx.createGain(); vg.gain.value = 4;
    vib.connect(vg).connect(o.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.04);
    g.gain.setTargetAtTime(0, t + dur * 0.8, 0.05);
    o.connect(lp).connect(g).connect(this.bus.melody);
    o.start(t); vib.start(t);
    o.stop(t + dur + 0.3); vib.stop(t + dur + 0.3);
  }

  // ------------------------------------------------------------------
  chime(kind = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = kind === 1 ? [77, 81, 84, 89] : [72, 79];
    notes.forEach((n, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = midiHz(n);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.08);
      g.gain.linearRampToValueAtTime(0.12, t + i * 0.08 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 1.2);
      o.connect(g).connect(this.instMuted ? this.master : this.inst);
      o.start(t + i * 0.08);
      o.stop(t + i * 0.08 + 1.3);
    });
  }

  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1200;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.06);
  }
}
