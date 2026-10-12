import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {
  Rig, HISTORICAL, animIdle, animWalk, animTalk, animGesture, animAction, animCycle, GESTURE_ACTION, BONES, JOINTS, M,
} from './character.js';
import { FACTS } from './facts.js';
import { LAYOUT, STAGE, STAGE_GATES, STAGE_GATE_W, toScreenLocal, screenToWorld, onStage, hipRoof } from './world.js';
import { hashStr } from './net.js';
import { staticBatch } from './batch.js';
import {
  rng, makeCanvas, toTexture, gradientSkyTexture, signTexture, sparkleTexture,
  heartTexture, stageFloorTexture, backPanelTexture, plazaField1944Texture, lawn1944Texture,
} from './textures.js';

export const LEVELS = [
  { en: 'Attract mode', short: 'Waiting' },
  { en: 'One visitor', short: 'Solo' },
  { en: 'Two visitors', short: 'Duo' },
  { en: 'Group', short: 'Group' },
  { en: 'Festival', short: 'Festival' },
];

// The wall only shows the 1940s square (feedback v2: the 1958 and children's-drawing eras were removed).
export const THEMES = {
  1944: { caption: 'GULDHEDSTORGET · 1944', sub: 'From the archive' },
};


const SCREEN = LAYOUT.screen;
const SCREEN_W = SCREEN.z1 - SCREEN.z0;
const SCREEN_H = SCREEN.y1 - SCREEN.y0;
const SCREEN_C = new THREE.Vector3(SCREEN.x, (SCREEN.y0 + SCREEN.y1) / 2, (SCREEN.z0 + SCREEN.z1) / 2);
const RT_W = 2048, RT_H = Math.round(2048 * SCREEN_H / SCREEN_W);

// Player colours (feedback v4): a ring under each avatar on the screen, the bench / footprints
// someone uses, and the circle round a dance all light up in that person's colour.
export const PLAYER_COLORS = ['#ff4f6d', '#ffb703', '#2ec4b6', '#4d96ff', '#b46cff', '#7ad151', '#ff7f3f', '#f15bb5', '#00c2ff', '#e9d758'];

// The painted footprint groups on the stage floor (installation-local x, z of each pair, read off
// stageFloorTexture: 160 px per metre, canvas x → local z, canvas y → distance from the screen).
//   talk spot: two pairs  – two people on it stay in conversation, nobody else can join them
//   dance spot: three pairs – dancing starts when all three are taken
const PX = 160;
const fromCanvas = (cx, cy) => ({ x: STAGE.x1 - (cy + 6) / PX, z: STAGE.z0 + cx / PX });
const TALK_X = 2048 * 0.27, DANCE_X = 2048 * 0.73, SPOT_Y = 1120 * 0.5;
export const FOOT_SPOTS = [
  { spot: 'talk', ...fromCanvas(TALK_X - 70, SPOT_Y) },
  { spot: 'talk', ...fromCanvas(TALK_X + 70, SPOT_Y) },
  { spot: 'dance', ...fromCanvas(DANCE_X - 120, SPOT_Y + 30) },
  { spot: 'dance', ...fromCanvas(DANCE_X, SPOT_Y - 40) },
  { spot: 'dance', ...fromCanvas(DANCE_X + 120, SPOT_Y + 30) },
];
const FOOT_R = 0.5;

// bicycle loop on the screen for avatars whose person sits on a bench
const BIKE = { rx: 3.4, rz: 0.9, cz: 1.2, speed: 0.45 }; // standing within this of a footprint pair counts as standing on it

// Social meter (feedback v4): being on the stage counts a little, doing things together a lot.
// Three people dancing fill it; then fireworks.
const SOCIAL = { onStage: 1, talking: 2.5, dancing: 4.5, full: 13.5, charge: 0.12, drain: 0.05 };

// The avatar asks itself what a gesture might do when its person has stood still for a while
const NUDGE_AFTER = 7; // seconds without moving
const NUDGE_FOR = 5;
const NUDGES = [
  'What will happen if I jump?', 'What will happen when I clap?', 'What happens if I wave?',
  'What if I dance?', 'What if I spread my arms like a plane?', 'What happens if I take a bow?',
];

// fact bubbles over chatting avatars (feedback v4: stay longer, dim out slowly, bigger text)
const FACT_TURN = 9; // seconds per fact
const FACT_FADE_IN = 0.4;
const FACT_DIM = 3; // the last seconds of a turn, the bubble slowly dims out

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export { onStage };

export class Installation {
  constructor(scene, renderer, { obstacles, onEvent = () => {}, audio = null }) {
    RectAreaLightUniformsLib.init();
    this.scene = scene;
    this.renderer = renderer;
    this.onEvent = onEvent;
    this.audio = audio;
    this.rand = rng(99);
    this.time = 0;
    this.energy = 0;
    this.level = 0;
    this.count = 0;
    this.theme = '1944';
    this.fade = 1;
    this.tracked = new Map(); // personId -> track
    this.groups = new Map(); // memberKey -> chat/dance group
    this.talking = false;
    this.dancing = false;
    this.colour = 0; // 0 = black & white (nobody on stage), 1 = full colour
    this.spotLevel = 0;
    this.danceLevel = 0;
    this.sensorView = false;
    this.muted = false;
    this.onShared = null; // (patch) => void, called when the local user changes shared state
    this.toast = null;
    this.overlayDirty = true;
    this.overlayTimer = 0;
    this.filterActive = false;
    this.social = 0; // social meter shown on the wall, 0..1
    this.socialTarget = 0;
    this.socialDrawn = -1;
    this.fireworkCd = 0;
    this.full = false;

    this.hw = new THREE.Group();
    scene.add(this.hw);

    this.buildArchive();
    this.buildScreen();
    this.buildHardware(obstacles);
    this.buildLights(obstacles);
    this.buildSensorViz();
    this.buildGuides();
    this.buildFootGlows();
    // place the whole installation (built in its local frame) out on the square
    this.hw.position.set(LAYOUT.screen.cx, 0, LAYOUT.screen.cz);
    this.hw.rotation.y = LAYOUT.screen.rot;
    this.hw.updateMatrixWorld(true);
    this.finalizeSeats();
    for (const s of this.spots) s.beam.userData.dynamic = true; // shown/hidden with the level
    staticBatch(this.hw);
    this.guidePhase = 0;
  }

  // =====================================================================
  // Archive scene (what the LED wall shows)
  // =====================================================================
  buildArchive() {
    this.rt = new THREE.WebGLRenderTarget(RT_W, RT_H, { samples: 4, type: THREE.HalfFloatType });
    const s = (this.archive = new THREE.Scene());
    this.archiveCam = new THREE.PerspectiveCamera(28, RT_W / RT_H, 0.1, 200);
    this.archiveCam.position.set(0, 1.55, 9.5);
    this.archiveCam.lookAt(0, 2.0, -1); // tilted up a little so roofs and sky show, like the 1944 photo

    const hemi = new THREE.HemisphereLight('#fff4e0', '#6a5a48', 1.1);
    s.add(hemi);
    const key = new THREE.DirectionalLight('#ffffff', 2.4);
    key.position.set(-6, 12, 10);
    key.target.position.set(0, 0, -2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 50 });
    key.shadow.bias = -0.0005;
    s.add(key, key.target);
    this.stageKey = key;

    const stage = this.buildStage1944();
    staticBatch(stage);
    s.add(stage);
    s.background = gradientSkyTexture('#4f7f86', '#c3d3c8'); // the teal Agfacolor sky of the 1944 photo

    // festive layers that escalate with the crowd
    this.fx = new THREE.Group();
    s.add(this.fx);
    this.buildCars();
    this.buildBunting();
    this.buildStageLights();
    this.buildConfetti();
    this.buildParticles();
    this.buildFireworks();

    // archive extras: historical passers-by walking in the background
    this.extras = [];
    const r = rng(5);
    for (let i = 0; i < 12; i++) {
      const style = HISTORICAL[(i * 5 + 3) % HISTORICAL.length];
      const rig = new Rig(style);
      rig.root.visible = false;
      s.add(rig.root);
      this.extras.push({
        rig, active: false, x: 0, z: -3.6 - r(), dir: 1, speed: 0.8 + r() * 0.5, phase: r() * 10,
        seed: r() * 10, lane: -3.6 - r(), danceOffset: r() * 3, // on the paving in front of the lawn
      });
    }

    // overlay (captions, level meter, attract text)
    this.overlayCanvas = makeCanvas(RT_W, RT_H);
    this.overlayTex = toTexture(this.overlayCanvas, { wrap: false });
    this.overlayTex.colorSpace = THREE.SRGBColorSpace;
  }

  stageGround(color, tex = null, tile = 4) {
    const g = new THREE.PlaneGeometry(80, 40);
    if (tex) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 80 / tile, uv.getY(i) * 40 / tile);
    }
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, map: tex, roughness: 0.9 }));
    m.rotation.x = -Math.PI / 2;
    m.position.z = -10;
    m.receiveShadow = true;
    return m;
  }

  windowGrid(group, x0, y0, z, cols, rows, dx, dy, w, h, mat, faceX = false) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(faceX ? 0.05 : w, h, faceX ? w : 0.05), mat, cols * rows);
    const o = new THREE.Object3D();
    let i = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (faceX) o.position.set(x0, y0 + r * dy, z + c * dx); else o.position.set(x0 + c * dx, y0 + r * dy, z);
      o.updateMatrix();
      im.setMatrixAt(i++, o.matrix);
    }
    group.add(im);
    return im;
  }

  /**
   * Guldhedstorget in 1944, rebuilt from the colour photo of the square: the low shop building with a
   * dark roof and red awning on the left, the grey point block behind it, the long white building with
   * a red tile roof and its tobacconist and café on the right, the flagpole, the lawn with green benches,
   * white flower boxes and young birches, and a street where 1940s cars drive past.
   */
  buildStage1944() {
    const g = new THREE.Group();
    const r = rng(44);
    const add = (geo, mat, x, y, z, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = cast;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const winMat = M('#2c3238', 0.25, 0.4), frameMat = M('#f2efe6', 0.7);
    // the square as in the 1940s photos: big rectangular fields (6 × 4 m) of pale natural-stone flags,
    // framed by bands of darker setts. 78 m wide = 13 fields, so a frame line runs through x = ±3.
    {
      const geo = new THREE.PlaneGeometry(78, 40);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 78 / 6, uv.getY(i) * 40 / 4);
      const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: toTexture(plazaField1944Texture(6, 4)), roughness: 0.9 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.z = -10; // frame lines at z = 10, 6, 2, -2, -6, -10 (along the street kerb)
      ground.receiveShadow = true;
      g.add(ground);
    }
    // the street the cars use, with a kerb on each side
    add(new THREE.BoxGeometry(80, 0.02, 2.8), M('#a39d90', 0.95), 0, 0.012, -11.75, false); // pale, dusty 1940s asphalt
    add(new THREE.BoxGeometry(80, 0.1, 0.25), M('#d8d2c4', 0.9), 0, 0.05, -10.25, false); // light granite kerbs
    add(new THREE.BoxGeometry(80, 0.1, 0.25), M('#d8d2c4', 0.9), 0, 0.05, -13.25, false);

    // lawn with green slatted benches and white flower boxes (front left in the photo)
    const benchGreen = M('#2d5a39', 0.7), white = M('#f3efe4', 0.8);
    const flowerCols = ['#d2384a', '#e9677a', '#f2c14e', '#c43b6b'];
    const lawnTex = toTexture(lawn1944Texture(), { repeat: [17 / 4, 4.6 / 4] });
    add(new THREE.BoxGeometry(17, 0.1, 4.6), new THREE.MeshStandardMaterial({ map: lawnTex, roughness: 1 }), -10.5, 0.05, -7.3, false);
    // low light-stone kerb around the lawn
    const kerb = M('#ddd7c9', 0.9);
    add(new THREE.BoxGeometry(17.3, 0.14, 0.15), kerb, -10.5, 0.07, -4.95, false);
    add(new THREE.BoxGeometry(17.3, 0.14, 0.15), kerb, -10.5, 0.07, -9.65, false);
    add(new THREE.BoxGeometry(0.15, 0.14, 4.85), kerb, -1.93, 0.07, -7.3, false);
    // front-left lawn (foreground of the photo), left of where the avatars stand; the walkers' path runs between the lawns
    const frontLawn = toTexture(lawn1944Texture(), { repeat: [12.4 / 4, 4.1 / 4] });
    add(new THREE.BoxGeometry(12.4, 0.1, 4.1), new THREE.MeshStandardMaterial({ map: frontLawn, roughness: 1 }), -12.8, 0.05, -0.65, false);
    add(new THREE.BoxGeometry(12.7, 0.14, 0.15), kerb, -12.8, 0.07, -2.75, false);
    add(new THREE.BoxGeometry(12.7, 0.14, 0.15), kerb, -12.8, 0.07, 1.45, false);
    add(new THREE.BoxGeometry(0.15, 0.14, 4.35), kerb, -6.55, 0.07, -0.65, false);
    for (const x of [-11.2, -8.4]) {
      add(new THREE.BoxGeometry(1.7, 0.06, 0.45), benchGreen, x, 0.48, -1.9);
      add(new THREE.BoxGeometry(1.7, 0.45, 0.05), benchGreen, x, 0.78, -2.15).rotation.x = -0.15;
      for (const lx of [-0.75, 0.75]) add(new THREE.BoxGeometry(0.06, 0.48, 0.4), white, x + lx, 0.24, -1.95);
    }
    add(new THREE.BoxGeometry(0.9, 0.42, 0.6), white, -9.8, 0.31, -2.2);
    for (let k = 0; k < 7; k++) {
      add(new THREE.SphereGeometry(0.1 + r() * 0.05, 8, 6), M(flowerCols[k % flowerCols.length], 0.8), -9.8 + (r() - 0.5) * 0.7, 0.6, -2.2 + (r() - 0.5) * 0.4, false);
    }
    for (let i = 0; i < 6; i++) {
      const x = -17.5 + i * 2.7;
      // bench: seat + back + white legs
      add(new THREE.BoxGeometry(1.7, 0.06, 0.45), benchGreen, x, 0.48, -6.2);
      add(new THREE.BoxGeometry(1.7, 0.45, 0.05), benchGreen, x, 0.78, -6.45).rotation.x = -0.15;
      for (const lx of [-0.75, 0.75]) add(new THREE.BoxGeometry(0.06, 0.48, 0.4), white, x + lx, 0.24, -6.25);
      // flower box between the benches
      if (i < 5) {
        const bx = x + 1.35;
        add(new THREE.BoxGeometry(0.9, 0.42, 0.6), white, bx, 0.31, -6.6);
        for (let k = 0; k < 7; k++) {
          add(new THREE.SphereGeometry(0.1 + r() * 0.05, 8, 6), M(flowerCols[(i + k) % flowerCols.length], 0.8), bx + (r() - 0.5) * 0.7, 0.6, -6.6 + (r() - 0.5) * 0.4, false);
        }
      }
    }

    // young birches along the lawn and the street
    const birchBark = M('#ece8de', 0.8), birchMark = M('#2b2724', 0.9), birchLeaf = M('#7fa24a', 1);
    for (const [x, z] of [[-15.5, -9.4], [-9.5, -9.6], [-4.2, -9.4], [5.5, -9.5], [11, -9.4], [16.5, -9.6]]) {
      add(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 8), birchBark, x, 2.1, z);
      for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.16, 0.05, 0.16), birchMark, x, 0.6 + k * 0.85 + r() * 0.3, z, false);
      for (let k = 0; k < 4; k++) {
        const b = add(new THREE.IcosahedronGeometry(0.75 + r() * 0.35, 1), birchLeaf, x + (r() - 0.5) * 1.1, 3.6 + r() * 1.3, z + (r() - 0.5) * 0.8);
        b.scale.y = 1.3;
      }
    }
    // globe street lamp on the left
    add(new THREE.CylinderGeometry(0.05, 0.08, 4.4, 8), M('#1c1c1c', 0.5, 0.5), -13.5, 2.2, -4.8);
    add(new THREE.SphereGeometry(0.28, 16, 12), M('#f7f2e2', 0.3, 0, { emissive: '#ffe4b0', emissiveIntensity: 0.25 }), -13.5, 4.55, -4.8);

    // left: low shop building with a dark roof, small triangular dormers and a long red awning
    add(new THREE.BoxGeometry(18, 3.4, 7), M('#e9e3d2', 0.95), -16, 1.7, -18.5);
    const lowRoof = add(hipRoof(7.8, 18.8, 3.4), M('#3d4148', 0.7, 0.05, { side: THREE.DoubleSide }), -16, 3.4, -18.5);
    lowRoof.rotation.y = Math.PI / 2;
    for (const x of [-22, -18.5, -15, -11.5]) {
      const tri = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 0.75)]);
      add(new THREE.ShapeGeometry(tri), M('#f0ede4', 0.6), x, 4.65, -16.05, false); // sits on the roof slope
    }
    this.windowGrid(g, -23.5, 1.3, -14.97, 6, 1, 3, 0, 2.3, 1.8, winMat);
    const awning = add(new THREE.BoxGeometry(18, 0.1, 1.5), M('#b5332b', 0.8), -16, 2.85, -14.3);
    awning.rotation.x = 0.32;
    add(new THREE.BoxGeometry(18, 0.28, 0.06), M('#b5332b', 0.8), -16, 2.62, -13.58, false);

    // behind: the grey-beige point block, nine storeys
    add(new THREE.BoxGeometry(10, 27, 9), M('#b8b0a2', 0.95), -6.5, 13.5, -29);
    this.windowGrid(g, -10.3, 2.2, -24.47, 4, 9, 2.5, 2.9, 1.1, 1.35, winMat);
    for (let fl = 1; fl < 9; fl += 2) add(new THREE.BoxGeometry(1.8, 0.12, 0.7), M('#9d968a', 0.9), -2.8, 1.5 + fl * 2.9, -24.2);
    // far left: a block still under construction, with scaffolding
    add(new THREE.BoxGeometry(12, 9, 8), M('#cfc8b8', 0.95), -31, 4.5, -27);
    const pole = M('#6b5a44', 0.9);
    for (let x = -37; x <= -25; x += 1.5) add(new THREE.BoxGeometry(0.08, 11, 0.08), pole, x, 5.5, -22.7, false);
    for (let y = 1.5; y <= 10.5; y += 1.8) add(new THREE.BoxGeometry(12.5, 0.08, 0.08), pole, -31, y, -22.7, false);

    // right: the long white building with a red tile roof, café and tobacconist on the ground floor
    const LX = 9, LW = 30, LD = 7, LH = 8.2;
    add(new THREE.BoxGeometry(LW, LH, LD), M('#f1eee6', 0.95), LX, LH / 2, -19.5);
    const roof = add(hipRoof(LD + 0.8, LW + 0.8, 2.4), M('#b0523a', 0.85, 0, { side: THREE.DoubleSide }), LX, LH, -19.5);
    roof.rotation.y = Math.PI / 2;
    add(new THREE.BoxGeometry(0.8, 1.6, 0.8), M('#9a3f2c', 0.9), LX + 6, LH + 1.6, -20); // chimney
    // two rows of upper windows, some with small balconies
    for (let row = 0; row < 2; row++) {
      for (let k = 0; k < 10; k++) {
        const x = LX - LW / 2 + 1.6 + k * 2.95, y = 4.4 + row * 2.4;
        add(new THREE.BoxGeometry(1.25, 1.15, 0.05), frameMat, x, y, -15.98, false);
        add(new THREE.BoxGeometry(1.05, 0.95, 0.06), winMat, x, y, -15.97, false);
        if ((k + row) % 4 === 1) add(new THREE.BoxGeometry(1.5, 0.08, 0.5), M('#dcd6c8', 0.8), x, y - 0.65, -15.7);
      }
    }
    // shopfronts + painted sign band
    this.windowGrid(g, LX - LW / 2 + 2.2, 1.45, -15.97, 7, 1, 4.1, 0, 3.2, 2.1, winMat);
    add(new THREE.BoxGeometry(LW, 0.55, 0.06), M('#e3ddd0', 0.8), LX, 3.0, -15.95, false);
    for (const [txt, x, fg] of [['Tobacco', LX - 7, '#b5332b'], ['Café', LX + 3, '#2d5a39'], ['Flowers', LX + 10, '#b5332b']]) {
      const sgn = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.5), new THREE.MeshStandardMaterial({ map: signTexture(txt, { bg: '#e3ddd0', fg, font: 'italic bold 62px Georgia, serif' }) }));
      sgn.position.set(x, 3.0, -15.9);
      g.add(sgn);
    }

    // the flagpole with the Swedish flag
    add(new THREE.CylinderGeometry(0.06, 0.09, 11, 10), M('#f4f1ea', 0.5), 0.5, 5.5, -10.4);
    const fc = makeCanvas(160, 100), fx = fc.getContext('2d');
    fx.fillStyle = '#006aa7'; fx.fillRect(0, 0, 160, 100);
    fx.fillStyle = '#fecc00'; fx.fillRect(50, 0, 20, 100); fx.fillRect(0, 40, 160, 20);
    const flagGeo = new THREE.PlaneGeometry(2.0, 1.25, 16, 4);
    flagGeo.translate(1.0, 0, 0);
    this.flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ map: toTexture(fc, { wrap: false }), side: THREE.DoubleSide }));
    this.flag.userData.dynamic = true; // waves every frame
    this.flag.position.set(0.55, 10.3, -10.4);
    this.flagBase = flagGeo.attributes.position.array.slice();
    g.add(this.flag);
    return g;
  }

  /** 1940s cars that drive past behind the square while the stage is empty. */
  buildCars() {
    this.cars = [
      { color: '#27352c', dir: 1, lane: -11.2, delay: 0 },
      { color: '#1b1b1d', dir: -1, lane: -12.3, delay: 6 },
      { color: '#5d7a5c', dir: 1, lane: -11.2, delay: 13, van: true },
    ].map((c) => {
      const g = vintageCar(c.color, c.van);
      g.visible = false;
      this.archive.add(g);
      return { ...c, g, x: 0, wait: c.delay, driving: false };
    });
  }

  updateCars(dt) {
    for (const c of this.cars) {
      if (!c.driving) {
        c.wait -= dt;
        // new trips only start while nobody is on the stage
        if (c.wait <= 0 && this.count === 0) {
          c.driving = true;
          c.x = -c.dir * 26;
          c.g.visible = true;
        }
        continue;
      }
      c.x += c.dir * 5.5 * dt;
      c.g.position.set(c.x, 0, c.lane);
      c.g.rotation.y = c.dir > 0 ? 0 : Math.PI;
      for (const w of c.g.userData.wheels) w.rotation.z -= c.dir * dt * 5.5 / 0.33;
      if (Math.abs(c.x) > 26) {
        c.driving = false;
        c.g.visible = false;
        c.wait = 4 + this.rand() * 8;
      }
    }
  }

  buildBunting() {
    this.bunting = new THREE.Group();
    const cols = ['#e63946', '#f1c453', '#2a9d8f', '#457b9d', '#f4a261', '#ffffff'];
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.22, 0, 0, 0.22, 0, 0, 0, -0.42, 0], 3));
    tri.computeVertexNormals();
    for (const [y, z, sag] of [[4.3, -3.5, 0.6], [5.0, -6.5, 0.8]]) {
      const n = 34;
      for (let i = 0; i <= n; i++) {
        const u = i / n, x = -13 + 26 * u;
        const yy = y - sag * 4 * u * (1 - u);
        const f = new THREE.Mesh(tri, M(cols[i % cols.length], 0.8, 0, { side: THREE.DoubleSide }));
        f.position.set(x, yy, z);
        this.bunting.add(f);
      }
    }
    this.fx.add(this.bunting);
  }

  buildStageLights() {
    // string of bulbs above the stage + moving spot cones
    const n = 40;
    this.stageBulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), n);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      o.position.set(-13 + 26 * u, 4.6 - 0.5 * 4 * u * (1 - u), -2.5);
      o.updateMatrix();
      this.stageBulbs.setMatrixAt(i, o.matrix);
      this.stageBulbs.setColorAt(i, new THREE.Color().setHSL((i * 0.13) % 1, 0.7, 0.6));
    }
    this.fx.add(this.stageBulbs);
    this.stageCones = [];
    const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
    coneGeo.translate(0, -0.5, 0);
    coneGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(coneGeo, beamMaterial());
      m.position.set(-6 + i * 6, 7.5, -1);
      m.scale.set(1.6, 1.6, 9);
      m.lookAt((i - 1) * 3.5, 0, 1.5);
      this.fx.add(m);
      this.stageCones.push(m);
    }
  }

  buildConfetti() {
    const n = 500;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const r = rng(3);
    this.confettiVel = [];
    for (let i = 0; i < n; i++) {
      pos.set([(r() - 0.5) * 20, r() * 8, -r() * 6 + 2], i * 3);
      const c = new THREE.Color().setHSL(r(), 0.8, 0.6);
      col.set([c.r, c.g, c.b], i * 3);
      this.confettiVel.push(0.6 + r() * 0.8, r() * 10);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.confetti = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 1 }));
    this.fx.add(this.confetti);
  }

  buildParticles() {
    // sparkles & hearts emitted by avatars
    this.particles = [];
    const sparkle = sparkleTexture(), heart = heartTexture();
    this.particleMats = {
      sparkle: new THREE.SpriteMaterial({ map: sparkle, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      heart: new THREE.SpriteMaterial({ map: heart, transparent: true, depthWrite: false }),
    };
    for (let i = 0; i < 80; i++) {
      const sp = new THREE.Sprite(this.particleMats.sparkle.clone());
      sp.visible = false;
      this.archive.add(sp);
      this.particles.push({ sp, life: 0, max: 1, vel: new THREE.Vector3() });
    }
  }

  emit(kind, pos, n = 8, spread = 0.6, up = 1.0) {
    let k = 0;
    for (const p of this.particles) {
      if (p.life > 0) continue;
      p.sp.material.map = this.particleMats[kind].map;
      p.sp.material.blending = kind === 'heart' ? THREE.NormalBlending : THREE.AdditiveBlending;
      p.sp.material.needsUpdate = true;
      p.sp.position.copy(pos).add(_v.set((this.rand() - 0.5) * spread, (this.rand() - 0.5) * spread, (this.rand() - 0.5) * spread * 0.5));
      p.vel.set((this.rand() - 0.5) * 0.6, up * (0.4 + this.rand() * 0.8), 0);
      p.max = p.life = 1.2 + this.rand() * 0.8;
      p.size = kind === 'heart' ? 0.28 + this.rand() * 0.12 : 0.18 + this.rand() * 0.2;
      p.sp.visible = true;
      if (++k >= n) break;
    }
  }

  // =====================================================================
  // Screen hardware in the real square
  // =====================================================================
  buildScreen() {
    this.screenMat = new THREE.ShaderMaterial({
      toneMapped: false,
      uniforms: {
        map: { value: this.rt.texture },
        overlay: { value: this.overlayTex },
        saturation: { value: 0 },
        grain: { value: 0.12 },
        time: { value: 0 },
        fade: { value: 1 },
        brightness: { value: 1.1 },
        pixels: { value: new THREE.Vector2(640, Math.round(640 * SCREEN_H / SCREEN_W)) },
        gridAmt: { value: 0.55 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map, overlay;
        uniform float saturation, grain, time, fade, brightness, gridAmt;
        uniform vec2 pixels;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 uv = vUv;
          // slight gate weave at low energy (old film)
          uv.y += grain * 0.004 * sin(time * 23.0);
          vec3 c = texture2D(map, uv).rgb;
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          vec3 mono = vec3(l * 1.03, l, l * 0.94); // vintage black & white, a touch warm
          vec3 col = mix(mono, c, clamp(saturation, 0.0, 1.0));
          // extra vibrance above 1.0
          float vib = max(saturation - 1.0, 0.0);
          col = mix(vec3(dot(col, vec3(0.333))), col, 1.0 + vib * 1.5);
          // grain, flicker, scratches
          float n = hash(uv * vec2(1920.0, 480.0) + fract(time * 7.13));
          col += (n - 0.5) * grain * 0.9;
          col *= 1.0 - grain * 0.25 * (0.5 + 0.5 * sin(time * 31.0));
          float scratch = step(0.9975, hash(vec2(floor(uv.x * 700.0), floor(time * 14.0))));
          col += scratch * grain * 1.8;
          // vignette
          vec2 d = (vUv - 0.5) * vec2(1.0, 2.2);
          col *= 1.0 - dot(d, d) * (0.15 + grain * 1.8);
          // overlay text
          vec4 o = texture2D(overlay, vUv);
          col = mix(col, o.rgb, o.a);
          col *= fade;
          // LED pixel grid, faded out when the pixels are smaller than a screen pixel
          vec2 pp = vUv * pixels;
          float fw = max(fwidth(pp.x), fwidth(pp.y));
          vec2 f = fract(pp);
          float cell = smoothstep(0.0, 0.18, f.x) * smoothstep(1.0, 0.82, f.x) * smoothstep(0.0, 0.18, f.y) * smoothstep(1.0, 0.82, f.y);
          float g = gridAmt * (1.0 - smoothstep(0.25, 0.7, fw));
          col *= mix(1.0, 0.45 + 0.75 * cell, g);
          gl_FragColor = vec4(max(col, 0.0) * brightness, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), this.screenMat);
    screen.position.copy(SCREEN_C);
    screen.rotation.y = -Math.PI / 2;
    this.hw.add(screen);
    this.screenMesh = screen;
  }

  /** Push an obstacle given in installation-local coordinates (rotations in 90° steps only). */
  addObstacle(obstacles, o) {
    if (o.t === 'circle') {
      const w = screenToWorld(o.x, o.z);
      obstacles.push({ t: 'circle', x: w.x, z: w.z, r: o.r });
      return;
    }
    const a = screenToWorld(o.x0, o.z0), b = screenToWorld(o.x1, o.z1);
    obstacles.push({ t: 'box', x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) });
  }

  buildHardware(obstacles) {
    const black = M('#0d0f12', 0.35, 0.6);
    const alu = M('#2a2d31', 0.35, 0.8);
    const steel = M('#1b1e22', 0.45, 0.7);
    const x = SCREEN.x;
    const halfW = SCREEN_W / 2;
    const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; this.hw.add(m); return m; };
    // freestanding LED cabinet on a concrete ballast plinth, out on the square
    add(new THREE.BoxGeometry(0.34, SCREEN_H + 0.4, SCREEN_W + 0.5), black, x + 0.19, SCREEN_C.y, 0);
    add(new THREE.BoxGeometry(0.06, 0.1, SCREEN_W + 0.3), alu, x - 0.02, SCREEN.y1 + 0.08, 0);
    add(new THREE.BoxGeometry(0.06, 0.1, SCREEN_W + 0.3), alu, x - 0.02, SCREEN.y0 - 0.08, 0);
    add(new THREE.BoxGeometry(0.06, SCREEN_H + 0.26, 0.1), alu, x - 0.02, SCREEN_C.y, SCREEN.z0 - 0.1);
    add(new THREE.BoxGeometry(0.06, SCREEN_H + 0.26, 0.1), alu, x - 0.02, SCREEN_C.y, SCREEN.z1 + 0.1);
    add(new THREE.BoxGeometry(1.1, 0.3, SCREEN_W + 1.6), M('#8e8a82', 0.9), x + 0.3, 0.15, 0);
    // graphics on the back, facing the rest of the square
    const back = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W + 0.4, SCREEN_H + 0.3), new THREE.MeshStandardMaterial({ map: toTexture(backPanelTexture(), { wrap: false }), roughness: 0.5 }));
    back.rotation.y = Math.PI / 2;
    back.position.set(x + 0.365, SCREEN_C.y, 0);
    this.hw.add(back);
    // truss towers + top truss (carry sensors, spotlights, speakers and the string lights)
    const trussTop = 4.35, tz = halfW + 0.6, tx = x + 0.19, c = 0.17;
    const chord = new THREE.CylinderGeometry(0.025, 0.025, 1, 8);
    const rungs = [];
    for (const sz of [-1, 1]) {
      for (const [dx, dz] of [[-c, -c], [-c, c], [c, -c], [c, c]]) {
        const m = add(chord, steel, tx + dx, trussTop / 2, sz * tz + dz);
        m.scale.y = trussTop;
      }
      for (let y = 0.3; y < trussTop; y += 0.45) rungs.push([tx, y, sz * tz, 'tower']);
    }
    for (const [dx, dy] of [[-c, 0], [c, 0], [-c, -0.34], [c, -0.34]]) {
      const m = add(chord, steel, tx + dx, trussTop + dy, 0);
      m.rotation.x = Math.PI / 2;
      m.scale.y = tz * 2 + 0.4;
    }
    for (let z = -tz; z <= tz; z += 0.5) rungs.push([tx, trussTop - 0.17, z, 'top']);
    const rungMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, rungs.length);
    const o = new THREE.Object3D();
    rungs.forEach(([rx, ry, rz, kind], i) => {
      o.position.set(rx, ry, rz);
      o.scale.set(kind === 'tower' ? 0.36 : 0.02, kind === 'tower' ? 0.02 : 0.36, kind === 'tower' ? 0.02 : 0.02);
      o.rotation.set(0, 0, 0);
      o.updateMatrix();
      rungMesh.setMatrixAt(i, o.matrix);
    });
    rungMesh.castShadow = true;
    this.hw.add(rungMesh);
    this.addObstacle(obstacles, { t: 'box', x0: x - 0.15, x1: x + 0.9, z0: -tz - 0.4, z1: tz + 0.4 });

    // depth / pose sensors on top of the cabinet
    this.sensorLeds = [];
    this.sensorPositions = [];
    for (const z of [-4, 0, 4]) {
      const y = SCREEN.y1 + 0.2;
      add(new THREE.BoxGeometry(0.1, 0.09, 0.36), M('#15171a', 0.2, 0.3), x - 0.05, y, z);
      for (const dz of [-0.09, 0.09]) {
        const lens = add(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 16), M('#050608', 0.05, 0.9), x - 0.105, y, z + dz);
        lens.rotation.z = Math.PI / 2;
      }
      const led = add(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false }), x - 0.105, y + 0.03, z);
      this.sensorLeds.push(led);
      this.sensorPositions.push(new THREE.Vector3(x - 0.12, y, z));
    }
    // speakers on the tower fronts
    for (const z of [-tz, tz]) {
      add(new THREE.BoxGeometry(0.28, 1.3, 0.3), M('#1b1d20', 0.6), x - 0.12, 2.3, z);
      add(new THREE.BoxGeometry(0.01, 1.2, 0.26), M('#2c2f33', 0.95), x - 0.265, 2.3, z);
    }
    this.buildStageFloor();
    this.buildBenches(obstacles);
    this.buildFence(obstacles);
  }

  /**
   * Ribbon fence round the stage (feedback v4): stanchion posts with a fabric belt, open where the
   * light strips arrive (STAGE_GATES along the front) and at the back corner where the path from
   * behind the screen comes in. The belts are obstacles, so people walk in through the openings.
   */
  buildFence(obstacles) {
    const FX = STAGE.x0 - 0.35, FZ = STAGE.z1 + 0.35;
    const runs = [];
    // front edge, broken by the gates
    const edges = [-FZ, ...STAGE_GATES.flatMap((g) => [g - STAGE_GATE_W / 2, g + STAGE_GATE_W / 2]), FZ];
    for (let i = 0; i < edges.length; i += 2) runs.push([[FX, edges[i]], [FX, edges[i + 1]]]);
    // sides, back to the truss towers; the left side leaves an opening at the front corner
    runs.push([[FX + 1.35, -FZ], [STAGE.x1 - 0.2, -FZ]]);
    runs.push([[FX, FZ], [STAGE.x1 - 0.2, FZ]]);
    const postMat = M('#1d2024', 0.35, 0.7), capMat = M('#c9a24a', 0.3, 0.8), belt = M('#9b1d2a', 0.7);
    const post = (x, z) => {
      for (const [geo, mat, y] of [
        [new THREE.CylinderGeometry(0.03, 0.03, 0.92, 10), postMat, 0.46],
        [new THREE.CylinderGeometry(0.15, 0.16, 0.035, 20), postMat, 0.018],
        [new THREE.SphereGeometry(0.045, 12, 8), capMat, 0.95],
      ]) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        this.hw.add(m);
      }
    };
    for (const [[x0, z0], [x1, z1]] of runs) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.ceil(len / 1.5));
      for (let i = 0; i <= n; i++) post(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n);
      const b = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) || 0.012, 0.055, Math.abs(z1 - z0) || 0.012), belt);
      b.position.set((x0 + x1) / 2, 0.86, (z0 + z1) / 2);
      b.castShadow = true;
      this.hw.add(b);
      this.addObstacle(obstacles, { t: 'box', x0: Math.min(x0, x1) - 0.06, x1: Math.max(x0, x1) + 0.06, z0: Math.min(z0, z1) - 0.06, z1: Math.max(z0, z1) + 0.06 });
    }
  }

  /** Glow decals over the painted footprint pairs: lit in the colour of whoever stands on them. */
  buildFootGlows() {
    const c = makeCanvas(128, 128), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 10;
    // same shapes as the paint in stageFloorTexture (1 px = 1 canvas px there too: 128 px = 0.8 m)
    const foot = (x, y, side) => {
      ctx.beginPath(); ctx.ellipse(x, y - 18, 15, 27, side * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x - side * 2, y + 25, 10, 12, 0, 0, Math.PI * 2); ctx.fill();
    };
    foot(40, 61, 1); foot(88, 55, -1);
    const tex = toTexture(c, { wrap: false });
    this.footGlows = FOOT_SPOTS.map((f) => {
      const geo = new THREE.PlaneGeometry(0.8, 0.8);
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(-Math.PI / 2); // canvas up → towards the screen, like the floor
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: '#000', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(f.x, 0.026, f.z);
      m.userData.dynamic = true;
      m.renderOrder = 3;
      this.hw.add(m);
      return { ...f, mesh: m, occupant: null, level: 0 };
    });
  }

  buildFireworks() {
    this.fireworks = [];
    const tex = sparkleTexture();
    for (let k = 0; k < 6; k++) {
      const n = 180;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      // normal blending: added light would vanish against the white 1944 facades in daylight
      const pts = new THREE.Points(g, new THREE.PointsMaterial({
        size: 0.6, map: tex, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, alphaTest: 0.05,
      }));
      pts.visible = false;
      pts.frustumCulled = false;
      this.archive.add(pts);
      this.fireworks.push({ pts, vel: new Float32Array(n * 3), life: 0, max: 1 });
    }
  }

  /** One burst of fireworks in the sky of the 1944 square, in the colours of the people on stage. */
  launchFirework() {
    const fw = this.fireworks.find((f) => f.life <= 0);
    if (!fw) return;
    const cols = [...this.tracked.values()].filter((tr) => !tr.leaving).map((tr) => tr.color);
    if (!cols.length) cols.push(new THREE.Color('#ffd27a'));
    const pos = fw.pts.geometry.attributes.position, col = fw.pts.geometry.attributes.color;
    // low enough to burst inside the wall camera's view, in front of the 1944 facades
    const cx = (this.rand() - 0.5) * 16, cy = 4.0 + this.rand() * 1.2, cz = -7 - this.rand() * 3;
    const c0 = cols[Math.floor(this.rand() * cols.length)], c1 = cols[Math.floor(this.rand() * cols.length)];
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, cx, cy, cz);
      // points spread evenly on a sphere
      const u = (i + 0.5) / pos.count, th = Math.acos(1 - 2 * u), ph = i * 2.39996;
      const sp = 4.2 + this.rand() * 0.6;
      fw.vel.set([Math.sin(th) * Math.cos(ph) * sp, Math.cos(th) * sp, Math.sin(th) * Math.sin(ph) * sp * 0.6], i * 3);
      const c = i % 2 ? c0 : c1;
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = col.needsUpdate = true;
    fw.life = fw.max = 1.8;
    fw.pts.visible = true;
  }

  updateFireworks(dt) {
    for (const fw of this.fireworks) {
      if (fw.life <= 0) continue;
      fw.life -= dt;
      const pos = fw.pts.geometry.attributes.position;
      const drag = Math.exp(-dt * 2.2);
      for (let i = 0; i < pos.count; i++) {
        fw.vel[i * 3] *= drag; fw.vel[i * 3 + 1] = fw.vel[i * 3 + 1] * drag - 2.2 * dt; fw.vel[i * 3 + 2] *= drag;
        pos.setXYZ(i, pos.getX(i) + fw.vel[i * 3] * dt, pos.getY(i) + fw.vel[i * 3 + 1] * dt, pos.getZ(i) + fw.vel[i * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      const a = clamp(fw.life / fw.max, 0, 1);
      fw.pts.material.opacity = Math.min(1, a * 1.6);
      fw.pts.material.size = 0.6 * (0.55 + 0.45 * a);
      if (fw.life <= 0) fw.pts.visible = false;
    }
  }

  /** Flush wooden stage floor (no step up) with "STEP IN" and the footprint groups painted on it. */
  buildStageFloor() {
    const depth = STAGE.x1 - STAGE.x0, width = STAGE.z1 - STAGE.z0;
    // plane local +x → lateral (+Z), local +y → towards the screen (+X), so the painted text faces the audience
    const geo = new THREE.PlaneGeometry(width, depth);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: toTexture(stageFloorTexture(), { wrap: false }), roughness: 0.82 }));
    floor.position.set((STAGE.x0 + STAGE.x1) / 2, 0.02, (STAGE.z0 + STAGE.z1) / 2);
    floor.receiveShadow = true;
    this.hw.add(floor);
    // thin steel edge, flush with the paving
    const trim = M('#2a2d31', 0.4, 0.7);
    const edge = (w, d, ex, ez) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(d, 0.03, w), trim);
      m.position.set(ex, 0.015, ez);
      m.receiveShadow = true;
      this.hw.add(m);
    };
    edge(width + 0.12, 0.06, STAGE.x0, 0);
    edge(0.06, depth, (STAGE.x0 + STAGE.x1) / 2, STAGE.z0);
    edge(0.06, depth, (STAGE.x0 + STAGE.x1) / 2, STAGE.z1);
  }

  /** Benches along the stage's side edges. Sitting on one puts your avatar on the screen (standing). */
  buildBenches(obstacles) {
    const wood = M('#8a5a34', 0.8);
    const metal = M('#16181b', 0.4, 0.6);
    this.seatAnchors = [];
    const bench = (lx, lz, lookX, lookZ) => {
      const g = new THREE.Group();
      g.position.set(lx, 0, lz);
      g.rotation.y = Math.atan2(lookX - lx, lookZ - lz);
      for (let s = 0; s < 3; s++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 0.11), wood);
        m.position.set(0, 0.45, -0.15 + s * 0.13);
        m.castShadow = m.receiveShadow = true;
        g.add(m);
      }
      for (let s = 0; s < 2; s++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 0.11), wood);
        m.position.set(0, 0.62 + s * 0.14, -0.26);
        m.rotation.x = -0.2;
        m.castShadow = true;
        g.add(m);
      }
      for (const bx of [-0.75, 0.75]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.45), metal);
        leg.position.set(bx, 0.225, -0.05);
        g.add(leg);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.05), metal);
        post.position.set(bx, 0.65, -0.27);
        g.add(post);
      }
      const benchIndex = this.benchCount = (this.benchCount ?? 0) + 1;
      for (const sx of [-0.45, 0.45]) {
        // LED strip under the seat's front edge + a soft pool of light below: lit in the sitter's colour
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.03), new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false }));
        strip.position.set(sx, 0.41, 0.1);
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.9), new THREE.MeshBasicMaterial({
          map: this.glowTex ??= glowTexture(), color: '#000', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        }));
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(sx, 0.03, 0.15);
        strip.userData.dynamic = pad.userData.dynamic = true;
        g.add(strip, pad);
        const seat = new THREE.Object3D();
        seat.position.set(sx, 0, -0.02);
        g.add(seat);
        const front = new THREE.Object3D();
        front.position.set(sx, 0, 0.85);
        g.add(front);
        this.seatAnchors.push({ seat, front, group: g, bench: benchIndex, glow: [strip, pad] });
        const lp = new THREE.Vector3(sx, 0, -0.05).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y).add(g.position);
        this.addObstacle(obstacles, { t: 'circle', x: lp.x, z: lp.z, r: 0.42 });
      }
      this.hw.add(g);
    };
    // on the stage's left and right edges, turned in towards the middle and the screen
    for (const side of [-1, 1]) {
      bench(-2.6, side * 5.85, -1.2, 0);
      bench(-5.2, side * 5.85, -3.8, 0);
    }
  }

  /** Called once the installation group is placed in the world. */
  finalizeSeats() {
    const v = new THREE.Vector3();
    this.seats = this.seatAnchors.map((a) => {
      const pos = a.seat.getWorldPosition(new THREE.Vector3());
      const front = a.front.getWorldPosition(v).clone();
      const heading = Math.atan2(front.x - pos.x, front.z - pos.z);
      return { pos, front, heading, occupant: null, bench: a.bench, glow: a.glow, glowLevel: 0, side: a.seat.position.x > 0 ? 1 : 0 };
    });
  }

  buildLights(obstacles) {
    // screen glow onto the square
    this.screenLight = new THREE.RectAreaLight('#fff1dc', 2, SCREEN_W, SCREEN_H);
    this.screenLight.position.set(SCREEN.x - 0.05, SCREEN_C.y, SCREEN_C.z);
    this.screenLight.lookAt(-10, SCREEN_C.y, SCREEN_C.z);
    this.hw.add(this.screenLight);

    // static spotlights hanging under the top truss, each aimed at a fixed spot in the zone
    this.spots = [];
    const coneGeo = new THREE.ConeGeometry(1, 1, 32, 1, true);
    coneGeo.translate(0, -0.5, 0);
    coneGeo.rotateX(-Math.PI / 2);
    const aims = [[-5.5, -4.2], [-4.2, -1.4], [-4.2, 1.4], [-5.5, 4.2]];
    [-5.2, -1.8, 1.8, 5.2].forEach((z, i) => {
      const base = new THREE.Vector3(SCREEN.x - 0.2, 3.85, z);
      const target = new THREE.Vector3(aims[i][0], 0, aims[i][1]);
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), M('#111', 0.4, 0.6));
      clamp.position.copy(base).add(_v.set(0, 0.2, 0));
      this.hw.add(clamp);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.28, 16), M('#16181b', 0.4, 0.6));
      head.userData.dynamic = true; // pans slowly with its beam
      head.position.copy(base);
      head.lookAt(target);
      head.rotateX(Math.PI / 2);
      this.hw.add(head);
      const light = new THREE.SpotLight('#ffffff', 0, 40, 0.24, 0.55, 1.2);
      light.position.copy(base);
      light.target.position.copy(target);
      this.hw.add(light, light.target);
      const beam = new THREE.Mesh(coneGeo, beamMaterial());
      beam.position.copy(base);
      beam.lookAt(target);
      const L = base.distanceTo(target), r = Math.tan(0.24) * L;
      beam.scale.set(r, r, L);
      this.hw.add(beam);
      this.spots.push({ light, beam, head, base, aim: target.clone(), i });
    });

    // installation masts + festoon string lights from the truss out over the audience
    const trussTop = 4.35, tz = SCREEN_W / 2 + 0.6, tx = SCREEN.x + 0.19;
    const mastPositions = [new THREE.Vector3(-10.5, 0, -8.5), new THREE.Vector3(-10.5, 0, 8.5)];
    for (const p of mastPositions) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 5.2, 10), M('#16181b', 0.4, 0.6));
      m.position.set(p.x, 2.6, p.z);
      m.castShadow = true;
      this.hw.add(m);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.1, 16), M('#2a2d31', 0.5, 0.5));
      base.position.set(p.x, 0.05, p.z);
      this.hw.add(base);
      this.addObstacle(obstacles, { t: 'circle', x: p.x, z: p.z, r: 0.22 });
    }
    const A = (z) => new THREE.Vector3(tx, trussTop, z);
    const T = (p) => new THREE.Vector3(p.x, 5.1, p.z);
    const strands = [
      [A(-tz), T(mastPositions[0])], [A(tz), T(mastPositions[1])], [T(mastPositions[0]), T(mastPositions[1])],
      [A(-2.5), T(mastPositions[1])], [A(2.5), T(mastPositions[0])],
    ];
    const pts = [];
    const wirePts = [];
    for (const [a, b] of strands) {
      const len = a.distanceTo(b), n = Math.round(len / 0.75);
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const p = a.clone().lerp(b, u);
        p.y -= 0.9 * 4 * u * (1 - u);
        pts.push(p);
        if (i > 0) wirePts.push(pts[pts.length - 2], p);
      }
    }
    this.festoon = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), pts.length);
    const o = new THREE.Object3D();
    pts.forEach((p, i) => {
      o.position.copy(p).add(_v.set(0, -0.08, 0));
      o.updateMatrix();
      this.festoon.setMatrixAt(i, o.matrix);
      this.festoon.setColorAt(i, new THREE.Color('#ffd08a'));
    });
    this.festoonPts = pts;
    this.hw.add(this.festoon);
    const wire = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wirePts), new THREE.LineBasicMaterial({ color: '#111' }));
    this.hw.add(wire);
    this.buildMarquee();
    this.festoonLights = [new THREE.PointLight('#ffc98a', 0, 16, 1.5), new THREE.PointLight('#ffc98a', 0, 16, 1.5)];
    this.festoonLights[0].position.set(-5.5, 3.8, -4);
    this.festoonLights[1].position.set(-5.5, 3.8, 4);
    this.hw.add(...this.festoonLights);
  }

  /** Theatre-style bulbs around the LED wall: on when someone is on stage, chasing when people chat or dance. */
  buildMarquee() {
    const pts = [];
    const x = SCREEN.x - 0.05, z0 = SCREEN.z0 - 0.22, z1 = SCREEN.z1 + 0.22, y0 = SCREEN.y0 - 0.16, y1 = SCREEN.y1 + 0.16;
    const step = 0.3;
    for (let z = z0; z <= z1 + 1e-3; z += step) { pts.push([x, y1, z]); pts.push([x, y0, z]); }
    for (let y = y0 + step; y < y1 - step / 2; y += step) { pts.push([x, y, z0]); pts.push([x, y, z1]); }
    // order around the frame so a chase runs round it
    const cy = (y0 + y1) / 2;
    pts.sort((a, b) => Math.atan2(a[1] - cy, a[2]) - Math.atan2(b[1] - cy, b[2]));
    this.marquee = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), pts.length);
    const o = new THREE.Object3D();
    pts.forEach(([px, py, pz], i) => {
      o.position.set(px, py, pz);
      o.updateMatrix();
      this.marquee.setMatrixAt(i, o.matrix);
      this.marquee.setColorAt(i, _c.set('#ffd08a'));
    });
    this.marquee.userData.dynamic = true;
    this.hw.add(this.marquee);
  }

  updateMarquee(t, night) {
    const m = this.marquee;
    const on = this.colour;
    const n = m.count;
    for (let i = 0; i < n; i++) {
      let b = 1;
      if (this.dancing) _c.setHSL((i / n + t * 0.35) % 1, 0.85, 0.6);
      else {
        _c.set('#ffd08a');
        if (this.talking) b = (i + Math.floor(t * 8)) % 4 === 0 ? 1.4 : 0.55; // warm chase
      }
      m.setColorAt(i, _c.multiplyScalar(0.25 + on * b * (1.2 + night * 1.6)));
    }
    m.instanceColor.needsUpdate = true;
  }

  /** LED light strips in the paving that guide people from the entrances to the zone. */
  buildGuides() {
    const W = (lx, lz) => screenToWorld(lx, lz, 0.03);
    const paths = [
      // every strip ends at the front edge of the wooden stage
      [new THREE.Vector3(0, 0.03, 18.5), new THREE.Vector3(0, 0.03, 14.5), W(STAGE.x0 - 0.3, 0)], // from the big street (south)
      [new THREE.Vector3(-27, 0.03, -1), new THREE.Vector3(-19, 0.03, 0.5), new THREE.Vector3(-13.5, 0.03, 5), W(STAGE.x0 - 0.3, -4.5)], // west
      [new THREE.Vector3(17.5, 0.03, -21), new THREE.Vector3(15, 0.03, -9), new THREE.Vector3(12.5, 0.03, 2.5), W(STAGE.x0 - 0.3, 4.5)], // north path
      [new THREE.Vector3(-3, 0.03, -18.5), new THREE.Vector3(-9.5, 0.03, -9), W(STAGE.x0 + 3.5, -10), W(STAGE.x0 + 1.2, -7.2)], // from behind the screen, down to the stage's side
    ];
    this.guideMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { phase: { value: 0 }, intensity: { value: 1 }, color: { value: new THREE.Color('#ffb03a') } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float phase, intensity;
        uniform vec3 color;
        varying vec2 vUv;
        void main() {
          float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
          // steady glow + soft bands of light drifting slowly towards the stage (shows the way, no flicker)
          float band = 0.5 + 0.5 * sin((vUv.x / 4.0 - phase) * 6.2832);
          float a = (0.18 + 3.2 * pow(band, 4.0)) * smoothstep(0.0, 0.6, across) * intensity;
          gl_FragColor = vec4(color * a, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    // flush, low-contrast steel inlay: reads as part of the paving, not as a black stripe
    const housing = M('#585b5e', 0.45, 0.6);
    this.guides = new THREE.Group();
    for (const pts of paths) {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const len = curve.getLength();
      const n = Math.max(2, Math.round(len / 0.2));
      // stop where the strip reaches the stage (or would run under a bench / the screen), leaving a small gap
      const sampled = [];
      for (const p of curve.getSpacedPoints(n)) {
        const l = toScreenLocal(p, _v);
        if (l.x > STAGE.x0 - 0.25 && l.x < STAGE.x1 + 0.6 && l.z > STAGE.z0 - 0.25 && l.z < STAGE.z1 + 0.25) break;
        sampled.push(p);
      }
      if (sampled.length < 2) continue;
      for (const [w, mat, y] of [[0.11, housing, 0.021], [0.055, this.guideMat, 0.024]]) {
        const pos = [], uv = [], idx = [];
        let dist = 0;
        sampled.forEach((p, i) => {
          if (i > 0) dist += p.distanceTo(sampled[i - 1]);
          const nxt = sampled[Math.min(i + 1, sampled.length - 1)], prv = sampled[Math.max(i - 1, 0)];
          const dir = _v.subVectors(nxt, prv).setY(0).normalize();
          const side = _v2.set(-dir.z, 0, dir.x).multiplyScalar(w / 2);
          pos.push(p.x - side.x, y, p.z - side.z, p.x + side.x, y, p.z + side.z);
          uv.push(dist, 0, dist, 1);
          if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, mat);
        m.receiveShadow = mat === housing;
        if (mat !== housing) m.renderOrder = 2;
        this.guides.add(m);
      }
    }
    this.scene.add(this.guides);
  }

  buildSensorViz() {
    const g = (this.sensorGroup = new THREE.Group());
    g.visible = false;
    this.scene.add(g);
    const maxPersons = 16;
    const segs = maxPersons * BONES.length + 40;
    this.vizLinePos = new Float32Array(segs * 2 * 3);
    this.vizLineCol = new Float32Array(segs * 2 * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.vizLinePos, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(this.vizLineCol, 3));
    this.vizLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.vizLines.renderOrder = 999;
    this.vizLines.frustumCulled = false;
    g.add(this.vizLines);
    this.vizPointPos = new Float32Array(maxPersons * JOINTS.length * 3);
    this.vizPointCol = new Float32Array(maxPersons * JOINTS.length * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.vizPointPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.vizPointCol, 3));
    this.vizPoints = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.06, vertexColors: true, depthTest: false, transparent: true }));
    this.vizPoints.renderOrder = 1000;
    this.vizPoints.frustumCulled = false;
    g.add(this.vizPoints);
    // the tracked area (= the stage) outlined on the ground + rays from the sensors to its corners
    const outline = [
      new THREE.Vector3(STAGE.x1, 0.05, STAGE.z1), new THREE.Vector3(STAGE.x0, 0.05, STAGE.z1),
      new THREE.Vector3(STAGE.x0, 0.05, STAGE.z0), new THREE.Vector3(STAGE.x1, 0.05, STAGE.z0),
    ];
    outline.push(outline[0].clone());
    const local = new THREE.Group();
    local.position.set(LAYOUT.screen.cx, 0, LAYOUT.screen.cz);
    local.rotation.y = LAYOUT.screen.rot;
    g.add(local);
    const ol = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color: '#39ff9f', transparent: true, opacity: 0.8, depthTest: false }));
    ol.renderOrder = 998;
    local.add(ol);
    const rays = [];
    for (const s of this.sensorPositions) {
      for (const p of [outline[1], outline[2]]) rays.push(s, p);
    }
    const rl = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rays), new THREE.LineBasicMaterial({ color: '#39ff9f', transparent: true, opacity: 0.25, depthTest: false }));
    local.add(rl);
    const fill = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.z)))),
      new THREE.MeshBasicMaterial({ color: '#39ff9f', transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }),
    );
    fill.rotation.x = Math.PI / 2;
    fill.position.y = 0.04;
    local.add(fill);
  }

  // =====================================================================
  // Interaction
  // =====================================================================
  /** Shared state changed by someone else in the room. */
  applyShared(state) {
    if (typeof state.muted === 'boolean' && state.muted !== this.muted) {
      this.muted = state.muted;
      this.audio?.setInstallationMuted(this.muted);
    }
  }

  showToast(text, dur = 3.5) {
    this.toast = { text, until: this.time + dur };
    this.overlayDirty = true;
  }

  // =====================================================================
  // Per-frame update
  // =====================================================================
  update(dt, t, people, env) {
    this.time = t;
    this.env = env;
    const seen = new Set();

    // --- tracking: who is inside the sensing zone ---
    for (const p of people) {
      const seat = this.seatAt(p.pos);
      if (!seat && !onStage(p.pos)) continue;
      seen.add(p.id);
      let tr = this.tracked.get(p.id);
      if (!tr) {
        tr = this.startTrack(p);
        this.tracked.set(p.id, tr);
      }
      tr.person = p;
      tr.seat = seat;
      tr.lastSeen = t;
      tr.leaving = false;
    }
    for (const [id, tr] of this.tracked) {
      if (!seen.has(id) && t - tr.lastSeen > 1.0 && !tr.leaving) {
        tr.leaving = true;
        tr.leaveT = t;
        this.onEvent(`${tr.person.name} left the zone – ${tr.style.name} fades away`, 'leave');
      }
      if (tr.leaving && t - tr.leaveT > 0.6) {
        tr.rig.dispose();
        tr.tag.material.map.dispose();
        tr.tag.removeFromParent();
        tr.filterIcon.removeFromParent();
        for (const r of [tr.ring, tr.worldRing]) { r.removeFromParent(); r.geometry.dispose(); r.material.dispose(); }
        this.clearNudge(tr);
        this.dropBike(tr);
        this.tracked.delete(id);
      }
    }
    const active = [...this.tracked.values()].filter((tr) => !tr.leaving);
    const prevLevel = this.level;
    this.count = active.length;
    this.level = this.count === 0 ? 0 : this.count === 1 ? 1 : this.count === 2 ? 2 : this.count <= 4 ? 3 : 4;
    if (this.level !== prevLevel) {
      this.overlayDirty = true;
      if (prevLevel === 0) this.showToast('Someone stepped in – the archive wakes up in colour!');
      else if (this.level === 0) this.showToast('The square falls asleep again…');
      this.onEvent(`Level ${this.level}: ${LEVELS[this.level].en} (${this.count} ${this.count === 1 ? 'person' : 'people'})`, 'level');
    }
    this.energy += (this.level - this.energy) * (1 - Math.exp(-dt * 1.2));

    this.standing = active.filter((tr) => !tr.seat).length;
    // black & white while the stage is empty, full colour as soon as someone steps in
    this.colour += ((this.count > 0 ? 1 : 0) - this.colour) * (1 - Math.exp(-dt * 1.6));
    // spotlights: as soon as 3+ people stand on the stage (close together or not); confetti only while they dance
    this.spotLevel += ((this.dancing || this.standing >= 3 ? 1 : 0) - this.spotLevel) * (1 - Math.exp(-dt * 2));
    this.danceLevel += ((this.dancing ? 1 : 0) - this.danceLevel) * (1 - Math.exp(-dt * 2));

    // --- chat & dance groups ---
    this.updateGroups(active, t);
    this.updateBubbles(t);
    this.updateSocial(dt, t, active);
    this.updateGlows(dt);

    // --- avatars ---
    this.filterActive = false;
    for (const tr of this.tracked.values()) this.updateAvatar(tr, dt, t);
    this.updateDanceCircles(t);

    this.updateExtras(dt, t);
    this.updateFx(dt, t);
    this.updateHardware(dt, t, env);
    if (this.sensorView) this.updateSensorViz();

    // --- overlay ---
    this.overlayTimer -= dt;
    if (this.toast && t > this.toast.until) { this.toast = null; this.overlayDirty = true; }
    if (this.overlayDirty && this.overlayTimer <= 0) { this.drawOverlay(); this.overlayDirty = false; this.overlayTimer = 0.12; }

    // --- screen shader ---
    const e = this.energy;
    const u = this.screenMat.uniforms;
    u.saturation.value = this.colour * (this.dancing ? 1.12 : 1);
    u.grain.value = 0.03 + 0.15 * (1 - this.colour); // the empty screen looks like old, scratched film
    u.time.value = t;
    u.fade.value = this.fade;
    u.brightness.value = 1.05 + env.night * 0.35 + (e > 3 ? 0.1 : 0);
  }

  startTrack(p) {
    const used = new Set([...this.tracked.values()].map((tr) => tr.style.id));
    let pool = HISTORICAL.filter((s) => !used.has(s.id));
    if (!pool.length) pool = HISTORICAL;
    if (p.kind === 'child') pool = pool.filter((s) => s.id === 'schoolboy').concat(pool.filter((s) => s.id !== 'schoolboy')).slice(0, 1);
    else if (p.kind === 'elderly') {
      const pref = pool.filter((s) => ['grandma', 'gentleman', 'lady', 'worker', 'conductor'].includes(s.id));
      if (pref.length) pool = pref;
    } else pool = pool.filter((s) => s.id !== 'schoolboy').length ? pool.filter((s) => s.id !== 'schoolboy') : pool;
    const style = p.preferredStyle && !used.has(p.preferredStyle) ? HISTORICAL.find((s) => s.id === p.preferredStyle) : pool[hashStr(p.id) % pool.length];
    const rig = new Rig(style);
    rig.root.scale.setScalar(0.001);
    this.archive.add(rig.root);
    const stage = this.stagePos(p);
    rig.root.position.copy(stage);
    // name tag sprite
    const c = makeCanvas(512, 112), ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(15,12,8,0.72)';
    ctx.beginPath(); ctx.roundRect(4, 4, 504, 104, 18); ctx.fill();
    ctx.fillStyle = '#f7e7c2'; ctx.font = 'bold 40px Georgia, serif'; ctx.textAlign = 'center';
    ctx.fillText(style.name, 256, 52);
    ctx.fillStyle = '#d9c8a0'; ctx.font = 'italic 26px Georgia, serif';
    ctx.fillText(`${style.en} · ${style.era}`, 256, 90);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: toTexture(c, { wrap: false }), transparent: true, depthWrite: false }));
    tag.scale.set(1.5, 0.33, 1);
    this.archive.add(tag);
    const filterIcon = makeFilterIcon();
    filterIcon.visible = false;
    this.archive.add(filterIcon);
    // the person's colour (same on every client: picked from the id, skipping colours already on stage)
    const usedCols = new Set([...this.tracked.values()].filter((tr) => !tr.leaving).map((tr) => tr.colorIdx));
    let colorIdx = hashStr(p.id) % PLAYER_COLORS.length;
    for (let k = 0; k < PLAYER_COLORS.length && usedCols.has(colorIdx); k++) colorIdx = (colorIdx + 1) % PLAYER_COLORS.length;
    const color = new THREE.Color(PLAYER_COLORS[colorIdx]);
    this.ringTex ??= ringTexture([new THREE.Color('#fff')]);
    const ring = groundRing(1.15, this.ringTex, color); // under the avatar on the screen
    ring.position.copy(stage).setY(0.02);
    this.archive.add(ring);
    const worldRing = groundRing(1.0, this.ringTex, color); // under the person on the real square
    worldRing.position.copy(p.pos).setY(0.045);
    this.scene.add(worldRing);
    this.emit('sparkle', stage.clone().add(_v.set(0, 1.0, 0)), 14, 1.0, 1.2);
    this.onEvent(`${p.name} detected → becomes "${style.name}" – ${style.en}`, 'track');
    return {
      id: p.id, person: p, style, rig, born: this.time, lastSeen: this.time, leaving: false,
      stage, yaw: 0, tag, filterIcon, filterT: 0, filtered: false, filterLogged: false, group: null, seat: null,
      color, colorIdx, ring, worldRing,
      action: null, lastG: null, lastGT: 0, // the avatar's own answer to a gesture
      motion: 0, idleT: 0, nudge: null, nudgeCount: 0, prevHands: null, // nudge when standing still
      bike: null, bikeAng: 0, pedal: 0, // riding a bicycle while its person sits on a bench
    };
  }

  stagePos(p) {
    const l = toScreenLocal(p.pos, _v3);
    const x = clamp(l.z, -9, 9) * 0.62;
    const d = clamp(-l.x, 0.5, 12);
    const z = 3.2 - (d - 0.5) * 0.55;
    return new THREE.Vector3(x, 0, z);
  }

  /** Is someone sitting on one of the stage benches? Works for local, remote and puppet people alike. */
  seatAt(pos) {
    for (const s of this.seats) if (Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z) < 0.35) return s;
    return null;
  }

  /**
   * Interaction rules (feedback v2, v4):
   *   anywhere on the stage, two people close together → their avatars chat, with fact bubbles
   *   three or more close together                     → their avatars dance together
   *   the two-footprint marker is a locked talk spot: two people on it stay in conversation, and
   *     nobody standing next to it can pull them into a dance (they are not linked to anyone else)
   *   the three-footprint marker is a dance spot: when all three pairs are taken, those three dance
   *   sitting on a bench → the avatar rides a bicycle instead (not part of any group)
   * Groups are connected components of "together"; they last as long as people stay.
   */
  updateGroups(active, t) {
    const PROX = 1.6;
    const standing = active.filter((tr) => !tr.seat);
    const local = new Map(standing.map((tr) => [tr, toScreenLocal(tr.person.pos, new THREE.Vector3())]));
    // who stands on which footprint pair (each pair takes the nearest person on it)
    const taken = new Set();
    for (const f of this.footGlows) {
      f.occupant = null;
      let bd = FOOT_R;
      for (const tr of standing) {
        if (taken.has(tr)) continue;
        const l = local.get(tr);
        const d = Math.hypot(l.x - f.x, l.z - f.z);
        if (d < bd) { bd = d; f.occupant = tr; }
      }
      if (f.occupant) taken.add(f.occupant);
    }
    const onSpot = (spot) => this.footGlows.filter((f) => f.spot === spot && f.occupant).map((f) => f.occupant);
    const talkSpot = onSpot('talk'), danceSpot = onSpot('dance');
    const locked = new Set(talkSpot.length === 2 ? talkSpot : []);
    const danceTrio = danceSpot.length === 3 ? new Set(danceSpot) : null;

    const parent = standing.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < standing.length; i++) for (let j = i + 1; j < standing.length; j++) {
      const a = standing[i], b = standing[j];
      let together;
      if (locked.has(a) || locked.has(b)) together = locked.has(a) && locked.has(b);
      else if (danceTrio?.has(a) && danceTrio.has(b)) together = true;
      else together = Math.hypot(a.person.pos.x - b.person.pos.x, a.person.pos.z - b.person.pos.z) <= PROX;
      if (together) parent[find(i)] = find(j);
    }
    const comps = new Map();
    standing.forEach((tr, i) => {
      const r = find(i);
      if (!comps.has(r)) comps.set(r, []);
      comps.get(r).push(tr);
    });
    const next = new Map();
    for (const members of comps.values()) {
      if (members.length < 2) continue;
      members.sort((a, b) => (a.id < b.id ? -1 : 1)); // same order on every client
      const key = members.map((m) => m.id).join('|');
      const type = members.length >= 3 ? 'dance' : 'talk';
      const old = this.groups.get(key);
      const g = old && old.type === type ? old : { key, type, t0: t, turn: -1, nextTurn: t + 0.4, factIdx: hashStr(key) % FACTS.length };
      g.members = members;
      g.locked = members.every((m) => locked.has(m));
      next.set(key, g);
      if (g !== old) {
        const names = members.map((m) => m.style.name).join(', ');
        if (type === 'talk') {
          this.showToast('Neighbours chatting – listen to their stories!');
          this.onEvent(`Chat${g.locked ? ' (talk spot)' : ''}: ${names}`, 'duo');
        } else {
          this.showToast('Three or more together – time to dance!');
          this.onEvent(`Dance: ${names}`, 'duo');
          // the circle round the dancers, in all their colours
          g.circle = groundRing(1, ringTexture(members.map((m) => m.color)));
          this.archive.add(g.circle);
        }
      }
    }
    for (const [key, g] of this.groups) {
      if (next.get(key) === g) continue;
      if (g.bubble) { g.bubble.material.map.dispose(); g.bubble.removeFromParent(); }
      if (g.circle) { g.circle.material.map.dispose(); g.circle.removeFromParent(); }
    }
    for (const tr of this.tracked.values()) tr.group = null;
    for (const g of next.values()) for (const m of g.members) m.group = g;
    this.groups = next;
    const talking = [...next.values()].some((g) => g.type === 'talk');
    if (talking !== this.talking) this.overlayDirty = true;
    this.talking = talking;
    this.dancing = [...next.values()].some((g) => g.type === 'dance');
  }

  /** Social meter: charges while people are on the stage, much faster when they do things together. */
  updateSocial(dt, t, active) {
    let score = 0;
    for (const tr of active) {
      score += SOCIAL.onStage;
      if (tr.group?.type === 'talk') score += SOCIAL.talking;
      else if (tr.group?.type === 'dance') score += SOCIAL.dancing;
    }
    this.socialTarget = Math.min(1, score / SOCIAL.full);
    const d = this.socialTarget - this.social;
    this.social += Math.sign(d) * Math.min(Math.abs(d), (d > 0 ? SOCIAL.charge : SOCIAL.drain) * dt);
    const full = this.social >= 0.999;
    if (full && !this.full) {
      this.showToast('The square is buzzing – fireworks!');
      this.onEvent('Social meter full → fireworks', 'level');
      for (let k = 0; k < 3; k++) this.launchFirework();
      this.fireworkCd = 1.1;
    }
    this.full = full;
    if (full && (this.fireworkCd -= dt) <= 0) { this.launchFirework(); this.fireworkCd = 0.7 + this.rand() * 0.8; }
    if (Math.abs(this.social - this.socialDrawn) > 0.004 || full) this.overlayDirty = true;
  }

  /** Footprints and benches light up in the colour of whoever uses them. */
  updateGlows(dt) {
    const k = 1 - Math.exp(-dt * 6);
    for (const f of this.footGlows) {
      const on = f.occupant && !f.occupant.leaving ? 1 : 0;
      if (on) f.color = f.occupant.color;
      f.level += (on - f.level) * k;
      f.mesh.visible = f.level > 0.01;
      if (f.color) f.mesh.material.color.copy(f.color).multiplyScalar(1.6);
      f.mesh.material.opacity = f.level;
    }
    const sitters = new Map();
    for (const tr of this.tracked.values()) if (tr.seat && !tr.leaving) sitters.set(tr.seat, tr);
    for (const seat of this.seats) {
      const tr = sitters.get(seat);
      if (tr) seat.glowColor = tr.color;
      seat.glowLevel += ((tr ? 1 : 0) - seat.glowLevel) * k;
      const [strip, pad] = seat.glow;
      strip.material.color.copy(seat.glowColor ?? _c.set('#000')).multiplyScalar(1.8 * seat.glowLevel);
      pad.material.color.copy(seat.glowColor ?? _c.set('#000')).multiplyScalar(0.9 * seat.glowLevel);
      strip.visible = pad.visible = seat.glowLevel > 0.01;
    }
  }

  /** Fact bubbles over chatting avatars: the two take turns, a new fact every few seconds. */
  updateBubbles(t) {
    for (const g of this.groups.values()) {
      if (g.type !== 'talk') continue;
      if (t >= g.nextTurn) {
        g.turn++;
        g.factIdx = (g.factIdx + (g.turn > 0 ? 1 : 0)) % FACTS.length;
        g.nextTurn = t + FACT_TURN;
        if (g.bubble) { g.bubble.material.map.dispose(); g.bubble.removeFromParent(); }
        g.bubble = factBubble(FACTS[g.factIdx]);
        this.archive.add(g.bubble);
      }
      const speaker = g.members[g.turn % g.members.length];
      if (!speaker) continue;
      const sc = speaker.rig.style.scale ?? 1;
      g.bubble.position.copy(speaker.stage).add(_v.set(-Math.sign(speaker.stage.x) * 0.5, 1.95 * sc, 0.3));
      const age = t - (g.nextTurn - FACT_TURN);
      const fadeIn = Math.min(1, age / FACT_FADE_IN);
      const dim = 1 - smooth(FACT_TURN - FACT_DIM, FACT_TURN, age);
      g.bubble.material.opacity = fadeIn * (0.12 + 0.88 * dim);
    }
  }

  updateAvatar(tr, dt, t) {
    const rig = tr.rig;
    const p = tr.person;
    const age = t - tr.born;
    // appear / disappear
    const s = tr.leaving ? Math.max(0.001, 1 - (t - tr.leaveT) / 0.5) : Math.min(1, age / 0.5);
    rig.root.scale.setScalar(Math.max(0.001, s));

    // the avatar answers a gesture with its own, bigger action, and plays it to the end before the next
    const pg = p.gesture ?? null, pgt = p.gestureT ?? 0;
    if (pg && (pg !== tr.lastG || pgt + 0.15 < tr.lastGT) && !tr.action && !tr.seat && !tr.leaving && GESTURE_ACTION[pg]) {
      tr.action = { name: GESTURE_ACTION[pg], t: 0 };
      this.clearNudge(tr);
      this.onEvent(`${p.name}: ${pg} → ${tr.style.name} answers with "${tr.action.name}"`, 'duo');
    }
    tr.lastG = pg;
    tr.lastGT = pgt;

    let target = this.stagePos(p);
    let yawTarget = Math.PI / 2 - (p.heading - LAYOUT.screen.rot);
    const g = tr.group;
    const idx = g ? g.members.indexOf(tr) : 0;
    if (tr.seat && !tr.leaving) {
      // sitting on a bench → the avatar rides a bicycle round the square until its person gets up
      if (!tr.bike) {
        tr.bike = bicycle(tr.color);
        tr.bike.scale.setScalar(rig.style.scale ?? 1);
        this.archive.add(tr.bike);
        tr.bikeAng = Math.atan2((tr.stage.z - BIKE.cz) / BIKE.rz, tr.stage.x / BIKE.rx) + tr.seat.side * 0.5;
      }
      tr.bikeAng += dt * BIKE.speed;
      const a = tr.bikeAng;
      target = new THREE.Vector3(Math.cos(a) * BIKE.rx, 0, BIKE.cz + Math.sin(a) * BIKE.rz);
      yawTarget = Math.atan2(-BIKE.rx * Math.sin(a), BIKE.rz * Math.cos(a));
    } else {
      this.dropBike(tr);
      if (g) {
        const mid = new THREE.Vector3();
        for (const m of g.members) mid.add(this.stagePos(m.person));
        mid.multiplyScalar(1 / g.members.length);
        if (g.type === 'talk') {
          // stand side by side, turned towards each other
          target = mid.add(_v.set(idx === 0 ? -0.5 : 0.5, 0, 0));
          yawTarget = (idx === 0 ? 1 : -1) * Math.PI / 2 * 0.7;
        } else {
          // dance in a slowly turning ring, mostly facing the audience
          const n = g.members.length, r = 0.45 + 0.17 * n;
          const ang = (t - g.t0) * 0.7 + (idx / n) * Math.PI * 2;
          target = mid.add(_v.set(Math.sin(ang) * r, 0, Math.cos(ang) * r * 0.55));
          yawTarget = Math.sin(ang) * 0.5;
          if (Math.floor((t + idx * 0.13) * 2) !== Math.floor((t + idx * 0.13 - dt) * 2)) {
            this.emit(idx % 2 ? 'heart' : 'sparkle', tr.stage.clone().add(_v.set(0, 1.2 + this.rand(), 0)), 2, 0.9, 0.9);
          }
        }
      }
    }
    tr.stage.lerp(target, 1 - Math.exp(-dt * 6));
    let dy = yawTarget - tr.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    tr.yaw += dy * (1 - Math.exp(-dt * 8));

    // --- content filter: hand-to-mouth (e.g. smoking) is not mirrored ---
    const head = p.rig.worldPos('head', _v);
    head.y += 0.06 * (p.rig.style.scale ?? 1);
    const dl = p.rig.worldPos('handL', _v2).distanceTo(head);
    const dr = p.rig.worldPos('handR', _v3).distanceTo(head);
    const near = Math.min(dl, dr) < 0.3 * (p.rig.style.scale ?? 1);
    const rightHand = dr < dl;
    tr.filterT = near ? tr.filterT + dt : Math.max(0, tr.filterT - dt * 2);
    const wasFiltered = tr.filtered;
    tr.filtered = tr.filterT > 0.35;
    if (tr.filtered && !tr.filterLogged) {
      tr.filterLogged = true;
      this.onEvent(`Filter: hand-to-mouth gesture from ${p.name} is not mirrored on screen`, 'filter');
    }
    if (!tr.filtered && wasFiltered) tr.filterLogged = false;
    if (tr.filtered) this.filterActive = true;

    // --- pose ---
    let root = null;
    if (tr.action) {
      tr.action.t += dt;
      rig.resetTargets();
      animIdle(rig, t, idx);
      root = animAction(rig, tr.action.name, tr.action.t);
      if (!root) tr.action = null;
    }
    if (root) {
      // playing its own action
    } else if (tr.bike) {
      rig.resetTargets();
      animIdle(rig, t, 0);
      tr.pedal += dt * BIKE.speed * 9;
      animCycle(rig, tr.pedal);
    } else if (g && g.type === 'talk') {
      rig.resetTargets();
      animIdle(rig, t, idx);
      animTalk(rig, t, g.members[g.turn % g.members.length] === tr, idx * 1.7);
    } else if (g) {
      rig.resetTargets();
      animIdle(rig, t, idx);
      animGesture(rig, idx % 3 === 2 ? 'cheer' : 'dance', 0.5 + ((t - g.t0 + idx * 0.7) % 2.856)); // 2.856 s = two whole dance cycles, so the loop is seamless
    } else {
      rig.copyPoseFrom(p.rig, true);
      if (tr.filtered) {
        // mirrored: the person's right hand is the avatar's left
        const side = rightHand ? 'L' : 'R';
        rig.set('uArm' + side, 0.04, 0, side === 'L' ? 0.09 : -0.09);
        rig.set('fArm' + side, -0.15, 0, 0);
        rig.set('hand' + side, 0, 0, 0);
      }
    }
    rig.update(dt, age < 0.05 ? 1000 : 22);

    // --- place the figure (actions may lift, flip or fly it) ---
    let yaw = tr.yaw;
    if (root) {
      yaw += root.yawAdd ?? 0;
      if (root.yaw !== undefined) {
        let d = root.yaw - yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        yaw += d * (root.yawBlend ?? 1);
      }
    }
    const fwd = root?.fwd ?? 0;
    const ox = root?.x ?? 0, oz = root?.z ?? 0;
    rig.root.position.set(tr.stage.x + ox + Math.sin(yaw) * fwd, root?.y ?? 0, tr.stage.z + oz + Math.cos(yaw) * fwd);
    rig.root.rotation.set(root?.pitch ?? 0, yaw, root?.roll ?? 0, 'YXZ');
    if (tr.bike) {
      // the saddle sits under the rider's hips
      tr.bike.position.set(tr.stage.x + Math.sin(yaw) * 0.18 * s, 0, tr.stage.z + Math.cos(yaw) * 0.18 * s);
      tr.bike.rotation.y = yaw;
      tr.bike.scale.setScalar((rig.style.scale ?? 1) * Math.max(0.001, s));
      for (const w of tr.bike.userData.wheels) w.rotation.x += dt * BIKE.speed * 3.2 / 0.34;
    }

    // --- nudge: a person who stands still gets a thought bubble ("What will happen if I jump?") ---
    const hl = p.rig.worldPos('handL', _v), hr = p.rig.worldPos('handR', _v2);
    if (tr.prevHands) {
      const [pl, pr, pp] = tr.prevHands;
      const m = (hl.distanceTo(pl) + hr.distanceTo(pr) + p.pos.distanceTo(pp)) / Math.max(dt, 1e-3);
      tr.motion += (m - tr.motion) * (1 - Math.exp(-dt * 3));
      pl.copy(hl); pr.copy(hr); pp.copy(p.pos);
    } else tr.prevHands = [hl.clone(), hr.clone(), p.pos.clone()];
    const still = tr.motion < 0.25 && !g && !tr.seat && !tr.action && !tr.leaving;
    tr.idleT = still ? tr.idleT + dt : 0;
    if (!still) this.clearNudge(tr);
    else if (tr.idleT > NUDGE_AFTER && !tr.nudge) {
      tr.nudge = { bubble: factBubble(NUDGES[(hashStr(p.id) + tr.nudgeCount++) % NUDGES.length], { worldW: 3.5, thought: true }), age: 0 };
      this.archive.add(tr.nudge.bubble);
    }
    if (tr.nudge) {
      tr.nudge.age += dt;
      const sc = rig.style.scale ?? 1;
      tr.nudge.bubble.position.copy(tr.stage).add(_v.set(0, 2.0 * sc, 0.3));
      tr.nudge.bubble.material.opacity = Math.min(1, tr.nudge.age / 0.4) * (1 - smooth(NUDGE_FOR - 1, NUDGE_FOR, tr.nudge.age));
      if (tr.nudge.age > NUDGE_FOR) { this.clearNudge(tr); tr.idleT = -6; } // ask again after a while
    }

    // colour rings: under the avatar on the screen, and under the person on the square
    tr.ring.position.set(tr.stage.x + ox, 0.02, tr.stage.z + oz);
    tr.ring.scale.setScalar(rig.style.scale ?? 1);
    tr.ring.material.opacity = s * (root?.y > 0.5 ? 0.55 : 0.95);
    tr.worldRing.position.set(p.pos.x, 0.045, p.pos.z);
    tr.worldRing.material.opacity = s * 0.9;

    // name tag & filter icon
    const sc = rig.style.scale ?? 1;
    tr.tag.position.copy(tr.stage).add(_v.set(0, 2.25 * sc, 0.2));
    tr.tag.material.opacity = (g?.type === 'talk' || tr.nudge ? 0 : clamp(1 - (age - 5) / 1.5, 0, 1)) * s;
    tr.tag.visible = tr.tag.material.opacity > 0.01;
    tr.filterIcon.visible = tr.filtered;
    tr.filterIcon.position.copy(tr.stage).add(_v.set(0.45, 1.75 * sc, 0.3));
  }

  clearNudge(tr) {
    if (!tr.nudge) return;
    tr.nudge.bubble.material.map.dispose();
    tr.nudge.bubble.removeFromParent();
    tr.nudge = null;
  }

  dropBike(tr) {
    if (!tr.bike) return;
    tr.bike.removeFromParent();
    tr.bike.traverse((o) => o.geometry?.dispose());
    tr.bike = null;
  }

  /** The circle in all the dancers' colours, turning slowly round each dance. */
  updateDanceCircles(t) {
    for (const g of this.groups.values()) {
      if (!g.circle) continue;
      const mid = _v.set(0, 0, 0);
      for (const m of g.members) mid.add(m.stage);
      mid.multiplyScalar(1 / g.members.length);
      const r = 0.45 + 0.17 * g.members.length;
      g.circle.position.set(mid.x, 0.018, mid.z);
      g.circle.scale.set((r + 0.75) * 2, 1, (r + 0.75) * 2 * 0.62);
      g.circle.rotation.y = 0;
      g.circle.material.opacity = 0.9 * smooth(0, 0.6, t - g.t0);
    }
  }

  updateExtras(dt, t) {
    const want = this.count === 0 ? 5 : [2, 2, 4, 7, 12][this.level];
    const fest = this.energy > 3.5;
    this.extras.forEach((ex, i) => {
      const shouldBeActive = i < want;
      const rig = ex.rig;
      if (shouldBeActive && !ex.active) {
        ex.active = true;
        ex.dir = this.rand() < 0.5 ? 1 : -1;
        ex.x = -ex.dir * 15;
        ex.z = ex.lane;
        ex.exiting = false;
        rig.root.visible = true;
      } else if (!shouldBeActive && ex.active && !ex.exiting) {
        ex.exiting = true;
        ex.dir = ex.x > 0 ? 1 : -1;
      }
      if (!ex.active) return;
      rig.resetTargets();
      if (fest && !ex.exiting) {
        // gather and dance
        const tx = -9 + (i / 11) * 18;
        const dx = tx - ex.x;
        if (Math.abs(dx) > 0.2) {
          ex.x += Math.sign(dx) * Math.min(Math.abs(dx), ex.speed * 1.3 * dt);
          ex.phase += dt * 6;
          animIdle(rig, t, ex.seed);
          animWalk(rig, ex.phase, 1);
          rig.root.rotation.y = Math.sign(dx) * Math.PI / 2;
        } else {
          animIdle(rig, t, ex.seed);
          animGesture(rig, i % 3 === 0 ? 'cheer' : 'dance', 0.5 + ((t + ex.danceOffset) % 3.2));
          rig.root.rotation.y = 0;
        }
      } else {
        ex.x += ex.dir * ex.speed * dt;
        ex.phase += dt * ex.speed * 5.5;
        animIdle(rig, t, ex.seed);
        animWalk(rig, ex.phase, 1);
        rig.root.rotation.y = ex.dir * Math.PI / 2;
        if (Math.abs(ex.x) > 15) {
          if (ex.exiting) { ex.active = false; rig.root.visible = false; return; }
          ex.dir *= -1;
        }
      }
      rig.root.position.set(ex.x, 0, ex.z);
      rig.update(dt, 14);
    });
  }

  updateFx(dt, t) {
    const e = this.energy;
    // flag
    if (this.flag) {
      const pos = this.flag.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = this.flagBase[i * 3];
        pos.setZ(i, Math.sin(x * 2.5 - t * 4) * 0.12 * x);
      }
      pos.needsUpdate = true;
    }
    // bunting
    const b = smooth(1.3, 2.2, e);
    this.bunting.visible = b > 0.01;
    this.bunting.children.forEach((f, i) => {
      f.scale.set(b, b, b);
      f.rotation.x = Math.sin(t * 2 + i) * 0.2;
    });
    // bulbs
    const l = smooth(2.3, 3.0, e);
    this.stageBulbs.visible = l > 0.01;
    this.stageBulbs.material.color.setScalar(0.4 + l * 2.2 * (0.85 + 0.15 * Math.sin(t * 6)));
    // stage spot cones
    const sc = this.spotLevel;
    this.stageCones.forEach((c, i) => {
      c.visible = sc > 0.01;
      if (c.visible) c.lookAt((i - 1) * 3.5 + Math.sin(t * 0.21 + i * 2) * 2.2, 0, 1.5 + Math.cos(t * 0.16 + i) * 1.2); // slow pan
      c.material.uniforms.intensity.value = sc * 0.35;
      c.material.uniforms.color.value.set('#ffe2b0'); // warm, vintage
    });
    // confetti while people dance
    const cf = this.danceLevel;
    this.confetti.visible = cf > 0.01;
    this.confetti.material.opacity = cf;
    if (this.confetti.visible) {
      const p = this.confetti.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) - this.confettiVel[i * 2] * dt;
        if (y < 0) y += 8;
        p.setY(i, y);
        p.setX(i, p.getX(i) + Math.sin(t * 2 + this.confettiVel[i * 2 + 1]) * dt * 0.3);
      }
      p.needsUpdate = true;
    }
    // particles
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.sp.position.addScaledVector(p.vel, dt);
      const a = clamp(p.life / p.max, 0, 1);
      p.sp.material.opacity = a;
      p.sp.scale.setScalar(p.size * (0.6 + 0.4 * a));
      if (p.life <= 0) p.sp.visible = false;
    }
    // stage lighting warms up with energy
    this.stageKey.intensity = 2.0 + e * 0.25;
    // gentle camera push-in at higher energy
    this.archiveCam.position.z = 9.5 - e * 0.25;
    this.archiveCam.position.x = Math.sin(t * 0.07) * (this.count === 0 ? 1.2 : 0.2);
    this.updateCars(dt);
    this.updateFireworks(dt);
    this.archiveCam.lookAt(this.archiveCam.position.x * 0.5, 2.0, -1);
  }

  updateHardware(dt, t, env) {
    const e = this.energy;
    const night = env.night;
    // screen glow
    this.screenLight.intensity = (1.2 + e * 0.35) * (0.7 + night * 2.5) * this.fade;
    this.screenLight.color.setHSL(0.09 - Math.min(e, 3) * 0.01, 0.5 - Math.min(e, 3) * 0.12, 0.8);
    // sensor LEDs blink when tracking
    this.sensorLeds.forEach((led, i) => {
      const on = this.count > 0 ? Math.sin(t * 8 + i) > -0.2 : Math.sin(t * 1.5 + i) > 0.9;
      led.material.color.set(on ? (this.count > 0 ? '#ff2a2a' : '#661010') : '#200505');
    });
    // vintage spotlights on the stage when 3+ people stand on it; they pan slowly over the stage
    const sp = this.spotLevel;
    const fest = e > 3.5;
    this.spots.forEach((s) => {
      if (sp > 0.01) {
        const k = s.i * 1.7;
        const aim = _v.copy(s.aim).add(_v2.set(Math.cos(t * 0.17 + k) * 0.9, 0, Math.sin(t * 0.23 + k) * 1.4));
        aim.z = clamp(aim.z, STAGE.z0 + 0.5, STAGE.z1 - 0.5);
        s.light.target.position.copy(aim);
        s.light.target.updateMatrixWorld();
        const w = this.hw.localToWorld(aim);
        s.beam.lookAt(w);
        s.head.lookAt(w);
        s.head.rotateX(Math.PI / 2);
      }
      const col = _c.set('#ffd9a0');
      s.light.color.copy(col);
      s.light.intensity = sp * (60 + night * 140);
      s.beam.visible = sp > 0.01;
      s.beam.material.uniforms.color.value.copy(col);
      s.beam.material.uniforms.intensity.value = sp * (0.06 + night * 0.3);
    });
    // guide strips in the paving: only lit when it is dark (feedback v4) – off by day, dim at dusk
    this.guidePhase += dt * 0.3; // bands move ~1.2 m/s
    this.guideMat.uniforms.phase.value = this.guidePhase;
    this.guideMat.uniforms.intensity.value = smooth(0.2, 1, night) * 2.1;
    // festoon lights
    const f = smooth(2.2, 3.0, e);
    const bright = 0.35 + f * (1.4 + night * 2.2);
    this.festoon.material.color.setScalar(bright);
    if (fest) {
      for (let i = 0; i < this.festoonPts.length; i++) {
        this.festoon.setColorAt(i, _c.setHSL((i * 0.07 + t * 0.2) % 1, 0.8, 0.6));
      }
      this.festoon.instanceColor.needsUpdate = true;
      this.festoonWasFest = true;
    } else if (this.festoonWasFest) {
      for (let i = 0; i < this.festoonPts.length; i++) this.festoon.setColorAt(i, _c.set('#ffd08a'));
      this.festoon.instanceColor.needsUpdate = true;
      this.festoonWasFest = false;
    }
    this.festoonLights.forEach((l) => { l.intensity = f * (4 + night * 18); });
    this.updateMarquee(t, night);
  }

  updateSensorViz() {
    let li = 0, pi = 0;
    const colors = ['#39ff9f', '#ffd166', '#6ecbff', '#ff7bd5', '#b69cff', '#ff9f5a'];
    const col = new THREE.Color();
    const pushLine = (a, b, c) => {
      if (li * 6 + 6 > this.vizLinePos.length) return;
      this.vizLinePos.set([a.x, a.y, a.z, b.x, b.y, b.z], li * 6);
      this.vizLineCol.set([c.r, c.g, c.b, c.r, c.g, c.b], li * 6);
      li++;
    };
    let idx = 0;
    const jp = {};
    for (const tr of this.tracked.values()) {
      col.set(colors[idx++ % colors.length]);
      if (tr.filtered) col.set('#ff3b3b');
      for (const n of JOINTS) jp[n] = tr.person.rig.worldPos(n, new THREE.Vector3());
      for (const [a, b] of BONES) pushLine(jp[a], jp[b], col);
      for (const n of JOINTS) {
        if (pi * 3 + 3 > this.vizPointPos.length) break;
        this.vizPointPos.set([jp[n].x, jp[n].y, jp[n].z], pi * 3);
        this.vizPointCol.set([col.r, col.g, col.b], pi * 3);
        pi++;
      }
      // ring on the floor
      const c = tr.person.pos;
      for (let k = 0; k < 12; k++) {
        const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2;
        pushLine(_v.set(c.x + Math.cos(a0) * 0.45, 0.06, c.z + Math.sin(a0) * 0.45), _v2.set(c.x + Math.cos(a1) * 0.45, 0.06, c.z + Math.sin(a1) * 0.45), col);
      }
    }
    // proximity links
    const pink = new THREE.Color('#ff4f7a');
    for (const g of this.groups.values()) {
      for (let i = 1; i < g.members.length; i++) {
        pushLine(_v.copy(g.members[i - 1].person.pos).setY(0.08), _v2.copy(g.members[i].person.pos).setY(0.08), pink);
        pushLine(_v.copy(g.members[i - 1].person.pos).setY(1.2), _v2.copy(g.members[i].person.pos).setY(1.2), pink);
      }
    }
    this.vizLines.geometry.setDrawRange(0, li * 2);
    this.vizLines.geometry.attributes.position.needsUpdate = true;
    this.vizLines.geometry.attributes.color.needsUpdate = true;
    this.vizPoints.geometry.setDrawRange(0, pi);
    this.vizPoints.geometry.attributes.position.needsUpdate = true;
    this.vizPoints.geometry.attributes.color.needsUpdate = true;
  }

  setSensorView(on) {
    this.sensorView = on;
    this.sensorGroup.visible = on;
  }

  drawOverlay() {
    const c = this.overlayCanvas, ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const th = THEMES[this.theme];
    // the header steps aside while avatars chat, so their fact bubbles are always readable
    if (!this.talking) this.drawOverlayHeader(ctx, W, th);
    this.drawOverlayBody(ctx, W, H);
    this.drawSocialMeter(ctx, W, H);
    this.overlayTex.needsUpdate = true;
  }

  drawOverlayHeader(ctx, W, th) {
    // caption (archival label)
    ctx.fillStyle = 'rgba(12,10,8,0.55)';
    ctx.fillRect(40, 30, 560, 92);
    ctx.fillStyle = '#f4e6c6';
    ctx.font = 'bold 40px "Courier New", Courier, monospace';
    ctx.fillText(th.caption, 60, 76);
    ctx.font = 'italic 24px Georgia, serif';
    ctx.fillStyle = '#d8c8a4';
    ctx.fillText(th.sub, 60, 106);
  }

  /** The social meter on the right edge of the wall: empty with nobody there, fireworks when full. */
  drawSocialMeter(ctx, W, H) {
    this.socialDrawn = this.social;
    const v = this.social, full = this.full;
    const bw = 44, x = W - 40 - bw, y0 = 74, y1 = H - 64;
    ctx.fillStyle = 'rgba(12,10,8,0.6)';
    ctx.beginPath(); ctx.roundRect(x - 30, 22, bw + 60, H - 44, 22); ctx.fill();
    ctx.fillStyle = '#f4e6c6';
    ctx.font = 'bold 22px Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('SOCIAL', x + bw / 2, 56);
    // tube
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.roundRect(x, y0, bw, y1 - y0, bw / 2); ctx.fill();
    if (v > 0.002) {
      const h = Math.max(bw, (y1 - y0) * v);
      const grd = ctx.createLinearGradient(0, y1, 0, y0);
      grd.addColorStop(0, '#f1c453'); grd.addColorStop(0.5, '#f4845f'); grd.addColorStop(1, '#ff4f7a');
      ctx.fillStyle = grd;
      ctx.save();
      ctx.beginPath(); ctx.roundRect(x, y0, bw, y1 - y0, bw / 2); ctx.clip();
      ctx.fillRect(x, y1 - h, bw, h);
      ctx.restore();
    }
    if (full) {
      ctx.strokeStyle = `rgba(255,233,184,${0.6 + 0.4 * Math.sin(this.time * 8)})`;
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.roundRect(x - 4, y0 - 4, bw + 8, y1 - y0 + 8, bw / 2 + 4); ctx.stroke();
    }
    ctx.fillStyle = full ? '#ffe9b8' : '#d8c8a4';
    ctx.font = 'bold 24px Helvetica, Arial';
    ctx.fillText(`${Math.round(v * 100)}%`, x + bw / 2, H - 32);
    ctx.textAlign = 'left';
  }

  drawOverlayBody(ctx, W, H) {
    // attract text
    if (this.count === 0) {
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#fff6e0';
      ctx.font = 'bold 64px Georgia, serif';
      ctx.fillText('Step closer and become part of the square’s history', W / 2, H / 2 + 10);
      ctx.font = 'italic 34px Georgia, serif';
      ctx.fillStyle = '#f1dcae';
      ctx.fillText('Guldhedstorget as it looked in the 1940s', W / 2, H / 2 + 62);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
    }
    // toast
    if (this.toast) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 40px Georgia, serif';
      const w = ctx.measureText(this.toast.text).width + 80;
      ctx.fillStyle = 'rgba(12,10,8,0.6)';
      ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, H - 110, w, 70, 35); ctx.fill();
      ctx.fillStyle = '#ffe9b8';
      ctx.fillText(this.toast.text, W / 2, H - 62);
      ctx.textAlign = 'left';
    }
    this.overlayTex.needsUpdate = true;
  }

  render(renderer) {
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.archive, this.archiveCam);
    renderer.setRenderTarget(prevTarget);
  }

  getState() {
    const player = [...this.tracked.values()].find((tr) => tr.person.isPlayer && !tr.leaving);
    return {
      count: this.count,
      level: this.level,
      energy: this.energy,
      social: +this.social.toFixed(3),
      fireworks: this.full,
      spots: this.footGlows.map((f) => (f.occupant ? f.occupant.person.name : null)),
      actions: [...this.tracked.values()].filter((tr) => tr.action).map((tr) => `${tr.person.name}:${tr.action.name}`),
      bikes: [...this.tracked.values()].filter((tr) => tr.bike).map((tr) => tr.person.name),
      nudges: [...this.tracked.values()].filter((tr) => tr.nudge).map((tr) => tr.person.name),
      theme: this.theme,
      muted: this.muted,
      playerAvatar: player ? player.style : null,
      filterActive: this.filterActive,
      groups: [...this.groups.values()].map((g) => ({ type: g.type, members: g.members.map((m) => m.person.name) })),
    };
  }
}

const _c = new THREE.Color();

function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color('#fff1dc') }, intensity: { value: 0 } },
    vertexShader: /* glsl */`
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vAlong = position.z;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 color;
      uniform float intensity;
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float f = pow(abs(dot(normalize(vN), normalize(vView))), 1.5);
        float a = intensity * f * pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.2);
        gl_FragColor = vec4(color * a, a);
        #include <colorspace_fragment>
      }`,
  });
}

/** A historical-fact speech bubble for the LED wall. */
function factBubble(text, { worldW = 3.5, thought = false } = {}) {
  const W = 1000, pad = 38, lineH = 62;
  const ctx0 = makeCanvas(8, 8).getContext('2d');
  ctx0.font = `${thought ? 'italic ' : ''}600 52px Georgia, serif`;
  const words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx0.measureText(test).width > W - pad * 2 && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  const H = pad * 2 + lines.length * lineH + 30;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  const bw = Math.min(W - 4, Math.max(...lines.map((l) => ctx0.measureText(l).width)) + pad * 2);
  const x0 = (W - bw) / 2;
  ctx.fillStyle = '#fffaf0';
  ctx.strokeStyle = '#3a2a1a';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.roundRect(x0, 3, bw, H - 34, 28); ctx.fill(); ctx.stroke();
  if (thought) {
    // a thought, not speech: little bubbles instead of a pointed tail
    for (const [x, y, r] of [[W / 2 - 6, H - 22, 9], [W / 2 + 4, H - 7, 5]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  } else {
    ctx.beginPath(); ctx.moveTo(W / 2 - 22, H - 33); ctx.lineTo(W / 2 - 4, H - 4); ctx.lineTo(W / 2 + 18, H - 33); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(W / 2 - 22, H - 31); ctx.lineTo(W / 2 - 4, H - 4); ctx.lineTo(W / 2 + 18, H - 31); ctx.stroke();
  }
  ctx.fillStyle = '#2a1d10';
  ctx.font = `${thought ? 'italic ' : ''}600 52px Georgia, serif`;
  ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, pad + 44 + i * lineH));
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: toTexture(c, { wrap: false }), transparent: true, depthWrite: false, depthTest: false }));
  sp.scale.set(worldW, worldW * (H / W), 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 10;
  return sp;
}

/** A rounded 1940s saloon (Volvo PV444-ish) or a delivery van (PV445-ish). */
function vintageCar(color, van = false) {
  const g = new THREE.Group();
  const paint = M(color, 0.35, 0.3), chrome = M('#d8d8d8', 0.2, 0.9), dark = M('#141618', 0.3, 0.4), tyre = M('#111', 0.7);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 2.7, 8, 16), paint);
  body.rotation.z = Math.PI / 2; body.scale.set(1, 1, 1.32); body.position.y = 0.72;
  g.add(body);
  if (van) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.05, 1.55), paint);
    box.position.set(-0.55, 1.25, 0); g.add(box);
    const win = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 10, 0, Math.PI), dark);
    win.scale.set(0.9, 0.6, 1); win.rotation.y = -Math.PI / 2; win.position.set(0.55, 1.2, 0); g.add(win);
  } else {
    const cab = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 12), paint);
    cab.scale.set(1.3, 0.7, 0.85); cab.position.set(-0.25, 1.15, 0); g.add(cab);
    const win = new THREE.Mesh(new THREE.SphereGeometry(0.91, 20, 12), dark);
    win.scale.set(1.0, 0.55, 0.8); win.position.set(-0.25, 1.22, 0); g.add(win);
  }
  g.userData.wheels = [];
  for (const wx of [-1.2, 1.2]) for (const wz of [-0.72, 0.72]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 16), tyre);
    w.rotation.x = Math.PI / 2; w.position.set(wx, 0.33, wz); g.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.24, 12), chrome);
    hub.rotation.x = Math.PI / 2; hub.position.set(wx, 0.33, wz); g.add(hub);
    g.userData.wheels.push(w);
  }
  for (const bx of [-2.0, 2.0]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 1.65), chrome);
    bumper.position.set(bx, 0.5, 0); g.add(bumper);
  }
  const lamp = new THREE.MeshBasicMaterial({ color: '#fff3d0' });
  for (const lz of [-0.5, 0.5]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), lamp);
    l.position.set(1.95, 0.85, lz); g.add(l);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** Soft round glow (white centre fading out) for light pools on the ground. */
function glowTexture() {
  const c = makeCanvas(128, 128), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(c, { wrap: false });
}

/** A ring in one colour, or split into arcs of several colours (the circle round a dance). */
function ringTexture(colors) {
  const c = makeCanvas(256, 256), ctx = c.getContext('2d');
  ctx.lineWidth = 26;
  ctx.shadowBlur = 12;
  const n = colors.length;
  colors.forEach((col, i) => {
    ctx.strokeStyle = ctx.shadowColor = `#${col.getHexString()}`;
    ctx.beginPath();
    ctx.arc(128, 128, 104, (i / n) * Math.PI * 2 + 0.04, ((i + 1) / n) * Math.PI * 2 - 0.04);
    ctx.stroke();
  });
  return toTexture(c, { wrap: false });
}

/** A ring lying flat on the ground (planar UVs, so ringTexture maps onto it). */
function groundRing(size, map, color = '#fff') {
  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false, toneMapped: false }));
  m.renderOrder = 4;
  return m;
}

/** A simple roadster bicycle in the rider's colour, along +z, wheels on the ground. */
function bicycle(color) {
  const g = new THREE.Group();
  const frame = M(`#${color.getHexString()}`, 0.4, 0.3), metal = M('#c8c8c8', 0.25, 0.9), tyre = M('#151515', 0.8), leather = M('#4a2e1a', 0.7);
  const rod = (a, b, r, mat) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(m);
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  g.userData.wheels = [];
  for (const z of [-0.55, 0.55]) {
    const w = new THREE.Group();
    w.position.set(0, 0.36, z);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 8, 32), tyre);
    rim.rotation.y = Math.PI / 2;
    w.add(rim);
    for (let k = 0; k < 4; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.66, 0.01), metal);
      sp.rotation.x = (k / 4) * Math.PI;
      w.add(sp);
    }
    g.add(w);
    g.userData.wheels.push(w);
  }
  const crank = V(0, 0.33, -0.02), seat = V(0, 0.82, -0.18), head = V(0, 0.86, 0.4);
  rod(V(0, 0.36, -0.55), crank, 0.018, frame);
  rod(V(0, 0.36, -0.55), seat, 0.018, frame);
  rod(crank, seat, 0.022, frame);
  rod(crank, head, 0.022, frame);
  rod(seat, head, 0.02, frame);
  rod(head, V(0, 0.36, 0.55), 0.018, frame);
  rod(head, V(0, 1.02, 0.36), 0.016, metal);
  rod(V(-0.26, 1.02, 0.34), V(0.26, 1.02, 0.34), 0.014, metal);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.26), leather);
  saddle.position.set(0, 0.86, -0.18);
  g.add(saddle);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeFilterIcon() {
  const c = makeCanvas(128, 128), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(20,10,10,0.7)';
  ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ff4b4b'; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.arc(64, 64, 44, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(33, 95); ctx.lineTo(95, 33); ctx.stroke();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: toTexture(c, { wrap: false }), transparent: true, depthWrite: false }));
  sp.scale.set(0.4, 0.4, 1);
  return sp;
}
