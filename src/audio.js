// Sound design (feedback v2), driven by the group's own recordings in public/audio:
//   nobody on the stage          → silence
//   1–2 on the stage, or someone sitting on a bench → a soft-tempo song (random of 3)
//   3+ on the stage              → a high-tempo song (random of 3)
//   one pair of avatars talking  → a quiet, muffled two-person conversation
//   several pairs talking        → a murmur of many people
// Everything comes from the LED wall's speakers (spatialised at the wall).

const TRACKS = {
  soft: ['soft-1', 'soft-2', 'soft-3'],
  fast: ['fast-1', 'fast-2', 'fast-3'],
};
const MUSIC_GAIN = 0.8;
const MURMUR_GAIN = 0.45;
const TWO_GAIN = 0.55;
const FADE = 1.2; // seconds (time constant of the crossfades)
const MOOD_HOLD = 1.0; // a new mood must hold this long before the music changes

import { LAYOUT } from './world.js';

const url = (name) => `/audio/${name}.mp3`;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.mood = 'silent';
    this.candidate = 'silent';
    this.candidateSince = 0;
    this.lastTrack = {};
    this.talk = 'none';
    this.override = null; // spectator mode: a fixed soundtrack ('soft-2', 'off', …) instead of following the stage
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // the installation's speakers: positioned at the LED wall
    this.inst = ctx.createGain();
    this.panner = ctx.createPanner();
    Object.assign(this.panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 6, rolloffFactor: 1, maxDistance: 200 });
    this.inst.connect(this.panner).connect(this.master);
    this.setPannerPos(LAYOUT.screen.cx, 2, LAYOUT.screen.cz);

    // two music decks so songs can crossfade
    this.decks = [this.makeLoop(null, this.inst, false), this.makeLoop(null, this.inst, false)];
    this.decks.forEach((d) => d.el.addEventListener('ended', () => this.onTrackEnded(d)));
    this.active = 0;

    this.murmur = this.makeLoop(url('murmur'), this.inst, true);
    this.talkTwo = this.makeLoop(url('talk-two'), this.inst, true);
  }

  /** An <audio> element routed through a gain node. */
  makeLoop(src, dest, loop) {
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.loop = loop;
    el.preload = 'auto';
    if (src) el.src = src;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    this.ctx.createMediaElementSource(el).connect(gain).connect(dest);
    return { el, gain, playing: false };
  }

  fadeTo(node, value, onSilent) {
    const t = this.ctx.currentTime;
    node.gain.gain.cancelScheduledValues(t);
    node.gain.gain.setTargetAtTime(value, t, FADE / 3);
    if (value === 0 && onSilent) {
      clearTimeout(node.stopTimer);
      node.stopTimer = setTimeout(() => { if (node.gain.gain.value < 0.01) onSilent(); }, FADE * 2500);
    } else clearTimeout(node.stopTimer);
  }

  play(node) {
    if (node.playing) return;
    node.playing = true;
    node.el.play().catch(() => { node.playing = false; });
  }

  stop(node) {
    node.el.pause();
    node.playing = false;
  }

  /** A random track of the given mood, never the one that just played. */
  pickTrack(mood) {
    const options = TRACKS[mood].filter((n) => n !== this.lastTrack[mood]);
    const name = options[Math.floor(Math.random() * options.length)];
    this.lastTrack[mood] = name;
    return name;
  }

  startTrack(mood, name = this.pickTrack(mood)) {
    const out = this.decks[this.active];
    this.active = 1 - this.active;
    const deck = this.decks[this.active];
    this.fadeTo(out, 0, () => this.stop(out));
    deck.mood = mood;
    deck.el.src = url(name);
    deck.el.currentTime = 0;
    deck.playing = false;
    this.play(deck);
    this.fadeTo(deck, MUSIC_GAIN);
  }

  onTrackEnded(deck) {
    deck.playing = false;
    if (deck !== this.decks[this.active]) return;
    if (this.override && this.override !== 'off') this.startTrack('override', this.override);
    else if (!this.override && this.mood !== 'silent') this.startTrack(this.mood);
  }

  applyMood(mood) {
    this.mood = mood;
    if (mood === 'silent') for (const d of this.decks) this.fadeTo(d, 0, () => this.stop(d));
    else this.startTrack(mood);
  }

  /** Spectator mode: play one soundtrack ('soft-1' … 'fast-3'), 'off' for silence, or null to follow the stage again. */
  setOverride(track) {
    this.override = track || null;
    if (!this.ctx) return;
    if (this.override === 'off') for (const d of this.decks) this.fadeTo(d, 0, () => this.stop(d));
    else if (this.override) this.startTrack('override', this.override);
    else this.applyMood(this.mood);
  }

  /**
   * Called every frame with what is happening at the installation.
   * onStage = people standing on the stage, seated = people on its benches,
   * talkGroups = how many pairs of avatars are chatting, dancing = some avatars are dancing.
   */
  setMood({ onStage, seated, talkGroups, dancing }) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.override) { this.updateTalk(talkGroups); return; }
    const want = dancing || onStage >= 3 ? 'fast' : onStage >= 1 || seated > 0 ? 'soft' : 'silent';
    if (want !== this.candidate) { this.candidate = want; this.candidateSince = now; }
    if (want !== this.mood && now - this.candidateSince >= MOOD_HOLD) this.applyMood(want);
    this.updateTalk(talkGroups);
  }

  updateTalk(talkGroups) {
    const talk = talkGroups >= 2 ? 'many' : talkGroups === 1 ? 'two' : 'none';
    if (talk !== this.talk) {
      this.talk = talk;
      for (const [node, on, gain] of [[this.talkTwo, talk === 'two', TWO_GAIN], [this.murmur, talk === 'many', MURMUR_GAIN]]) {
        if (on) this.play(node);
        this.fadeTo(node, on ? gain : 0, () => this.stop(node));
      }
    }
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

  setInstallationMuted(m) {
    if (this.ctx) this.inst.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.2);
  }

  setMasterMuted(m) {
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.1);
  }
}
