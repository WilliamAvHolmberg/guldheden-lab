import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildWorld, LAYOUT, screenOffset, onStage } from './world.js';
import { Speech } from './speech.js';
import { Installation } from './installation.js';
import { Player, GESTURE_KEYS } from './player.js';
import { Crowd } from './crowd.js';
import { PoseDriver } from './pose.js';
import { AudioEngine } from './audio.js';
import { Rig, GESTURES, animIdle, modernStyle } from './character.js';
import { rng } from './textures.js';
import { Multiplayer, playerStyle } from './multiplayer.js';
import { partyHost, roomName } from './net.js';

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// Resolution: start at most 1.5× and let the adaptive scaler below lower it on slow machines.
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 1.5);
renderer.setPixelRatio(MAX_PIXEL_RATIO);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 10000);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.5, 1.1);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- systems
const audio = new AudioEngine();
// The on-screen event log was removed (feedback v2); events still go to the console for debugging.
function logEvent(text) {
  console.debug('[torget]', text);
}

const world = buildWorld(scene, renderer);
const installation = new Installation(scene, renderer, { obstacles: world.obstacles, onEvent: logEvent, audio });
const crowd = new Crowd(scene, world.obstacles, logEvent);
const speech = new Speech();
crowd.seats = installation.seats;
crowd.onSay = (a, text) => speech.say(a, text, { name: a.name, seconds: 4.5 });
const mp = new Multiplayer({
  scene, player: null, crowd, installation, log: logEvent, onStatus: () => updateOnline(),
  onChat: ({ person, name, text }) => {
    if (person) speech.say(person, text, { name });
  },
});
const player = new Player(scene, camera, canvas, {
  style: playerStyle(mp.id),
  obstacles: world.obstacles,
  buildings: world.buildings,
});

player.id = mp.id;
mp.player = player;

// ---------------------------------------------------------------- webcam pose
const pose = new PoseDriver();
const camPanel = document.getElementById('cam');
const camCanvas = document.getElementById('camCanvas');
const camStatus = document.getElementById('camStatus');
let guest = null;
let guestGone = 0;
const guestRand = rng(2026);

async function toggleCam() {
  const btn = document.getElementById('camBtn') ?? document.createElement('button');
  if (pose.running || pose.status === 'loading') {
    pose.stop();
    camPanel.hidden = true;
    btn.classList.remove('on');
    removeGuest();
    logEvent('Webcam pose turned off', 'kiosk');
    return;
  }
  camPanel.hidden = false;
  camStatus.textContent = 'Loading MediaPipe pose model…';
  btn.classList.add('on');
  try {
    await pose.start(2);
    camStatus.textContent = 'Tracking – move your arms! Two people on camera → two characters.';
    logEvent('Webcam pose on (MediaPipe Pose Landmarker)', 'kiosk');
    player.faceScreen();
  } catch (e) {
    console.error(e);
    camStatus.textContent = `Camera error: ${e.message ?? e}`;
    btn.classList.remove('on');
    pose.status = 'off';
  }
}

function removeGuest() {
  if (!guest) return;
  guest.rig.dispose();
  logEvent('Webcam guest left the camera view', 'leave');
  guest = null;
}

function updateGuest(dt, t) {
  const gp = pose.running ? pose.guest : null;
  if (!gp) {
    guestGone += dt;
    if (guest && guestGone > 1.0) removeGuest();
    return;
  }
  guestGone = 0;
  if (!guest) {
    const style = modernStyle(guestRand, 'adult');
    style.top = '#6a4c93';
    guest = { id: `${mp.id}-guest`, name: 'Webcam guest', kind: 'adult', isPlayer: false, rig: new Rig(style), pos: player.pos.clone(), heading: player.heading };
    scene.add(guest.rig.root);
    logEvent('A second person appeared on the webcam → joins the square', 'track');
  }
  // place the guest beside the player according to their horizontal separation in the camera image
  const pp = pose.player;
  const offset = THREE.MathUtils.clamp((gp.cx - pp.cx) * 3.6, -3.5, 3.5);
  const right = new THREE.Vector3(-Math.cos(player.heading), 0, Math.sin(player.heading));
  const target = player.pos.clone().addScaledVector(right, offset);
  guest.pos.lerp(target, 1 - Math.exp(-dt * 5));
  guest.heading = player.heading;
  const rig = guest.rig;
  rig.resetTargets();
  animIdle(rig, t, 3);
  gp.apply(rig);
  rig.update(dt, 20);
  rig.root.position.copy(guest.pos);
  rig.root.rotation.y = guest.heading;
}

// ---------------------------------------------------------------- UI
const $ = (id) => document.getElementById(id);
const gestEl = $('gestures');
GESTURE_KEYS.forEach((name, i) => {
  const g = GESTURES[name];
  const b = document.createElement('button');
  b.innerHTML = `<i>${i + 1}</i>${g.en}`;
  if (name === 'smoke') b.classList.add('warn');
  b.title = name === 'smoke' ? 'Tests the content filter: hand-to-mouth gestures (e.g. smoking) are not mirrored on the screen' : `Gesture: ${g.en} (${g.label})`;
  b.onclick = () => player.play(name);
  b.dataset.g = name;
  gestEl.appendChild(b);
});

let hintTimer = 0;
function showHint(text, dur = 2.5) {
  const h = $('hint');
  h.textContent = text;
  h.classList.add('show');
  hintTimer = dur;
}

const TIMES = ['day', 'dusk', 'night'];
const TIME_LABEL = { day: 'Day', dusk: 'Dusk', night: 'Night' };
let timeIdx = 0;
let pipMode = 'off';
const PIP_LABEL = { small: 'small', large: 'large', off: 'off' };
let soundOn = true;

const actions = {
  cam: toggleCam,
  add: () => { if (!mp.command('add')) logEvent('Asked the host to send a visitor', 'spawn'); },
  group: () => { mp.command('group'); logEvent('A group of four neighbours is heading for the screen', 'spawn'); },
  clear: () => { mp.command('clear'); logEvent('All visitors left the square', 'leave'); },
  time: () => {
    timeIdx = (timeIdx + 1) % TIMES.length;
    world.setTimeOfDay(TIMES[timeIdx]);
    $('timeBtn').innerHTML = `<i>T</i> ${TIME_LABEL[TIMES[timeIdx]]}`;
  },
  sensor: () => {
    installation.setSensorView(!installation.sensorView);
    $('sensorBtn').classList.toggle('on', installation.sensorView);
  },
  screen: () => {
    pipMode = pipMode === 'small' ? 'large' : pipMode === 'large' ? 'off' : 'small';
    $('screenBtn').innerHTML = `<i>V</i> Screen feed: ${PIP_LABEL[pipMode]}`;
  },
  sit: toggleSit,
  sound: () => {
    soundOn = !soundOn;
    audio.setMasterMuted(!soundOn);
    $('soundBtn').innerHTML = `<i>M</i> Sound ${soundOn ? 'on' : 'off'}`;
    $('soundBtn').classList.toggle('on', !soundOn);
  },
};
document.querySelectorAll('#tools button').forEach((b) => { b.onclick = () => actions[b.dataset.act](); });
window.addEventListener('keydown', (e) => {
  if (!started || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const map = { KeyC: 'cam', KeyN: 'add', KeyG: 'group', KeyT: 'time', KeyK: 'sensor', KeyV: 'screen', KeyM: 'sound' };
  if (map[e.code]) actions[map[e.code]]();
  if (e.code === 'KeyE') toggleSit();
});

/** Sit down on the nearest bench, or get up again. */
function toggleSit() {
  if (player.seat) { player.standUp(); return; }
  const seat = nearestSeat();
  if (!seat) showHint('Walk up to a bench to sit down');
  else if (!player.sitAt(seat)) showHint('That seat is taken');
}

// ---------------------------------------------------------------- benches
function nearestSeat() {
  let best = null, bd = 1.4;
  for (const s of installation.seats) {
    const d = Math.min(s.front.distanceTo(player.pos), s.pos.distanceTo(player.pos));
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// ---------------------------------------------------------------- PiP of the LED wall feed
const pipScene = new THREE.Scene();
const pipCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
const pipQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), installation.screenMat);
pipScene.add(pipQuad);
const pipLabel = $('pipLabel');
const aspect = (LAYOUT.screen.z1 - LAYOUT.screen.z0) / (LAYOUT.screen.y1 - LAYOUT.screen.y0);

function renderPip() {
  if (pipMode === 'off') { pipLabel.style.display = 'none'; return; }
  const W = window.innerWidth, H = window.innerHeight;
  let w, h, x, y;
  if (pipMode === 'small') {
    w = Math.min(440, W * 0.34); h = w / aspect;
    x = W - w - 16;
    y = 16 + (camPanel.hidden ? 0 : 192 + 32 + 10); // bottom offset
  } else {
    w = W * 0.86; h = w / aspect;
    x = (W - w) / 2; y = 90;
  }
  renderer.setScissorTest(true);
  renderer.setScissor(x, y, w, h);
  renderer.setViewport(x, y, w, h);
  renderer.setRenderTarget(null);
  renderer.render(pipScene, pipCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
  pipLabel.style.display = 'block';
  pipLabel.style.left = `${x + 8}px`;
  pipLabel.style.bottom = `${y + h - 26}px`;
}

// ---------------------------------------------------------------- HUD refresh
let hudTimer = 0;
function updateHud(dt) {
  hudTimer -= dt;
  if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) $('hint').classList.remove('show'); }
  if (hudTimer > 0) return;
  hudTimer = 0.2;
  const s = installation.getState();
  $('sitBtn').innerHTML = `<i>E</i> ${player.seat ? 'Stand up' : 'Sit down'}`;
  document.querySelectorAll('#gestures button').forEach((b) => b.classList.toggle('active', player.gesture === b.dataset.g));
  if (pose.running) {
    camStatus.textContent = pose.poses.length
      ? `Tracking ${pose.poses.length} ${pose.poses.length === 1 ? 'person' : 'people'} · ${pose.fps} Hz${pose.player && !pose.player.legsVisible ? ' · legs not visible, animating legs' : ''}`
      : 'No person detected – step back so the camera sees your upper body';
  }
  if (!hintTimer) {
    const off = screenOffset(player.pos);
    const seat = nearestSeat();
    if (player.seat) showHint('You’re sitting on the bench – press E or walk to stand up', 0.4);
    else if (seat && !seat.occupant) showHint('Press E to sit on the bench', 0.4);
    else if (!s.playerAvatar && !onStage(player.pos) && off.d > 0 && off.d < 16 && Math.abs(off.lateral) < 11) showHint('Step onto the wooden stage to appear on the screen', 0.4);
    else if (off.d < 0) showHint('You’re behind the screen – follow the light strips round to the front', 0.4);
  }
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let t = 0, fps = 0, fpsN = 0, fpsT = 0;
let started = false;

// The LED wall's own 3D scene is redrawn every other frame (30 Hz is plenty for a screen).
let wallFrame = 0;
function renderFrame() {
  if (wallFrame++ % 2 === 0) installation.render(renderer);
  composer.render();
}

/**
 * Adaptive resolution: if the machine can't keep ~45 FPS, render fewer pixels; when it has been
 * running at full speed for a while, try a step higher again. Text/UI stays sharp (it's HTML).
 */
const scaler = { acc: 0, frames: 0, calmUntil: 4, slow: 0, pending: null };
function adaptResolution(rawDt, now) {
  if (rawDt > 0.25) return; // tab was in the background – not a real frame time
  if (now < scaler.calmUntil) { scaler.acc = 0; scaler.frames = 0; return; } // let shaders compile first
  scaler.acc += rawDt; scaler.frames++;
  if (scaler.acc < 1) return;
  const avgMs = (scaler.acc / scaler.frames) * 1000;
  scaler.acc = 0; scaler.frames = 0;
  const pr = renderer.getPixelRatio();
  // step down only after two slow seconds in a row, step up only after a long calm period
  scaler.slow = avgMs > 22 ? scaler.slow + 1 : 0;
  if (scaler.slow >= 2 && pr > 0.75) { scaler.pending = Math.max(0.75, pr - 0.25); scaler.slow = 0; scaler.calmUntil = now + 10; }
  else if (avgMs < 17.5 && pr < MAX_PIXEL_RATIO) { scaler.pending = Math.min(MAX_PIXEL_RATIO, pr + 0.25); scaler.calmUntil = now + 8; }
}

/**
 * Resizing the canvas clears it, so a new resolution is applied at the START of a frame, right
 * before drawing. (Applying it after drawing showed one empty, black frame.)
 */
function applyPendingResolution() {
  if (scaler.pending === null) return;
  renderer.setPixelRatio(scaler.pending);
  composer.setPixelRatio(scaler.pending);
  scaler.pending = null;
}

function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  simulate(dt);
  applyPendingResolution();
  renderFrame();
  renderPip();
  if (started) { updateHud(dt); adaptResolution(rawDt, t); }
  if (fpsEl) fpsEl.textContent = `${fps} fps · ${renderer.getPixelRatio()}×`;
}

// ?fps in the URL shows a small FPS counter (for testing on different machines)
const fpsEl = new URLSearchParams(location.search).has('fps') ? Object.assign(document.body.appendChild(document.createElement('div')), {
  style: 'position:fixed;top:8px;right:10px;z-index:30;font:600 12px ui-monospace,monospace;color:#39ff9f;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:6px',
}) : null;

function simulate(dt) {
  t += dt;
  fpsN++; fpsT += dt;
  if (fpsT > 1) { fps = fpsN; fpsN = 0; fpsT = 0; }

  if (pose.running) {
    pose.detect(performance.now());
    pose.drawPreview(camCanvas);
  }
  player.enabled = started;
  player.update(dt, t, pose.running ? pose.player : null);
  updateGuest(dt, t);
  const people = [player, ...crowd.agents, ...mp.people()];
  if (guest) people.push(guest);
  crowd.update(dt, t, people);
  mp.update(dt, t, guest);
  installation.update(dt, t, people, world.env);
  world.update(dt, t, camera);
  speech.update();
  audio.updateListener(camera);
  audio.setMood({
    onStage: installation.standing ?? 0,
    seated: installation.count - (installation.standing ?? 0),
    talking: installation.talking,
    dancing: installation.dancing,
  });
}

/** Debug: advance the simulation without rendering (works even when the tab is hidden). */
window.__sim = (seconds, step = 1 / 30) => { for (let i = 0; i < seconds / step; i++) simulate(step); };

/**
 * Debug: deterministic performance benchmark (works in hidden tabs too).
 * Renders `frames` frames back to back and reports average CPU+GPU milliseconds per part.
 * gl.finish() after each part makes the GPU time land in the right bucket.
 */
window.__bench = (frames = 60) => {
  const gl = renderer.getContext();
  const parts = { sim: 0, wall: 0, main: 0 };
  const time = (key, fn) => { const t0 = performance.now(); fn(); gl.finish(); parts[key] += performance.now() - t0; };
  renderer.info.autoReset = false;
  for (let i = 0; i < 5; i++) { simulate(1 / 60); renderFrame(); }
  gl.finish();
  renderer.info.reset();
  for (let i = 0; i < frames; i++) {
    time('sim', () => simulate(1 / 60));
    time('wall', () => { if (wallFrame++ % 2 === 0) installation.render(renderer); });
    time('main', () => composer.render());
  }
  const calls = Math.round(renderer.info.render.calls / frames);
  const tris = Math.round(renderer.info.render.triangles / frames);
  renderer.info.autoReset = true;
  const r = (v) => +(v / frames).toFixed(2);
  const total = r(parts.sim + parts.wall + parts.main);
  return {
    msPerFrame: total, fps: +(1000 / total).toFixed(1), sim: r(parts.sim), wall: r(parts.wall), main: r(parts.main),
    drawCalls: calls, triangles: tris,
    canvas: `${renderer.domElement.width}x${renderer.domElement.height}`, pixelRatio: renderer.getPixelRatio(),
  };
};

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
});

// ---------------------------------------------------------------- start
const enter = $('enter');
$('loading').textContent = '';
const nameInput = $('name');
$('roomInfo').innerHTML = partyHost()
  ? `Multiplayer · room <b>${roomName()}</b> · everyone who opens the same link ends up on the same square (change room with <code>?room=name</code>)`
  : 'Single-player (no room server configured)';
try { nameInput.value = localStorage.getItem('gh-name') || ''; } catch {}
// The on-screen online indicator was removed (feedback v2); the connection state is logged instead.
function updateOnline() {
  if (!started || !mp.net.socket) return;
  logEvent(mp.online ? `online · room ${mp.net.room} · ${mp.count} connected${mp.isHost ? ' · host' : ''}` : 'connecting…');
}
enter.onclick = () => {
  const name = (nameInput.value || '').trim() || `Neighbour ${Math.floor(Math.random() * 900 + 100)}`;
  try { localStorage.setItem('gh-name', name); } catch {}
  player.name = name;
  mp.start(name, player.rig.style);
  audio.init();
  started = true;
  scaler.calmUntil = t + 4; // the first seconds are slow while shaders compile – don't adapt yet
  $('start').hidden = true;
  $('hud').hidden = false;
  canvas.focus();
  logEvent('You arrive from the big street. Follow the light strips to the LED wall on the square.', 'kiosk');
  updateOnline();
};
frame();

// expose for debugging in the console
Object.assign(window, { THREE, scene, camera, player, crowd, installation, world, pose, mp, audio, renderer, composer });
