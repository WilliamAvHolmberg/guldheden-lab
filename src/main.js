import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildWorld, LAYOUT, screenOffset } from './world.js';
import { Speech } from './speech.js';
import { Installation, LEVELS, THEMES } from './installation.js';
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
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
const logEl = document.getElementById('log');
const events = [];
function logEvent(text, kind = '') {
  events.unshift({ text, kind });
  if (events.length > 8) events.pop();
  logEl.innerHTML = events.map((e) => `<li class="${e.kind}"><span class="k"></span>${e.text}</li>`).join('');
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
    addChat(name, text);
  },
});
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickKiosk(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(installation.buttons.map((b) => b.hit), false);
  return hits.length ? hits[0].object.userData.kioskButton : null;
}
const nearKiosk = () => player.pos.distanceTo(installation.kioskPos) < 3.2;

const player = new Player(scene, camera, canvas, {
  style: playerStyle(mp.id),
  obstacles: world.obstacles,
  buildings: world.buildings,
  onClick: (x, y) => {
    const id = pickKiosk(x, y);
    if (!id) return;
    if (!nearKiosk()) { showHint('Walk up to the pillar to press its buttons'); return; }
    installation.pressButton(id);
    player.play('wave');
  },
  onHover: (x, y) => {
    const id = pickKiosk(x, y);
    installation.setHover(id && nearKiosk() ? id : null);
    canvas.style.cursor = id ? (nearKiosk() ? 'pointer' : 'not-allowed') : 'default';
  },
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
  const btn = document.getElementById('camBtn');
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
let pipMode = 'small';
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
    audio.setNight(world.env.night);
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
  if (e.code === 'KeyE') {
    if (player.seat) { player.standUp(); return; }
    const seat = nearestSeat();
    if (seat) {
      if (!player.sitAt(seat)) showHint('Den platsen är upptagen');
    } else if (nearKiosk()) {
      const order = ['1944', '1958', 'kids'];
      installation.pressButton(order[(order.indexOf(installation.theme) + 1) % order.length]);
    }
  }
  if (e.code === 'Enter') { e.preventDefault(); chatInput.focus(); }
});

// ---------------------------------------------------------------- benches
function nearestSeat() {
  let best = null, bd = 1.4;
  for (const s of installation.seats) {
    const d = Math.min(s.front.distanceTo(player.pos), s.pos.distanceTo(player.pos));
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// ---------------------------------------------------------------- chat
const chatInput = $('chatInput');
const chatLog = $('chatLog');
const chatLines = [];
function escapeHtml(t) { return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function addChat(name, text, self = false) {
  chatLines.push({ name, text, self, at: performance.now() });
  if (chatLines.length > 7) chatLines.shift();
  chatLog.innerHTML = chatLines.map((l) => `<li class="${l.self ? 'self' : ''}"><b>${escapeHtml(l.name)}</b> ${escapeHtml(l.text)}</li>`).join('');
}
chatInput.addEventListener('focus', () => player.keys.clear());
chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') { chatInput.value = ''; chatInput.blur(); }
  if (e.key !== 'Enter') return;
  const text = chatInput.value.replace(/\s+/g, ' ').trim().slice(0, 140);
  chatInput.value = '';
  chatInput.blur();
  canvas.focus();
  if (!text) return;
  speech.say(player, text, { name: player.name });
  addChat(player.name, text, true);
  mp.chat(text);
});

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
  $('count').textContent = s.count;
  document.querySelectorAll('#meter div').forEach((d) => d.classList.toggle('on', Number(d.dataset.l) <= s.level));
  $('levelName').textContent = `${s.level} · ${LEVELS[s.level].en}`;
  $('themeName').textContent = THEMES[s.theme].caption;
  $('avatarName').textContent = s.playerAvatar ? `${s.playerAvatar.sv}` : '— step into the zone';
  $('avatarName').title = s.playerAvatar ? s.playerAvatar.en : '';
  $('filterState').textContent = s.filterActive ? 'suppressing gesture' : 'idle';
  $('filterRow').classList.toggle('active', s.filterActive);
  $('fps').textContent = `${fps} fps`;
  document.querySelectorAll('#gestures button').forEach((b) => b.classList.toggle('active', player.gesture === b.dataset.g));
  if (pose.running) {
    camStatus.textContent = pose.poses.length
      ? `Tracking ${pose.poses.length} ${pose.poses.length === 1 ? 'person' : 'people'} · ${pose.fps} Hz${pose.player && !pose.player.legsVisible ? ' · legs not visible, animating legs' : ''}`
      : 'No person detected – step back so the camera sees your upper body';
  }
  if (!hintTimer) {
    const off = screenOffset(player.pos);
    const seat = nearestSeat();
    if (player.seat) showHint('Du sitter på bänken – tryck E eller gå för att resa dig', 0.4);
    else if (seat && !seat.occupant) showHint('Tryck E för att sätta dig på bänken', 0.4);
    else if (nearKiosk()) showHint('Click the buttons on the pillar (or press E) to change the era', 0.4);
    else if (!s.playerAvatar && off.d > 0 && off.d < 16 && Math.abs(off.lateral) < 11) showHint('Walk closer to the screen – the sensors will pick you up', 0.4);
    else if (off.d < 0) showHint('Du står bakom skärmen – följ ljusslingorna runt till framsidan', 0.4);
  }
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let t = 0, fps = 0, fpsN = 0, fpsT = 0;
let started = false;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  simulate(dt);
  installation.render(renderer);
  composer.render();
  renderPip();
  if (started) updateHud(dt);
}

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
}

/** Debug: advance the simulation without rendering (works even when the tab is hidden). */
window.__sim = (seconds, step = 1 / 30) => { for (let i = 0; i < seconds / step; i++) simulate(step); };

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
  ? `Multiplayer · rum <b>${roomName()}</b> · alla som öppnar samma länk hamnar på samma torg (byt rum med <code>?room=namn</code>)`
  : 'Single-player (ingen PartyKit-server konfigurerad)';
try { nameInput.value = localStorage.getItem('gh-name') || ''; } catch {}
function updateOnline() {
  const el = $('online');
  if (!started) return;
  if (!mp.net.socket) { el.textContent = 'Single-player'; el.className = 'off'; return; }
  el.className = mp.online ? 'on' : 'off';
  el.innerHTML = mp.online
    ? `● Online · rum <b>${mp.net.room}</b> · ${mp.count} ${mp.count === 1 ? 'person' : 'personer'}${mp.isHost ? ' · värd' : ''}`
    : '○ Ansluter…';
}
$('online').onclick = () => {
  const url = `${location.origin}${location.pathname}?room=${mp.net.room}`;
  navigator.clipboard?.writeText(url).then(() => showHint('Länk till rummet kopierad – skicka den till en kompis!'));
};
enter.onclick = () => {
  const name = (nameInput.value || '').trim() || `Granne ${Math.floor(Math.random() * 900 + 100)}`;
  try { localStorage.setItem('gh-name', name); } catch {}
  player.name = name;
  mp.start(name, player.rig.style);
  audio.init();
  started = true;
  $('start').hidden = true;
  $('hud').hidden = false;
  canvas.focus();
  logEvent('You arrive from the big street. Follow the light strips to the LED wall on the square.', 'kiosk');
  updateOnline();
};
frame();

// expose for debugging in the console
Object.assign(window, { THREE, scene, camera, player, crowd, installation, world, pose, mp });
