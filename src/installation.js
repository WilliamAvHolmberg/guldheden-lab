import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Rig, HISTORICAL, animIdle, animWalk, animTalk, animGesture, animAvatar, animBike, makeBicycle, animHoldHand, animSetDance, makeFlower, AVATAR_FOR, AVATAR_ACTIONS, BONES, JOINTS, M } from './character.js';
import { FACTS } from './facts.js';
import { LAYOUT, STAGE, toScreenLocal, screenToWorld, onStage, hipRoof } from './world.js';
import { hashStr } from './net.js';
import { staticBatch } from './batch.js';
import {
  rng, makeCanvas, toTexture, gradientSkyTexture, signTexture, sparkleTexture,
  heartTexture, stageFloorTexture, backPanelTexture, plazaField1944Texture, lawn1944Texture, footSpots, footPairTexture, shopWindowTexture, scriptSignTexture,
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
const METER_W = 256; // width of the social-meter strip on the right of the wall (overlay pixels)

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
    this.handChains = [];
    this.social = 0; // social meter on the wall, 0..1: how social the stage is right now
    this.socialShown = -1;
    this.full = false;
    this.fireworkCd = 0;
    this.candidates = new Map(); // candidate group key → first time seen
    this.oldBubbles = [];
    this.danceLevel = 0;
    this.sensorView = false;
    this.muted = false;
    this.onShared = null; // (patch) => void, called when the local user changes shared state
    this.toast = null;
    this.overlayDirty = true;
    this.overlayTimer = 0;
    this.filterActive = false;

    this.hw = new THREE.Group();
    scene.add(this.hw);

    this.buildArchive();
    this.buildScreen();
    this.buildHardware(obstacles);
    this.buildLights(obstacles);
    this.buildSensorViz();
    this.buildGuides();
    // place the whole installation (built in its local frame) out on the square
    this.hw.position.set(LAYOUT.screen.cx, 0, LAYOUT.screen.cz);
    this.hw.rotation.y = LAYOUT.screen.rot;
    this.hw.updateMatrixWorld(true);
    this.finalizeSeats();
    for (const s of this.spots) s.beam.userData.dynamic = s.head.userData.dynamic = true; // they sweep slowly while lit
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
    this.buildBunting();
    this.buildStageLights();
    this.buildConfetti();
    this.buildParticles();
    this.buildFireworks();

    // no extra passers-by on the screen: every figure there is someone standing on the stage (feedback v4)

    // overlay (captions, level meter, attract text)
    this.overlayCanvas = makeCanvas(RT_W, RT_H);
    this.overlayTex = toTexture(this.overlayCanvas, { wrap: false });
    this.overlayTex.colorSpace = THREE.SRGBColorSpace;
    // the social meter has its own small texture on the right edge: it animates (light band, pulse)
    // and re-uploading only this strip is ~8× cheaper than the whole overlay
    this.meterCanvas = makeCanvas(METER_W, RT_H);
    this.meterTex = toTexture(this.meterCanvas, { wrap: false });
    this.meterTex.colorSpace = THREE.SRGBColorSpace;
    this.meterDirty = true;
    this.meterTimer = 0;
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
      // one texture tile = 2 × 2 fields in different stone tones (as in the photos), so it repeats every 12 × 8 m
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 78 / 12, uv.getY(i) * 40 / 8);
      const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: toTexture(plazaField1944Texture(6, 4, 0.38, 2, 2)), roughness: 0.9 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.z = -10; // frame lines at z = 10, 6, 2, -2, -6, -10 (along the street kerb)
      ground.receiveShadow = true;
      g.add(ground);
    }
    // the street the cars use, with a kerb on each side
    add(new THREE.BoxGeometry(80, 0.02, 3.8), M('#a39d90', 0.95), 0, 0.012, -12.25, false); // pale, dusty 1940s asphalt
    add(new THREE.BoxGeometry(80, 0.1, 0.25), M('#d8d2c4', 0.9), 0, 0.05, -10.25, false); // light granite kerbs
    add(new THREE.BoxGeometry(80, 0.1, 0.25), M('#d8d2c4', 0.9), 0, 0.05, -14.25, false);
    // three cars parked along the far kerb (after the group's reference photos)
    const parked1 = vintageCar('#4c5d55', { roof: '#e9e3d2' }); // two-tone saloon, grey-green with a cream roof
    parked1.position.set(-7.5, 0, -13.35);
    g.add(parked1);
    const parked2 = vintageCar('#2f4570', { coupe: true }); // blue coupé (light enough that its windows read)
    parked2.position.set(10.5, 0, -13.35);
    parked2.rotation.y = Math.PI;
    g.add(parked2);
    const parked3 = vintageCar('#3f6b5a', { van: true, sign: 'Konditori' }); // the café's delivery van (PV445-style)
    parked3.position.set(3.2, 0, -13.35);
    g.add(parked3);

    // lawn with green slatted benches and white flower boxes (front left in the photo)
    const benchGreen = M('#2d5a39', 0.7), white = M('#f3efe4', 0.8);
    const flowerCols = ['#d2384a', '#e9677a', '#f2c14e', '#c43b6b'];
    const lawnTex = toTexture(lawn1944Texture(), { repeat: [9.2 / 4, 4.6 / 4] });
    add(new THREE.BoxGeometry(9.2, 0.1, 4.6), new THREE.MeshStandardMaterial({ map: lawnTex, roughness: 1 }), -6.5, 0.05, -7.3, false);
    // low light-stone kerb around the lawn
    const kerb = M('#ddd7c9', 0.9);
    add(new THREE.BoxGeometry(9.5, 0.14, 0.15), kerb, -6.5, 0.07, -4.95, false);
    add(new THREE.BoxGeometry(9.5, 0.14, 0.15), kerb, -6.5, 0.07, -9.65, false);
    add(new THREE.BoxGeometry(0.15, 0.14, 4.85), kerb, -1.93, 0.07, -7.3, false);
    add(new THREE.BoxGeometry(0.15, 0.14, 4.85), kerb, -11.07, 0.07, -7.3, false);

    // the pond with curved stone steps in front of the restaurant (1945 photo), and Milles' "Susanna"
    {
      const PX = -9.3, PZ = -1.8; // in the left foreground, like the 1945 photo – clear of where the avatars stand
      const stone = M('#cbc3b2', 0.9), stone2 = M('#bdb5a3', 0.9), stone3 = M('#b0a896', 0.9);
      [[2.9, 0.09, stone], [2.55, 0.065, stone2], [2.25, 0.04, stone3]].forEach(([rad, h, mat]) => {
        add(new THREE.CylinderGeometry(rad, rad, h, 48), mat, PX, h / 2, PZ, false); // three steps down to the water
      });
      const water = add(new THREE.CircleGeometry(1.95, 48), M('#7fa7ab', 0.08, 0.35), PX, 0.045, PZ, false); // light: it mirrors the teal sky
      water.rotation.x = -Math.PI / 2;
      // reeds and a few water lilies
      const reed = M('#5f7d3a', 0.9), lily = M('#4f7f3a', 0.8), bloom = M('#f4efe4', 0.6);
      for (let k = 0; k < 14; k++) {
        const a = Math.PI * (1.05 + r() * 0.9), rad = 1.45 + r() * 0.3; // along the back of the pond
        const h = 0.6 + r() * 0.6;
        add(new THREE.CylinderGeometry(0.012, 0.02, h, 4), reed, PX + Math.cos(a) * rad, 0.08 + h / 2, PZ + Math.sin(a) * rad, false).rotation.z = (r() - 0.5) * 0.3;
      }
      for (let k = 0; k < 6; k++) {
        const a = r() * Math.PI * 2, rad = 0.4 + r() * 1.0;
        const pad = add(new THREE.CircleGeometry(0.18 + r() * 0.08, 10), lily, PX + Math.cos(a) * rad, 0.05, PZ + Math.sin(a) * rad, false);
        pad.rotation.x = -Math.PI / 2;
        if (k % 2 === 0) add(new THREE.SphereGeometry(0.06, 8, 6), bloom, pad.position.x, 0.08, pad.position.z, false);
      }
      // the sculpture on its plinth at the edge of the pond
      const bronze = M('#5a4a33', 0.45, 0.6);
      add(new THREE.BoxGeometry(0.7, 0.9, 0.7), M('#d6cfbf', 0.9), PX + 1.9, 0.6, PZ - 1.9);
      add(new THREE.CapsuleGeometry(0.16, 0.35, 6, 10), bronze, PX + 1.9, 1.35, PZ - 1.9);
      add(new THREE.SphereGeometry(0.12, 12, 10), bronze, PX + 1.9, 1.78, PZ - 1.88);
      add(new THREE.CapsuleGeometry(0.06, 0.32, 4, 8), bronze, PX + 2.05, 1.4, PZ - 1.75).rotation.z = 0.6;
    }
    for (let i = 0; i < 3; i++) {
      const x = -9.8 + i * 2.7;
      // bench: seat + back + white legs
      add(new THREE.BoxGeometry(1.7, 0.06, 0.45), benchGreen, x, 0.48, -6.2);
      add(new THREE.BoxGeometry(1.7, 0.45, 0.05), benchGreen, x, 0.78, -6.45).rotation.x = -0.15;
      for (const lx of [-0.75, 0.75]) add(new THREE.BoxGeometry(0.06, 0.48, 0.4), white, x + lx, 0.24, -6.25);
      // flower box between the benches
      if (i < 2) {
        const bx = x + 1.35;
        add(new THREE.BoxGeometry(0.9, 0.42, 0.6), white, bx, 0.31, -6.6);
        for (let k = 0; k < 7; k++) {
          add(new THREE.SphereGeometry(0.1 + r() * 0.05, 8, 6), M(flowerCols[(i + k) % flowerCols.length], 0.8), bx + (r() - 0.5) * 0.7, 0.6, -6.6 + (r() - 0.5) * 0.4, false);
        }
      }
    }

    // young birches along the lawn and the street
    const birchBark = M('#ece8de', 0.8), birchMark = M('#2b2724', 0.9), birchLeaf = M('#7fa24a', 1);
    for (const [x, z] of [[-19.4, -9.4], [-9.5, -9.6], [-4.2, -9.4], [5.5, -9.5], [11, -9.4], [16.5, -9.6]]) {
      add(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 8), birchBark, x, 2.1, z);
      for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.16, 0.05, 0.16), birchMark, x, 0.6 + k * 0.85 + r() * 0.3, z, false);
      for (let k = 0; k < 4; k++) {
        const b = add(new THREE.IcosahedronGeometry(0.75 + r() * 0.35, 1), birchLeaf, x + (r() - 0.5) * 1.1, 3.6 + r() * 1.3, z + (r() - 0.5) * 0.8);
        b.scale.y = 1.3;
      }
    }
    // globe street lamp on the left
    add(new THREE.CylinderGeometry(0.05, 0.08, 4.4, 8), M('#1c1c1c', 0.5, 0.5), -12.9, 2.2, -4.3); // beside the pond, as in the photo
    add(new THREE.SphereGeometry(0.28, 16, 12), M('#f7f2e2', 0.3, 0, { emissive: '#ffe4b0', emissiveIntensity: 0.25 }), -12.9, 4.55, -4.3);

    // left: low shop building with a dark roof, small triangular dormers and a long red awning
    add(new THREE.BoxGeometry(18, 3.4, 7), M('#e9e3d2', 0.95), -16, 1.7, -18.5);
    const lowRoof = add(hipRoof(7.8, 18.8, 3.4), M('#3d4148', 0.7, 0.05, { side: THREE.DoubleSide }), -16, 3.4, -18.5);
    lowRoof.rotation.y = Math.PI / 2;
    for (const x of [-22, -18.5, -15, -11.5]) {
      const tri = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 0.75)]);
      add(new THREE.ShapeGeometry(tri), M('#f0ede4', 0.6), x, 4.65, -16.05, false); // sits on the roof slope
    }
    this.windowGrid(g, -23.5, 1.3, -14.97, 6, 1, 3, 0, 2.3, 1.8, winMat);
    // the restaurant's name in white script on the roof, as in the photos
    // mounted flat on the front roof slope (eave at z -14.6, y 3.4; ridge 3.9 m back and 3.4 m up)
    const rsign = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 1.25), new THREE.MeshBasicMaterial({ map: scriptSignTexture('Guldheden'), transparent: true, toneMapped: false }));
    const slope = Math.atan2(3.4, 3.9);
    rsign.position.set(-17.7, 3.4 + (2.9 / 3.9) * 3.4 + 0.06, -14.6 - 2.9 + 0.05); // above the dormers, between the birches as seen from the screen camera
    rsign.rotation.x = -slope;
    g.add(rsign);
    for (const x of [-24, -20, -16, -12, -8]) add(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 8), M('#d8d2c4', 0.6), x, 1.3, -13.65); // awning posts
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
    // the shop row (after the 1940s photos): Konditori, Tobak and the Manufaktur draper's,
    // each with a lit window display, under a painted sign band
    const shops = ['konditori', 'konditori', 'tobak', 'tobak', 'manufaktur', 'manufaktur', 'manufaktur'];
    const winTex = {};
    shops.forEach((kind, k) => {
      winTex[kind] ??= shopWindowTexture(kind);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.1), new THREE.MeshBasicMaterial({ map: winTex[kind], toneMapped: false, color: '#e8e2d6' }));
      w.position.set(LX - LW / 2 + 2.2 + k * 4.1, 1.45, -15.94);
      g.add(w);
    });
    add(new THREE.BoxGeometry(LW, 0.55, 0.06), M('#e3ddd0', 0.8), LX, 3.0, -15.95, false);
    const shopX = (a, b) => LX - LW / 2 + 2.2 + ((a + b) / 2) * 4.1;
    for (const [txt, x, fg, font] of [
      ['KONDITORI', shopX(0, 1), '#2d5a39', 'bold 54px Helvetica, Arial'],
      ['Tobak', shopX(2, 3), '#b5332b', 'italic bold 66px Georgia, serif'],
      ['MANUFAKTUR', shopX(4, 6), '#2a2622', 'bold 54px Helvetica, Arial'],
    ]) {
      const sgn = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.5), new THREE.MeshStandardMaterial({ map: signTexture(txt, { bg: '#e3ddd0', fg, font }) }));
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

  /**
   * Fireworks over the 1940s square while the social meter is full. Each burst is one Points cloud
   * (one draw call). Normal blending: additive light would vanish against the white 1944 facades.
   */
  buildFireworks() {
    this.fireworks = [];
    const tex = sparkleTexture();
    for (let k = 0; k < 6; k++) {
      const n = 180;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.6, map: tex, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, alphaTest: 0.05 }));
      pts.visible = false;
      pts.frustumCulled = false;
      this.archive.add(pts);
      this.fireworks.push({ pts, vel: new Float32Array(n * 3), life: 0, max: 1 });
    }
  }

  /** One burst in the sky of the 1944 square, in the colours of the people on the stage. */
  launchFirework() {
    const fw = this.fireworks.find((f) => f.life <= 0);
    if (!fw) return;
    const cols = [...this.tracked.values()].filter((tr) => !tr.leaving).map((tr) => new THREE.Color(tr.color));
    if (!cols.length) cols.push(new THREE.Color('#ffd27a'));
    const pos = fw.pts.geometry.attributes.position, col = fw.pts.geometry.attributes.color;
    // low enough to burst inside the wall camera's view, in front of the 1944 facades
    const cx = (this.rand() - 0.5) * 16, cy = 4.0 + this.rand() * 1.2, cz = -7 - this.rand() * 3;
    const c0 = cols[Math.floor(this.rand() * cols.length)], c1 = cols[Math.floor(this.rand() * cols.length)];
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, cx, cy, cz);
      const u = (i + 0.5) / pos.count, th = Math.acos(1 - 2 * u), ph = i * 2.39996; // evenly on a sphere
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
        meter: { value: this.meterTex },
        meterX: { value: 1 - METER_W / RT_W },
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
        uniform sampler2D map, overlay, meter;
        uniform float saturation, grain, time, fade, brightness, gridAmt, meterX;
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
          // social meter strip on the right edge
          if (vUv.x > meterX) {
            vec4 m = texture2D(meter, vec2((vUv.x - meterX) / (1.0 - meterX), vUv.y));
            col = mix(col, m.rgb, m.a);
          }
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
    // glow overlays for the painted footprints: lit in the colour of whoever stands on them
    const spots = footSpots(STAGE);
    const footTex = footPairTexture();
    this.footSpots = [];
    for (const [kind, list] of Object.entries(spots)) {
      list.forEach((sp, i) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), new THREE.MeshBasicMaterial({ map: footTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = -Math.PI / 2; // texture "up" points towards the screen (+x)
        m.position.set(sp.x, 0.03, sp.z);
        m.visible = false;
        m.userData.dynamic = true;
        m.renderOrder = 3;
        this.hw.add(m);
        this.footSpots.push({ kind, i, x: sp.x, z: sp.z, mesh: m, occupant: null });
      });
    }
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
        const seat = new THREE.Object3D();
        seat.position.set(sx, 0, -0.02);
        g.add(seat);
        const front = new THREE.Object3D();
        front.position.set(sx, 0, 0.85);
        g.add(front);
        // LED strips along the front edge of the seat and the top of the backrest: dark when the seat
        // is free, lit in the colour of whoever sits there
        const ledMat = new THREE.MeshBasicMaterial({ color: LED_OFF, toneMapped: false });
        const ledFront = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.026, 0.026), ledMat);
        ledFront.position.set(sx, 0.45, 0.178);
        const ledBack = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.026, 0.026), ledMat);
        ledBack.position.set(sx, 0.795, -0.29);
        ledBack.rotation.x = -0.2;
        ledFront.userData.dynamic = ledBack.userData.dynamic = true;
        // …and a pool of the same colour on the ground under the seat: the bench lights up from below
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.3), new THREE.MeshBasicMaterial({
          map: this.glowTex ??= glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        }));
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(sx, 0.03, -0.05);
        pool.visible = false;
        pool.userData.dynamic = true;
        g.add(ledFront, ledBack, pool);
        this.seatAnchors.push({ seat, front, group: g, bench: benchIndex, led: ledMat, pool });
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
      return { pos, front, heading, occupant: null, bench: a.bench, led: a.led, pool: a.pool };
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
      this.spots.push({ light, beam, head, base, i, aim: target.clone(), target: target.clone() });
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
          float a = (0.5 + 1.3 * pow(band, 4.0)) * smoothstep(0.0, 0.6, across) * intensity; // steady glow + calm pulses
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

  /**
   * A caption on the wall. Not used for the interactions any more (feedback v5): visitors should find
   * out for themselves what standing together does, so nothing on the screen explains it.
   */
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
        if (tr.nudge) { tr.nudge.material.map.dispose(); tr.nudge.removeFromParent(); }
        tr.ring.geometry.dispose(); tr.ring.material.dispose(); tr.ring.removeFromParent();
        tr.person.handSides = []; // left the stage: let go of any hands
        tr.bike?.removeFromParent();
        this.tracked.delete(id);
      }
    }
    const active = [...this.tracked.values()].filter((tr) => !tr.leaving);
    const prevLevel = this.level;
    this.count = active.length;
    this.level = this.count === 0 ? 0 : this.count === 1 ? 1 : this.count === 2 ? 2 : this.count <= 4 ? 3 : 4;
    if (this.level !== prevLevel) {
      this.overlayDirty = true;
      this.onEvent(`Level ${this.level}: ${LEVELS[this.level].en} (${this.count} ${this.count === 1 ? 'person' : 'people'})`, 'level');
    }
    this.energy += (this.level - this.energy) * (1 - Math.exp(-dt * 1.2));

    this.standing = active.filter((tr) => !tr.seat).length;
    // black & white while the stage is empty, full colour as soon as someone steps in
    this.colour += ((this.count > 0 ? 1 : 0) - this.colour) * (1 - Math.exp(-dt * 1.6));
    // spotlights: as soon as 3+ people stand on the stage (close together or not); confetti only while they dance
    this.spotLevel += ((this.dancing || this.standing >= 3 ? 1 : 0) - this.spotLevel) * (1 - Math.exp(-dt * 2));
    this.danceLevel += ((this.dancing ? 1 : 0) - this.danceLevel) * (1 - Math.exp(-dt * 2));

    // --- holding hands, then chat & dance groups ---
    this.updateHands(active);
    this.updateGroups(active, t);
    this.updateBubbles(t);
    this.updateMarkers(dt, t);
    this.updateSocial(dt, t, active);

    // --- avatars ---
    this.filterActive = false;
    for (const tr of this.tracked.values()) this.updateAvatar(tr, dt, t);

    this.updateFx(dt, t);
    this.updateFireworks(dt);
    this.updateHardware(dt, t, env);
    if (this.sensorView) this.updateSensorViz();

    // --- overlay ---
    this.overlayTimer -= dt;
    if (this.toast && t > this.toast.until) { this.toast = null; this.overlayDirty = true; }
    if (this.overlayDirty && this.overlayTimer <= 0) { this.drawOverlay(); this.overlayDirty = false; this.overlayTimer = 0.2; }
    this.meterTimer -= dt;
    if (this.meterDirty && this.meterTimer <= 0) {
      const mc = this.meterCanvas, mctx = mc.getContext('2d');
      mctx.clearRect(0, 0, mc.width, mc.height);
      this.drawSocialMeter(mctx, mc.width, mc.height);
      this.meterTex.needsUpdate = true;
      this.meterDirty = false;
      this.meterTimer = 0.1;
    }

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
    // name tag: who you have become – a dark, almost opaque card with a gold frame so it reads well
    const c = makeCanvas(768, 168), ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(14,11,7,0.93)';
    ctx.beginPath(); ctx.roundRect(6, 6, 756, 156, 22); ctx.fill();
    ctx.strokeStyle = '#f1c453'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.roundRect(14, 14, 740, 140, 16); ctx.stroke();
    ctx.fillStyle = '#ffd66b'; ctx.font = 'bold 60px Georgia, serif'; ctx.textAlign = 'center';
    ctx.fillText(style.name, 384, 80);
    ctx.fillStyle = '#f7ecd2'; ctx.font = 'italic 34px Georgia, serif';
    ctx.fillText(`${style.en} · ${style.era}`, 384, 128);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: toTexture(c, { wrap: false }), transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
    tag.renderOrder = 11;
    tag.scale.set(2.3, 0.5, 1);
    this.archive.add(tag);
    const filterIcon = makeFilterIcon();
    filterIcon.visible = false;
    this.archive.add(filterIcon);
    this.emit('sparkle', stage.clone().add(_v.set(0, 1.0, 0)), 14, 1.0, 1.2);
    this.onEvent(`${p.name} detected → becomes "${style.name}" – ${style.en}`, 'track');
    // a colour of their own (preferably the same one every time), shown as a ring on the screen and at their feet
    const usedCols = new Set([...this.tracked.values()].filter((o) => !o.leaving).map((o) => o.color));
    let ci = hashStr(p.id) % PLAYER_COLORS.length;
    for (let k = 0; k < PLAYER_COLORS.length && usedCols.has(PLAYER_COLORS[ci]); k++) ci = (ci + 1) % PLAYER_COLORS.length;
    const color = PLAYER_COLORS[ci];
    this.glowRingTex ??= glowRingTexture(['#ffffff']);
    const ring = glowRing(1.45, this.glowRingTex, color, false); // glowing, under the avatar on the screen
    ring.position.copy(stage).setY(0.03);
    this.archive.add(ring);
    return {
      id: p.id, person: p, style, rig, born: this.time, lastSeen: this.time, leaving: false,
      stage, yaw: 0, tag, filterIcon, filterT: 0, filtered: false, filterLogged: false, group: null, seat: null,
      color, ring, mode: 'mirror', modeT: this.time,
    };
  }

  stagePos(p) {
    const l = toScreenLocal(p.pos, _v3);
    const x = clamp(l.z, -9, 9) * 0.62;
    const d = clamp(-l.x, 0.5, 12);
    const z = 1.7 - (d - 0.5) * 0.5; // far enough back that feet, colour rings and the dance circle are in frame
    return new THREE.Vector3(x, 0, z);
  }

  /** Is someone sitting on one of the stage benches? Works for local, remote and puppet people alike. */
  seatAt(pos) {
    for (const s of this.seats) if (Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z) < 0.35) return s;
    return null;
  }

  /**
   * Holding hands (feedback v5): two people hold hands when both hold out a hand (X) and stand within
   * arm's reach; each has two hands, so three or more can make a chain. Nearest pairs link first,
   * and no rings. Results: tr.hands (neighbours), tr.handGroupSize, this.handChains (ordered chains),
   * and person.handSides – which arm each person reaches out on the square.
   */
  updateHands(active) {
    const want = active.filter((tr) => !tr.seat && !tr.leaving && tr.person.wantsHands);
    for (const tr of this.tracked.values()) { tr.hands = []; tr.handGroupSize = 0; tr.person.handSides = []; }
    const parent = new Map(want.map((tr) => [tr, tr]));
    const find = (x) => (parent.get(x) === x ? x : find(parent.get(x)));
    const pairs = [];
    for (let i = 0; i < want.length; i++) for (let j = i + 1; j < want.length; j++) {
      const a = want[i], b = want[j];
      const d = Math.hypot(a.person.pos.x - b.person.pos.x, a.person.pos.z - b.person.pos.z);
      if (d <= HAND_REACH) pairs.push({ a, b, d, key: a.id < b.id ? a.id + b.id : b.id + a.id });
    }
    pairs.sort((x, y) => x.d - y.d || (x.key < y.key ? -1 : 1)); // same result on every client
    for (const { a, b } of pairs) {
      if (a.hands.length >= 2 || b.hands.length >= 2 || find(a) === find(b)) continue;
      a.hands.push(b); b.hands.push(a);
      parent.set(find(a), find(b));
    }
    // ordered chains, walked from one end
    const seen = new Set();
    this.handChains = [];
    for (const tr of want) {
      if (seen.has(tr) || tr.hands.length !== 1) continue;
      const chain = [tr];
      seen.add(tr);
      let prev = null, cur = tr;
      for (;;) {
        const next = cur.hands.find((h) => h !== prev);
        if (!next || seen.has(next)) break;
        chain.push(next); seen.add(next);
        prev = cur; cur = next;
      }
      for (const m of chain) m.handGroupSize = chain.length;
      this.handChains.push(chain);
    }
    // which arm each person reaches out with on the square (their own client poses it)
    for (const tr of want) {
      const p = tr.person, h = p.heading;
      tr.person.handSides = tr.hands.map((o) => ((o.person.pos.x - p.pos.x) * Math.cos(h) - (o.person.pos.z - p.pos.z) * Math.sin(h) > 0 ? 'L' : 'R'));
    }
  }

  /**
   * Interaction rules (feedback v4):
   *   anywhere on the stage: 2 people close together (or on the same bench) → their avatars chat,
   *                          3 or more close together → they dance
   *   the 2-footprint talk spot is locked: two people standing on it chat, even if someone else
   *                          comes close – a third person never turns it into a dance
   *   the 3-footprint dance spot: a dance starts when all three footprints are taken
   *   a chat or dance plays out for at least GROUP_MIN seconds, and people must stay together for
   *   GROUP_FORM seconds before a new one starts, so the avatars never flicker between interactions
   */
  updateGroups(active, t) {
    const PROX = 1.6;
    // --- who stands on which painted footprint (nearest person within SPOT_R, one spot each) ---
    for (const sp of this.footSpots) sp.occupant = null;
    const standing = active.filter((tr) => !tr.seat);
    const pairs = [];
    for (const sp of this.footSpots) {
      for (const tr of standing) {
        const l = toScreenLocal(tr.person.pos, _v);
        const d = Math.hypot(l.x - sp.x, l.z - sp.z);
        if (d < SPOT_R) pairs.push({ sp, tr, d });
      }
    }
    pairs.sort((x, y) => x.d - y.d);
    const onSpot = new Set();
    for (const { sp, tr } of pairs) if (!sp.occupant && !onSpot.has(tr)) { sp.occupant = tr; onSpot.add(tr); }
    const spotMembers = (kind) => this.footSpots.filter((sp) => sp.kind === kind).map((sp) => sp.occupant);

    const groups = []; // { type, members, spot, chain }
    const taken = new Set();
    // holding hands comes first: a pair holds hands (and a flower grows), 3+ in a chain dance a set dance
    for (const chain of this.handChains) {
      groups.push({ type: chain.length >= 3 ? 'handdance' : 'hands', members: [...chain], chain });
      chain.forEach((m) => taken.add(m));
    }
    const talkSpot = spotMembers('talk');
    if (talkSpot.every((m) => m && !taken.has(m))) { groups.push({ type: 'talk', members: talkSpot, spot: 'talk' }); talkSpot.forEach((m) => taken.add(m)); }
    const danceSpot = spotMembers('dance');
    if (danceSpot.every((m) => m && !taken.has(m))) { groups.push({ type: 'dance', members: danceSpot, spot: 'dance' }); danceSpot.forEach((m) => taken.add(m)); }

    // --- a chat/dance that has just started plays out, as long as its members are still here ---
    const activeSet = new Set(active);
    for (const g of this.groups.values()) {
      if (g.spot || g.chain || t - g.t0 >= GROUP_MIN) continue; // letting go of a hand ends it at once
      if (!g.members.every((m) => activeSet.has(m) && !taken.has(m))) continue;
      groups.push({ type: g.type, members: g.members });
      g.members.forEach((m) => taken.add(m));
    }

    // --- everyone else: closeness anywhere on the stage ---
    const free = active.filter((tr) => !taken.has(tr));
    const parent = free.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
      const a = free[i], b = free[j];
      const together = a.seat || b.seat
        ? !!(a.seat && b.seat && a.seat.bench === b.seat.bench)
        : Math.hypot(a.person.pos.x - b.person.pos.x, a.person.pos.z - b.person.pos.z) <= PROX;
      if (together) parent[find(i)] = find(j);
    }
    const comps = new Map();
    free.forEach((tr, i) => {
      const r = find(i);
      if (!comps.has(r)) comps.set(r, []);
      comps.get(r).push(tr);
    });
    const seenCandidates = new Map();
    for (const members of comps.values()) {
      if (members.length < 2) continue;
      const type = members.length >= 3 ? 'dance' : 'talk';
      const key = `${type}:${members.map((m) => m.id).sort().join('|')}`;
      const since = this.candidates.get(key) ?? t;
      seenCandidates.set(key, since);
      const known = this.groups.get(members.map((m) => m.id).sort().join('|'));
      // new groups only after people have stayed together a moment (existing ones continue directly)
      if ((known && known.type === type) || t - since >= GROUP_FORM) groups.push({ type, members });
    }
    this.candidates = seenCandidates;

    // --- keep group objects (and their bubbles, turn order, start time) when nothing changed ---
    const next = new Map();
    for (const { type, members, spot, chain } of groups) {
      members.sort((a, b) => (a.id < b.id ? -1 : 1)); // same order on every client
      const key = members.map((m) => m.id).join('|');
      const old = this.groups.get(key);
      const g = old && old.type === type ? old : { key, type, t0: t, turn: -1, nextTurn: t + 0.4, factIdx: hashStr(key) % FACTS.length };
      g.members = members;
      g.spot = spot ?? null;
      g.chain = chain ?? null;
      next.set(key, g);
      if (g !== old) {
        const names = members.map((m) => m.style.name).join(', ');
        if (type === 'talk') {
          this.onEvent(`Chat${spot ? ' (talk spot)' : ''}: ${names}`, 'duo');
        } else {
          this.onEvent(`Dance${spot ? ' (dance spot)' : ''}: ${names}`, 'duo');
        }
      }
    }
    for (const [key, g] of this.groups) {
      // the same people can switch from one kind of group to another (chat → holding hands …):
      // then the key is reused by a new group object, and the old one must still be cleaned up
      if (next.get(key) === g) continue;
      if (g.bubble) this.retireBubble(g.bubble);
      if (g.circle) { g.circle.material.map.dispose(); g.circle.geometry.dispose(); g.circle.material.dispose(); g.circle.removeFromParent(); }
      for (const f of g.flowers?.values() ?? []) f.removeFromParent();
    }
    for (const tr of this.tracked.values()) tr.group = null;
    for (const g of next.values()) for (const m of g.members) m.group = g;
    this.groups = next;
    this.talkGroups = [...next.values()].filter((g) => g.type === 'talk').length;
    const talking = this.talkGroups > 0;
    if (talking !== this.talking) this.overlayDirty = true;
    this.talking = talking;
    this.dancing = [...next.values()].some((g) => g.type === 'dance' || g.type === 'handdance');
  }

  /** A hand chain in screen order, left to right (so nobody's avatar has to cross over). */
  chainOrder(g) {
    const c = g.chain;
    return c[0].stage.x <= c[c.length - 1].stage.x ? c : [...c].reverse();
  }

  /** Light the footprints and benches in the colour of whoever uses them; colour circle around dancers. */
  updateMarkers(dt, t) {
    for (const sp of this.footSpots) {
      const m = sp.mesh.material;
      if (sp.occupant) { m.color.set(sp.occupant.color); sp.lastColor = sp.occupant.color; }
      m.opacity = clamp(m.opacity + (sp.occupant ? dt * 3 : -dt * 2), 0, 0.95);
      sp.mesh.visible = m.opacity > 0.01;
    }
    for (const seat of this.seats) {
      const tr = [...this.tracked.values()].find((o) => o.seat === seat && !o.leaving);
      // fade in when someone sits down, out when they get up
      seat.lit = (seat.lit ?? 0) + ((tr ? 1 : 0) - (seat.lit ?? 0)) * (1 - Math.exp(-dt * 5));
      if (tr) seat.litColor = tr.color;
      seat.pool.visible = seat.lit > 0.01;
      // the LED strips fade from dark to the sitter's colour (bright enough to bloom a little)
      seat.led.color.set(LED_OFF).lerp(_c.set(seat.litColor ?? LED_OFF).multiplyScalar(1.6), seat.lit);
      if (seat.litColor) seat.pool.material.color.set(seat.litColor).multiplyScalar(0.7 * seat.lit); // and a soft glow underneath
    }
    // flowers grow out of every pair of joined hands
    for (const g of this.groups.values()) {
      if (!g.chain) continue;
      g.flowers ??= new Map();
      const order = this.chainOrder(g);
      for (let i = 0; i < order.length - 1; i++) {
        const a = order[i], b = order[i + 1], key = a.id + '|' + b.id;
        let f = g.flowers.get(key);
        if (!f) {
          f = makeFlower(a.color);
          f.userData.t0 = t;
          f.scale.setScalar(0.001);
          this.archive.add(f);
          g.flowers.set(key, f);
        }
        const sc = ((a.rig.style.scale ?? 1) + (b.rig.style.scale ?? 1)) / 2;
        // a big flower that dances: it sways and bounces on the beat, and its bloom spins
        const beat = (t - f.userData.t0) * 2.2;
        const bounce = Math.abs(Math.sin(Math.PI * beat));
        f.position.set((a.stage.x + b.stage.x) / 2, 0.8 * sc + 0.06 * bounce, (a.stage.z + b.stage.z) / 2 + 0.3);
        const grow = smooth(0.3, 2.0, t - f.userData.t0);
        f.scale.set(1, 1 - 0.1 * bounce, 1).multiplyScalar(Math.max(0.001, grow * 3.4 * (1 + 0.06 * bounce)));
        f.rotation.z = Math.sin(t * 2.6 + i) * 0.3;
        f.rotation.x = Math.sin(t * 1.9 + i) * 0.12;
        f.userData.head.rotation.y += dt * 2.2;
        if (grow > 0.9 && Math.floor(beat) !== Math.floor(beat - dt * 2.2)) {
          this.emit('sparkle', f.position.clone().add(_v.set(0, 1.22 * grow, 0)), 3, 0.6, 0.8); // at the bloom
        }
      }
    }

    // one shared glowing ring round everyone who chats or dances together, in all their colours
    for (const g of this.groups.values()) {
      const cols = g.members.map((m) => m.color).join(',');
      if (!g.circle || g.circleCols !== cols) {
        if (g.circle) { g.circle.material.map.dispose(); g.circle.geometry.dispose(); g.circle.material.dispose(); g.circle.removeFromParent(); }
        g.circle = glowRing(1, glowRingTexture(g.members.map((m) => m.color)), '#ffffff', false);
        g.circle.userData.groupRing = true;
        g.circleCols = cols;
        this.archive.add(g.circle);
      }
      const mid = _v.set(0, 0, 0);
      for (const m of g.members) mid.add(m.stage);
      mid.multiplyScalar(1 / g.members.length);
      let far = 0;
      for (const m of g.members) far = Math.max(far, Math.hypot(m.stage.x - mid.x, (m.stage.z - mid.z) / 0.6));
      const r = far + 0.75; // round everyone, with room for their feet
      g.circle.position.set(mid.x, 0.025, mid.z);
      g.circle.scale.set(r * 2.3, 1, r * 2.3 * 0.6);
      g.circle.rotation.y = (t - g.t0) * 0.6; // slowly turning round them
      g.circle.material.opacity = Math.min(1, (t - g.t0) / 0.8);
    }
  }

  /**
   * Social meter: how social the stage is right now (feedback v5).
   *   standing on the stage counts a little – all together at most SOCIAL.standCap of the bar
   *   doing things *with others* counts much more: chatting, dancing, holding hands, and two or more
   *     people doing the same gesture at the same time; the bigger the group, the more each counts
   *   a gesture on your own only nudges it
   * The bar follows that level (fills faster than it drains, and empties within seconds when nobody
   * is left). Full → fireworks for as long as it stays full.
   */
  updateSocial(dt, t, active) {
    let standing = 0, together = 0;
    // who is doing the same gesture as someone else right now?
    const byGesture = new Map();
    for (const tr of active) {
      const g = tr.person.gesture;
      if (g) byGesture.set(g, (byGesture.get(g) ?? 0) + 1);
    }
    for (const tr of active) {
      standing += SOCIAL.onStage;
      const size = tr.group?.members.length ?? 0;
      const bigger = 1 + SOCIAL.perExtra * Math.max(0, size - 2); // bigger groups count more per person
      if (tr.group?.type === 'talk') together += SOCIAL.talking * bigger;
      else if (tr.group?.type === 'dance') together += SOCIAL.dancing * bigger;
      if (tr.hands?.length) together += SOCIAL.hands * (1 + SOCIAL.perExtra * Math.max(0, tr.handGroupSize - 2));
      const g = tr.person.gesture;
      if (g && byGesture.get(g) >= 2) together += SOCIAL.synced * (1 + SOCIAL.perExtra * (byGesture.get(g) - 2));
      else if (g || tr.action) standing += SOCIAL.solo;
    }
    const score = Math.min(standing, SOCIAL.standCap * SOCIAL.full) + together;
    const target = Math.min(1, score / SOCIAL.full);
    const d = target - this.social;
    this.socialRising = d > 0.005;
    const drain = active.length ? SOCIAL.drain : SOCIAL.drainEmpty; // nobody left → empty within a few seconds
    this.social += Math.sign(d) * Math.min(Math.abs(d), (d > 0 ? SOCIAL.charge : drain) * dt);
    const full = this.social >= 0.999;
    if (full && !this.full) {
      this.onEvent('Social meter full → fireworks', 'level');
      for (let k = 0; k < 3; k++) this.launchFirework();
      this.fireworkCd = 1.1;
    }
    this.full = full;
    if (full && (this.fireworkCd -= dt) <= 0) { this.launchFirework(); this.fireworkCd = 0.7 + this.rand() * 0.8; }
    const shown = Math.round(this.social * 100) + this.count * 100000 + (full || this.socialRising ? 1000 * Math.round(t * 8) : 0); // keep redrawing while it rises (light band) or is full (pulse)
    if (shown !== this.socialShown) { this.socialShown = shown; this.meterDirty = true; }
  }


  /**
   * Fact bubbles over chatting avatars: the two take turns, a new fact every BUBBLE_TIME seconds.
   * A bubble fades in quickly and dims out slowly at the end of its turn (and when the chat ends).
   */
  updateBubbles(t) {
    for (const g of this.groups.values()) {
      if (g.type !== 'talk') continue;
      if (t >= g.nextTurn) {
        g.turn++;
        g.factIdx = (g.factIdx + (g.turn > 0 ? 1 : 0)) % FACTS.length;
        g.nextTurn = t + BUBBLE_TIME;
        if (g.bubble) this.retireBubble(g.bubble);
        g.bubble = factBubble(FACTS[g.factIdx]);
        this.archive.add(g.bubble);
      }
      const speaker = g.members[g.turn % g.members.length];
      if (!speaker) continue;
      const sc = speaker.rig.style.scale ?? 1;
      g.bubble.position.copy(speaker.stage).add(_v.set(-Math.sign(speaker.stage.x) * 0.5, 1.95 * sc, 0.3));
      const fadeIn = Math.min(1, (t - (g.nextTurn - BUBBLE_TIME)) / 0.4);
      const fadeOut = Math.min(1, (g.nextTurn - t) / BUBBLE_FADE);
      g.bubble.material.opacity = Math.min(fadeIn, 0.15 + 0.85 * fadeOut);
    }
    // retired bubbles keep dimming out where they were
    this.oldBubbles = this.oldBubbles.filter((b) => {
      b.material.opacity -= (1 / BUBBLE_FADE) * (t - b.userData.lastT);
      b.userData.lastT = t;
      if (b.material.opacity > 0.01) return true;
      b.material.map.dispose();
      b.removeFromParent();
      return false;
    });
  }

  retireBubble(b) {
    b.userData.lastT = this.time;
    this.oldBubbles.push(b);
  }

  updateAvatar(tr, dt, t) {
    const rig = tr.rig;
    const p = tr.person;
    const age = t - tr.born;
    // appear / disappear
    const s = tr.leaving ? Math.max(0.001, 1 - (t - tr.leaveT) / 0.5) : Math.min(1, age / 0.5);
    rig.root.scale.setScalar(Math.max(0.001, s));

    let target = this.stagePos(p);
    let yawTarget = Math.PI / 2 - (p.heading - LAYOUT.screen.rot);
    const g = tr.group;
    const idx = g ? g.members.indexOf(tr) : 0;
    if (g) {
      const mid = new THREE.Vector3();
      for (const m of g.members) mid.add(this.stagePos(m.person));
      mid.multiplyScalar(1 / g.members.length);
      if (g.chain) {
        // holding hands: side by side in a line facing the audience, in chain order (left → right)
        const order = this.chainOrder(g);
        const i = order.indexOf(tr), n = order.length;
        let sway = 0;
        if (g.type === 'handdance') { const beat = (t - g.t0) / 0.5; sway = beat % 8 < 4 ? 0.18 * Math.sin((Math.PI * beat) / 2) : 0; }
        target = mid.add(_v.set((i - (n - 1) / 2) * 0.72 + sway, 0, 0));
        yawTarget = 0;
      } else if (g.type === 'talk') {
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

    // --- the avatar's own moves: a gesture starts a bigger action that always plays out in full ---
    const ges = p.gesture ?? null, gt = p.gestureT ?? 0;
    const restarted = ges && ges === tr.lastGesture && gt + 0.15 < (tr.lastGestureT ?? 0); // the same gesture again
    tr.lastGestureT = gt;
    if (ges !== tr.lastGesture || restarted) {
      tr.lastGesture = ges;
      const act = ges && AVATAR_FOR[ges];
      if (act && !tr.seat) {
        if (!tr.action) tr.action = { name: act, t0: t };
        else if (tr.action.name !== act) tr.nextAction = act; // one waits its turn
      }
    }
    if (tr.action && t - tr.action.t0 > AVATAR_ACTIONS[tr.action.name].dur) {
      tr.action = tr.nextAction ? { name: tr.nextAction, t0: t } : null;
      tr.nextAction = null;
    }
    if (tr.seat) { tr.action = null; tr.nextAction = null; }

    // --- sitting on a bench: the avatar rides a bicycle round and round until you stand up ---
    // two on the same bench share a tandem: the first (by id, same on every client) steers in front
    const mate = tr.seat ? [...this.tracked.values()].find((o) => o !== tr && !o.leaving && o.seat && o.seat.bench === tr.seat.bench) : null;
    const tandemBack = !!mate && mate.id < tr.id;
    if (tr.seat && !tandemBack) {
      const tandem = !!mate;
      if (tr.bike && !!tr.bike.userData.tandem !== tandem) { tr.bike.removeFromParent(); tr.bike = null; }
      if (!tr.bike) {
        tr.bike = makeBicycle(tr.color, tandem ? mate.color : null); // in the riders' colours
        rig.root.add(tr.bike);
      }
      tr.bikeHome ??= target.clone();
      tr.bikeA ??= 0;
      tr.pedal ??= 0;
      tr.bikeA += dt * 0.55;
      tr.pedal += dt * 6;
      const R = 1.5, Rz = 0.55;
      target = tr.bikeHome.clone().add(_v.set(Math.sin(tr.bikeA) * R, 0, (Math.cos(tr.bikeA) - 1) * Rz));
      yawTarget = Math.atan2(Math.cos(tr.bikeA) * R, -Math.sin(tr.bikeA) * Rz);
      for (const w of tr.bike.userData.wheels) w.rotation.x = tr.pedal * 1.6;
    } else if (tr.bike) {
      tr.bike.removeFromParent();
      tr.bike = null;
    }
    if (tandemBack) {
      // the second rider sits on the tandem's back saddle, 0.62 m behind the front rider, pedalling in step
      target = mate.stage.clone().addScaledVector(_v.set(Math.sin(mate.yaw), 0, Math.cos(mate.yaw)), -0.62);
      yawTarget = mate.yaw;
      tr.pedal = mate.pedal ?? 0;
    }
    if (!tr.seat) { tr.bikeHome = null; tr.bikeA = null; tr.pedal = null; }

    // a change of mode (mirroring → chat → dance → own move …) blends in over about a second instead of snapping
    const mode = tr.seat ? 'bike' : tr.action ? 'action' : g ? g.type : 'mirror';
    if (mode !== tr.mode) { tr.mode = mode; tr.modeT = t; }
    const blendIn = smooth(0, 1.2, t - tr.modeT);
    tr.stage.lerp(target, 1 - Math.exp(-dt * (tandemBack ? 14 : 2 + 4 * blendIn))); // the back rider sticks to the tandem
    rig.root.position.copy(tr.stage);
    tr.ring.position.set(tr.stage.x, 0.03, tr.stage.z);
    // in a chat, dance or hand-holding the shared ring takes over on the screen; each own ring fades out
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.4 + hashStr(tr.id));
    tr.ringLevel = (tr.ringLevel ?? 1) + ((g ? 0 : 1) - (tr.ringLevel ?? 1)) * (1 - Math.exp(-dt * 4));
    tr.ring.material.opacity = s * pulse * tr.ringLevel;
    let dy = yawTarget - tr.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    tr.yaw += dy * (1 - Math.exp(-dt * (tandemBack ? 14 : 3 + 5 * blendIn)));
    rig.root.rotation.y = tr.yaw;

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
    let move = null;
    if (tr.seat) {
      rig.resetTargets();
      animBike(rig, tr.pedal ?? 0);
    } else if (tr.action) {
      rig.resetTargets();
      animIdle(rig, t, idx);
      move = animAvatar(rig, tr.action.name, t - tr.action.t0);
    } else if (g && g.chain) {
      // facing the audience, the avatar's left hand (+x) holds the neighbour on the viewer's right
      rig.resetTargets();
      animIdle(rig, t, idx);
      const order = this.chainOrder(g), i = order.indexOf(tr);
      const joinL = i < order.length - 1, joinR = i > 0;
      if (g.type === 'handdance') animSetDance(rig, t - g.t0, joinL, joinR);
      else { if (joinL) animHoldHand(rig, 'L'); if (joinR) animHoldHand(rig, 'R'); }
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
    rig.update(dt, age < 0.05 ? 1000 : 4 + 18 * blendIn);
    this.applyMove(tr, move, dt);
    this.updateNudge(tr, dt, t, g);

    // name tag & filter icon
    const sc = rig.style.scale ?? 1;
    tr.tag.position.copy(tr.stage).add(_v.set(0, 2.4 * sc, 0.2));
    tr.tag.material.opacity = (g?.type === 'talk' || tr.nudge ? 0 : clamp(1 - (age - 8) / 1.5, 0, 1)) * s; // shown for 8 s after stepping in
    tr.tag.visible = tr.tag.material.opacity > 0.01;
    tr.filterIcon.visible = tr.filtered;
    tr.filterIcon.position.copy(tr.stage).add(_v.set(0.45, 1.75 * sc, 0.3));
  }

  /**
   * Whole-body motion of an avatar action: lift off the floor, flips (pitch around the hips),
   * banking, turning and flying round – smoothed so it starts and ends softly.
   */
  applyMove(tr, move, dt) {
    const rig = tr.rig;
    const m = tr.moveState ?? (tr.moveState = { lift: 0, pitch: 0, roll: 0, yaw: 0, side: 0, fwd: 0 });
    const k = 1 - Math.exp(-dt * 14);
    for (const key of ['lift', 'roll', 'yaw', 'side', 'fwd']) m[key] += ((move?.[key] ?? 0) - m[key]) * k;
    m.pitch = move ? move.pitch : m.pitch * (1 - k); // a flip must follow the curve exactly
    const sc = rig.style.scale ?? 1;
    // offset in the avatar's own frame (its yaw), lift straight up
    const cy = Math.cos(tr.yaw), sy = Math.sin(tr.yaw);
    rig.root.position.x += m.side * cy + m.fwd * sy;
    rig.root.position.z += -m.side * sy + m.fwd * cy;
    rig.root.position.y += m.lift;
    rig.root.rotation.y = tr.yaw + m.yaw;
    // pitch / roll around the hips
    const pivot = _v.set(0, 0.95 * sc, 0);
    rig.body.rotation.set(m.pitch, 0, m.roll);
    rig.body.position.copy(pivot).sub(_v2.copy(pivot).applyEuler(rig.body.rotation));
  }

  /**
   * Nudge: someone who stands still on the stage (no walking, no gestures) for a while gets a
   * thought bubble over their avatar suggesting something to try.
   */
  updateNudge(tr, dt, t, g) {
    const p = tr.person;
    // how much is the person moving? position + joint rotations, sampled twice a second
    tr.nudgeSample = (tr.nudgeSample ?? 0) - dt;
    if (tr.nudgeSample <= 0) {
      tr.nudgeSample = 0.5;
      let motion = 0;
      if (tr.lastPos) motion += tr.lastPos.distanceTo(p.pos) * 4;
      const q = JOINTS.map((n) => p.rig.joints[n].quaternion.clone());
      if (tr.lastQ) q.forEach((x, i) => { motion += x.angleTo(tr.lastQ[i]); });
      tr.lastPos = p.pos.clone();
      tr.lastQ = q;
      // not 'standing still' while chatting, dancing, cycling (on a bench) or doing its own move
      tr.still = motion < 0.25 && !p.gesture && !g && !tr.seat && !tr.action ? (tr.still ?? 0) + 0.5 : 0;
    }
    const want = tr.still >= NUDGE_AFTER && !tr.leaving;
    // one nudge on the screen at a time
    const busy = [...this.tracked.values()].some((o) => o !== tr && o.nudge);
    if (want && !tr.nudge && !busy && t > (tr.nudgeCooldown ?? 0)) {
      tr.nudgeIdx = ((tr.nudgeIdx ?? hashStr(tr.id)) + 1) % NUDGES.length;
      tr.nudge = factBubble(NUDGES[tr.nudgeIdx], { font: 'italic 600 52px Georgia, serif', lineH: 62, fill: '#eaf3ff', worldW: 3.4, thought: true });
      tr.nudge.material.opacity = 0;
      tr.nudgeT = t;
      this.archive.add(tr.nudge);
    }
    if (!tr.nudge) return;
    const showing = want && t - tr.nudgeT < 6;
    const o = tr.nudge.material.opacity + (showing ? dt / 0.4 : -dt / 1.2);
    tr.nudge.material.opacity = clamp(o, 0, 1);
    const sc = tr.rig.style.scale ?? 1;
    tr.nudge.position.copy(tr.stage).add(_v.set(0, 2.0 * sc, 0.3));
    if (!showing && tr.nudge.material.opacity <= 0) {
      tr.nudge.material.map.dispose();
      tr.nudge.removeFromParent();
      tr.nudge = null;
      tr.nudgeCooldown = t + 5;
      if (tr.still >= NUDGE_AFTER) tr.still = NUDGE_AFTER - 4; // still idle → the next suggestion comes a bit later
    }
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
      if (c.visible) c.lookAt((i - 1) * 3.5 + Math.sin(t * 0.21 + i * 2) * 2.2, 0, 1.0 + Math.cos(t * 0.16 + i) * 1.0); // slow pan, like the real ones
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
    this.archiveCam.lookAt(this.archiveCam.position.x * 0.5, 2.0, -1);
  }

  updateHardware(dt, t, env) {
    const e = this.energy;
    const night = env.night;
    // screen glow
    this.screenLight.intensity = (1.2 + e * 0.35) * (0.7 + night * 1.6) * this.fade;
    this.screenLight.color.setHSL(0.09 - Math.min(e, 3) * 0.01, 0.5 - Math.min(e, 3) * 0.12, 0.8);
    // sensor LEDs blink when tracking
    this.sensorLeds.forEach((led, i) => {
      const on = this.count > 0 ? Math.sin(t * 8 + i) > -0.2 : Math.sin(t * 1.5 + i) > 0.9;
      led.material.color.set(on ? (this.count > 0 ? '#ff2a2a' : '#661010') : '#200505');
    });
    // vintage spotlights on the stage when 3+ people stand on it
    const sp = this.spotLevel;
    const fest = e > 3.5;
    this.spots.forEach((s) => {
      if (sp > 0.01) {
        // each spot sweeps slowly around its own area of the stage floor
        s.target.set(s.aim.x + Math.sin(t * 0.23 + s.i * 1.7) * 1.1, 0, s.aim.z + Math.sin(t * 0.17 + s.i * 2.3) * 1.3);
        s.light.target.position.copy(s.target);
        const w = this.hw.localToWorld(_v.copy(s.target));
        s.beam.lookAt(w);
        s.beam.scale.z = s.base.distanceTo(s.target);
        s.head.lookAt(w);
        s.head.rotateX(Math.PI / 2);
      }
      const col = _c.set('#ffd9a0');
      s.light.color.copy(col);
      s.light.intensity = sp * (60 + night * 90);
      s.beam.visible = sp > 0.01;
      s.beam.material.uniforms.color.value.copy(col);
      s.beam.material.uniforms.intensity.value = sp * (0.06 + night * 0.3);
    });
    // guide strips in the paving: only lit when it is dark – off by day, faint at dusk, on at night
    this.guidePhase += dt * 0.3; // bands move ~1.2 m/s
    this.guideMat.uniforms.phase.value = this.guidePhase;
    const dark = smooth(0.25, 1, night);
    this.guideMat.uniforms.intensity.value = 0.9 * dark;
    this.guides.children.forEach((m) => { if (m.material === this.guideMat) m.visible = dark > 0.01; });
    // festoon lights
    const f = smooth(2.2, 3.0, e);
    const bright = 0.35 + f * (1.4 + night * 1.4);
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
    this.festoonLights.forEach((l) => { l.intensity = f * (4 + night * 11); });
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

  /**
   * The social meter: a tall column on the right edge of the wall, readable from the square.
   * Title, tick marks that say what fills it (chat halfway, dance to the top → fireworks), a big
   * percentage and how many are on the stage. A band of light runs up the bar while it rises,
   * and the whole bar glows when it is full.
   */
  drawSocialMeter(ctx, W, H) {
    // in the wall's own archive style (like the "GULDHEDSTORGET · 1944" label): a dark card with a
    // cream keyline, typewriter title – and yellow for everything that measures the social side
    const v = this.social, full = this.full, t = this.time;
    const YEL = '#f1c453', YEL_LIGHT = '#ffe08a', CREAM = '#f4e6c6', SEPIA = '#d8c8a4';
    const pw = 190, px = W - pw - 26, py = 30, ph = H - 60; // card
    const bw = 58, bx = px + pw - bw - 34, y0 = py + 92, y1 = py + ph - 82, bh = y1 - y0; // bar
    ctx.save();
    ctx.fillStyle = 'rgba(12,10,8,0.62)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = 'rgba(244,230,198,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 7, py + 7, pw - 14, ph - 14);
    // title
    ctx.textAlign = 'center';
    ctx.fillStyle = YEL;
    ctx.font = 'bold 30px "Courier New", Courier, monospace';
    ctx.fillText('TOGETHER', px + pw / 2, py + 50);
    ctx.fillStyle = SEPIA;
    ctx.font = 'italic 19px Georgia, serif';
    ctx.fillText('social meter', px + pw / 2, py + 74);
    // tube
    ctx.fillStyle = 'rgba(244,230,198,0.12)';
    ctx.fillRect(bx, y0, bw, bh);
    // fill: yellow only
    if (v > 0.002) {
      const fh = Math.max(4, bh * v);
      const grd = ctx.createLinearGradient(0, y1, 0, y1 - fh);
      grd.addColorStop(0, YEL); grd.addColorStop(1, YEL_LIGHT);
      ctx.fillStyle = grd;
      ctx.fillRect(bx, y1 - fh, bw, fh);
      if (this.socialRising || full) {
        // a band of light running up the filled part while it rises
        const yy = y1 - ((t * 0.9) % 1) * fh;
        const shine = ctx.createLinearGradient(0, yy + 36, 0, yy - 36);
        shine.addColorStop(0, 'rgba(255,255,255,0)'); shine.addColorStop(0.5, 'rgba(255,252,235,0.5)'); shine.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = shine;
        ctx.fillRect(bx, Math.max(y1 - fh, yy - 36), bw, 72);
      }
    }
    ctx.strokeStyle = full ? `rgba(255,224,138,${0.65 + 0.35 * Math.sin(t * 6)})` : 'rgba(244,230,198,0.7)';
    ctx.lineWidth = full ? 5 : 2.5;
    ctx.strokeRect(bx, y0, bw, bh);
    // small tick icons beside the bar (no words: visitors find out for themselves what fills it)
    for (const [f, icon] of [[1, 'burst'], [0.5, 'bubble'], [0.1, 'feet']]) {
      const y = y1 - bh * f;
      const reached = v >= f - 0.01;
      ctx.strokeStyle = reached ? YEL_LIGHT : 'rgba(244,230,198,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx - 12, y); ctx.lineTo(bx - 2, y); ctx.stroke();
      meterIcon(ctx, icon, bx - 32, y, reached ? YEL_LIGHT : 'rgba(244,230,198,0.6)');
    }
    // percentage + who is there
    ctx.fillStyle = full ? YEL_LIGHT : CREAM;
    ctx.font = 'bold 36px "Courier New", Courier, monospace';
    ctx.fillText(`${Math.round(v * 100)}%`, px + pw / 2, py + ph - 40);
    ctx.fillStyle = SEPIA;
    ctx.font = 'italic 18px Georgia, serif';
    ctx.fillText(this.count === 0 ? 'nobody here' : `${this.count} on the stage`, px + pw / 2, py + ph - 16);
    ctx.restore();
  }

  drawOverlayBody(ctx, W, H) {
    // attract text
    if (this.count === 0) {
      // a clear invitation to step up: a calm banner and chevrons that bob down towards the stage
      // (no canvas blur – this redraws a few times a second while the stage is empty)
      const cx = W / 2 - 110, t = this.time;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(12,10,8,0.58)';
      ctx.fillRect(cx - 640, H / 2 - 92, 1280, 170);
      ctx.strokeStyle = 'rgba(244,230,198,0.45)';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - 632, H / 2 - 84, 1264, 154);
      ctx.fillStyle = '#fff6e0';
      ctx.font = 'bold 76px Georgia, serif';
      ctx.fillText('Step onto the stage', cx, H / 2 - 4);
      ctx.font = 'italic 34px Georgia, serif';
      ctx.fillStyle = '#f1dcae';
      ctx.fillText('and become part of Guldhedstorget’s history', cx, H / 2 + 46);
      // chevrons below the banner, bobbing down one after the other
      ctx.strokeStyle = '#f1c453';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 3 - k * 0.7));
        const y = H / 2 + 104 + k * 26 + 6 * Math.sin(t * 3 - k * 0.7);
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.moveTo(cx - 34, y); ctx.lineTo(cx, y + 20); ctx.lineTo(cx + 34, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
      ctx.textAlign = 'left';
      this.overlayDirty = true; // keep the chevrons moving (the overlay redraws at most 5× a second)
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
      theme: this.theme,
      muted: this.muted,
      playerAvatar: player ? player.style : null,
      filterActive: this.filterActive,
      groups: [...this.groups.values()].map((g) => ({ type: g.type, members: g.members.map((m) => m.person.name) })),
    };
  }
}

const _c = new THREE.Color();
const LED_OFF = '#2a2d31'; // an unlit LED strip on a bench
/** Every person on the stage gets one of these colours (ring under the avatar on the screen, lit benches and footprints). */
const PLAYER_COLORS = ['#ff5a5f', '#ffb400', '#2ec4b6', '#5b8cff', '#c86bfa', '#7bd389', '#ff8c42', '#f15bb5'];
const HAND_REACH = 1.2; // metres between two people who can hold hands (about an arm's length each)
const SPOT_R = 0.45; // standing within this distance of a painted footprint pair = standing on it
const GROUP_MIN = 4; // a chat or dance plays out at least this long before the avatars do something else
const GROUP_FORM = 0.6; // people must stay together this long before their avatars start a chat/dance
// Social meter: charge per second and person, depending on what they do together
// Social meter, points per person (full = SOCIAL.full points, e.g. three people dancing):
const SOCIAL = {
  onStage: 0.6, solo: 0.4, standCap: 0.25, // being there / a gesture on your own – together at most 25 % of the bar
  talking: 2.6, dancing: 4.4, hands: 3.0, synced: 2.0, perExtra: 0.15, // doing things with others; +15 % per extra person in the group
  full: 13.5, charge: 0.12, drain: 0.05, drainEmpty: 0.35,
};
const BUBBLE_TIME = 10; // seconds each fact stays up
const NUDGE_AFTER = 6; // seconds standing still before the avatar wonders what to try
const NUDGES = [
  'What will happen if I jump?',
  'What will happen when I clap?',
  'What if I wave?',
  'What if I dance?',
  'What happens if I take a bow?',
  'What if someone stands next to me?',
];
const BUBBLE_FADE = 2.5; // seconds it takes to dim out

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

/**
 * Small icons for the social meter, drawn as shapes (colour emoji in a canvas cost ~2 ms per redraw):
 * 'feet' = two footprints, 'bubble' = speech bubble, 'burst' = firework.
 */
function meterIcon(ctx, kind, x, y, color) {
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  if (kind === 'feet') {
    for (const [dx, dy] of [[-6, 3], [6, -3]]) {
      ctx.beginPath(); ctx.ellipse(x + dx, y + dy - 3, 4.5, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + dx, y + dy + 7, 3, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    }
  } else if (kind === 'bubble') {
    ctx.beginPath(); ctx.roundRect(x - 13, y - 11, 26, 18, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 6, y + 6); ctx.lineTo(x - 10, y + 13); ctx.lineTo(x, y + 6); ctx.fill();
  } else {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4); ctx.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
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

/**
 * Ring textures on the floor: for one person a glowing ring (white, tinted per person through the
 * material colour); for a group a shared ring with one clear section in each person's colour.
 */
function glowRingTexture(colors) {
  const S = 256, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const n = colors.length;
  if (n === 1) {
    // one person: a soft halo, a glow and a bright core (tinted per person by the material colour)
    ctx.strokeStyle = ctx.shadowColor = colors[0];
    for (const [w, blur, alpha] of [[30, 26, 0.35], [14, 14, 0.8], [5, 4, 1]]) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = w;
      ctx.shadowBlur = blur;
      ctx.beginPath(); ctx.arc(S / 2, S / 2, 98, 0, Math.PI * 2); ctx.stroke();
    }
  } else {
    // a shared ring: one clear, solid section per person in their own colour (pink half + yellow half)
    colors.forEach((col, i) => {
      const a0 = (i / n) * Math.PI * 2 + 0.04, a1 = ((i + 1) / n) * Math.PI * 2 - 0.04;
      ctx.strokeStyle = ctx.shadowColor = col;
      ctx.globalAlpha = 0.45; ctx.lineWidth = 38; ctx.shadowBlur = 10; // a little glow, in the same colour only
      ctx.beginPath(); ctx.arc(S / 2, S / 2, 98, a0, a1); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 22; ctx.shadowBlur = 0; // thick enough to read from the low screen camera
      ctx.beginPath(); ctx.arc(S / 2, S / 2, 98, a0, a1); ctx.stroke();
    });
  }
  ctx.globalAlpha = 1;
  return toTexture(c, { wrap: false });
}

/**
 * A glowing ring lying flat on the ground. On the square it adds light to the dark wooden floor;
 * on the screen's pale 1940s paving added light would wash out, so there it is painted on (opaque).
 */
function glowRing(size, map, color = '#ffffff', additive = true) {
  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map, color, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
  }));
  m.renderOrder = 4;
  return m;
}

/** A historical-fact speech bubble for the LED wall (also used, smaller and blue, for nudges). */
function factBubble(text, { font = '600 48px Georgia, serif', lineH = 58, fill = '#fffaf0', worldW = 3.3, thought = false } = {}) {
  const W = 900, pad = 34;
  const ctx0 = makeCanvas(8, 8).getContext('2d');
  ctx0.font = font;
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
  ctx.fillStyle = fill;
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
  ctx.font = font;
  ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, pad + 42 + i * lineH));
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: toTexture(c, { wrap: false }), transparent: true, depthWrite: false, depthTest: false }));
  sp.scale.set(worldW, worldW * (H / W), 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 10;
  return sp;
}

/**
 * A 1940s car built from side profiles (extruded, with rounded edges) – a fastback saloon like the
 * Volvo PV444 (optionally two-tone), a coupé with a long bonnet (1940 Ford), or a delivery van
 * (PV445 Duett) with a shop sign. Separate pontoon mudguards, running boards, whitewall tyres,
 * a chrome grille, bumpers and lamps. Faces +x; parked on y = 0.
 */
function vintageCar(color, { van = false, roof = null, coupe = false, sign = null } = {}) {
  const g = new THREE.Group();
  const paint = M(color, 0.32, 0.35), top = roof ? M(roof, 0.38, 0.2) : paint;
  // 'chrome' is mostly light grey: the 1944 scene has no reflection map, so a real metal would render black
  const chrome = M('#e4e4e2', 0.25, 0.35), glass = M('#2a3640', 0.1, 0.4), tyre = M('#121212', 0.75), white = M('#f2efe8', 0.6);
  const W = 1.5; // body width
  const extrude = (pts, width, mat, z = 0, bevel = 0.07) => {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.length === 4) shape.quadraticCurveTo(p[0], p[1], p[2], p[3]); else shape.lineTo(p[0], p[1]);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 14 });
    geo.translate(0, 0, -(width - bevel * 2) / 2 + z);
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
    return m;
  };
  // lower body: tail, waist line, bonnet, rounded nose
  const front = coupe ? 2.2 : 2.1;
  extrude(van ? [
    [-2.0, 0.42], [-2.05, 0.95], [-0.25, 0.98], [1.55, 0.95], [front, 0.88, front, 0.62], [front - 0.05, 0.42],
  ] : [
    [-2.0, 0.42], [-2.12, 0.62, -1.98, 0.86], [coupe ? -1.0 : -1.25, 1.0], [1.55, 0.97], [front, 0.92, front, 0.62], [front - 0.05, 0.42],
  ], W, paint);
  if (van) {
    // the tall load box behind the cab, with a rounded roof, and the shop's name on its side
    extrude([[-2.05, 0.95], [-2.05, 1.62, -1.8, 1.78], [-0.25, 1.78], [-0.25, 0.95]], W + 0.02, paint, 0, 0.09);
    extrude([[-0.3, 0.97], [-0.25, 1.62], [0.15, 1.62], [0.7, 0.97]], W - 0.12, glass, 0, 0.04); // cab window
    extrude([[-0.27, 1.58], [-0.25, 1.68], [0.18, 1.68], [0.2, 1.58]], W - 0.08, paint, 0, 0.03); // cab roof
    if (sign) {
      for (const sz of [1, -1]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), new THREE.MeshStandardMaterial({ map: signTexture(sign, { bg: '#f1ead8', fg: '#7a1f2b', font: 'italic bold 60px Georgia, serif' }), roughness: 0.6 }));
        p.position.set(-1.15, 1.3, sz * (W / 2 + 0.012));
        p.rotation.y = sz > 0 ? 0 : Math.PI;
        g.add(p);
      }
    }
  } else {
    // the cabin in the roof colour, with side windows set into it, a windscreen and a rear window
    const [r0, r1, f1, f0] = coupe ? [-0.95, -0.45, 0.1, 0.62] : [-1.25, -0.6, 0.3, 0.82];
    extrude([[r0, 0.97], [r1 - 0.05, 1.5, r1 + 0.1, 1.54], [f1, 1.54], [f0, 0.97]], W - 0.2, top, 0, 0.06);
    extrude([[r0 + 0.2, 1.0], [r1 + 0.08, 1.44], [f1 - 0.05, 1.45], [f0 - 0.18, 1.0]], W - 0.12, glass, 0, 0.02); // pokes out on both sides
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.46, W - 0.1), top);
    pillar.position.set((r1 + f1) / 2 - 0.05, 1.22, 0);
    g.add(pillar);
    for (const [ax, ay, bx, by] of [[f1, 1.52, f0, 0.98], [r0, 0.98, r1, 1.5]]) {
      const len = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(len * 0.82, 0.02, W - 0.42), glass);
      pane.position.set((ax + bx) / 2 + Math.sin(ang) * -0.035, (ay + by) / 2 + Math.cos(ang) * 0.035, 0);
      pane.rotation.z = ang;
      g.add(pane);
    }
  }
  // grille, bumpers with overriders, lamps
  for (let k = -3; k <= 3; k++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.34, 0.025), chrome);
    bar.position.set(front + 0.01, 0.66, k * 0.05);
    g.add(bar);
  }
  for (const [bx, len] of [[front + 0.12, 1.72], [-2.12, 1.66]]) {
    const bumper = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, len, 4, 8), chrome);
    bumper.rotation.x = Math.PI / 2;
    bumper.position.set(bx, 0.42, 0);
    g.add(bumper);
  }
  for (const z of [-0.6, 0.6]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshBasicMaterial({ color: '#fff3d0' }));
    lamp.position.set(front - 0.25, 0.86, z * 1.08);
    lamp.scale.set(0.7, 1, 1);
    g.add(lamp);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 6, 14), chrome);
    ring.position.copy(lamp.position).add(new THREE.Vector3(0.03, 0, 0));
    ring.rotation.y = Math.PI / 2;
    g.add(ring);
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: '#9a1a1a' }));
    tail.position.set(-2.06, 0.78, z);
    g.add(tail);
  }
  // wheels with whitewalls and hub caps, under rounded pontoon mudguards, and running boards
  g.userData.wheels = [];
  const mudguard = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2); // a dome, scaled into a mudguard
  for (const wx of [-1.25, 1.3]) for (const wz of [-0.72, 0.72]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 18), tyre);
    w.rotation.x = Math.PI / 2; w.position.set(wx, 0.33, wz); g.add(w);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.232, 18), white);
    wall.rotation.x = Math.PI / 2; wall.position.set(wx, 0.33, wz); g.add(wall);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), chrome);
    hub.scale.set(1, 1, 0.5); hub.position.set(wx, 0.33, wz * 1.17); g.add(hub);
    const guard = new THREE.Mesh(mudguard, paint);
    guard.scale.set(0.62, 0.52, 0.2);
    guard.position.set(wx + (wx > 0 ? 0.05 : -0.05), 0.42, wz * 1.08);
    g.add(guard);
    g.userData.wheels.push(w, wall, hub);
  }
  for (const wz of [-0.84, 0.84]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.04, 0.2), M('#1c1c1c', 0.6));
    board.position.set(0.02, 0.36, wz);
    g.add(board);
  }
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
