import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Rig, HISTORICAL, animIdle, animWalk, animTalk, animGesture, BONES, JOINTS, M } from './character.js';
import { FACTS } from './facts.js';
import { LAYOUT, STAGE, toScreenLocal, screenToWorld, onStage, hipRoof } from './world.js';
import { hashStr } from './net.js';
import { staticBatch } from './batch.js';
import {
  rng, makeCanvas, toTexture, gradientSkyTexture, signTexture, sparkleTexture,
  heartTexture, stageFloorTexture, backPanelTexture,
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
    // pale concrete slabs
    const c = makeCanvas(256, 256), ctx = c.getContext('2d');
    ctx.fillStyle = '#c4bdac'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#968e7e'; ctx.lineWidth = 3;
    for (let i = 0; i <= 256; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke(); }
    g.add(this.stageGround('#ffffff', toTexture(c), 3));
    // the street the cars use, with a kerb on each side
    add(new THREE.BoxGeometry(80, 0.02, 2.8), M('#6d6c68', 0.95), 0, 0.012, -11.75, false);
    add(new THREE.BoxGeometry(80, 0.1, 0.25), M('#9b968c', 0.9), 0, 0.05, -10.25, false);
    add(new THREE.BoxGeometry(80, 0.1, 0.25), M('#9b968c', 0.9), 0, 0.05, -13.25, false);

    // lawn with green slatted benches and white flower boxes (front left in the photo)
    add(new THREE.BoxGeometry(17, 0.1, 4.6), M('#5e8f3a', 1), -10.5, 0.05, -7.3, false);
    const benchGreen = M('#2d5a39', 0.7), white = M('#f3efe4', 0.8);
    const flowerCols = ['#d2384a', '#e9677a', '#f2c14e', '#c43b6b'];
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
        const seat = new THREE.Object3D();
        seat.position.set(sx, 0, -0.02);
        g.add(seat);
        const front = new THREE.Object3D();
        front.position.set(sx, 0, 0.85);
        g.add(front);
        this.seatAnchors.push({ seat, front, group: g, bench: benchIndex });
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
      return { pos, front, heading, occupant: null, bench: a.bench };
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
      this.spots.push({ light, beam, head, base, i });
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
      [new THREE.Vector3(-3, 0.03, -18.5), new THREE.Vector3(-9.5, 0.03, -9), new THREE.Vector3(-10.8, 0.03, 0), W(STAGE.x0 - 1.5, -6.5), W(STAGE.x0 - 0.3, -5.6)], // from behind the screen
    ];
    this.guideMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { phase: { value: 0 }, intensity: { value: 1 }, color: { value: new THREE.Color('#ffc95a') } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float phase, intensity;
        uniform vec3 color;
        varying vec2 vUv;
        void main() {
          float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
          float pulse = smoothstep(0.72, 1.0, fract(vUv.x * 0.14 - phase));
          float a = (0.3 + 1.8 * pulse) * smoothstep(0.0, 0.7, across) * intensity;
          gl_FragColor = vec4(color * a, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const housing = M('#1a1c1f', 0.4, 0.5);
    this.guides = new THREE.Group();
    for (const pts of paths) {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const len = curve.getLength();
      const n = Math.max(2, Math.round(len / 0.2));
      const sampled = curve.getSpacedPoints(n);
      for (const [w, mat, y] of [[0.2, housing, 0.022], [0.09, this.guideMat, 0.028]]) {
        const pos = [], uv = [], idx = [];
        let dist = 0;
        sampled.forEach((p, i) => {
          if (i > 0) dist += p.distanceTo(sampled[i - 1]);
          const nxt = sampled[Math.min(i + 1, n)], prv = sampled[Math.max(i - 1, 0)];
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
    this.spotLevel += ((this.dancing ? 1 : 0) - this.spotLevel) * (1 - Math.exp(-dt * 2));

    // --- chat & dance groups ---
    this.updateGroups(active, t);
    this.updateBubbles(t);

    // --- avatars ---
    this.filterActive = false;
    for (const tr of this.tracked.values()) this.updateAvatar(tr, dt, t);

    this.updateExtras(dt, t);
    this.updateFx(dt, t);
    this.updateHardware(dt, t, env);
    if (this.sensorView) this.updateSensorViz();

    // --- overlay ---
    this.overlayTimer -= dt;
    if (this.toast && t > this.toast.until) { this.toast = null; this.overlayDirty = true; }
    if (this.overlayDirty && this.overlayTimer <= 0) { this.drawOverlay(); this.overlayDirty = false; this.overlayTimer = 0.2; }

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
    this.emit('sparkle', stage.clone().add(_v.set(0, 1.0, 0)), 14, 1.0, 1.2);
    this.onEvent(`${p.name} detected → becomes "${style.name}" – ${style.en}`, 'track');
    return {
      id: p.id, person: p, style, rig, born: this.time, lastSeen: this.time, leaving: false,
      stage, yaw: 0, tag, filterIcon, filterT: 0, filtered: false, filterLogged: false, group: null, seat: null,
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
   * Interaction rules (feedback v2):
   *   two people close together (or on the same bench) → their avatars chat, with fact bubbles
   *   three or more close together                    → their avatars dance together
   * Groups are connected components of "close to each other"; they last as long as people stay close.
   */
  updateGroups(active, t) {
    const PROX = 1.6;
    const parent = active.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const together = a.seat || b.seat
        ? !!(a.seat && b.seat && a.seat.bench === b.seat.bench)
        : Math.hypot(a.person.pos.x - b.person.pos.x, a.person.pos.z - b.person.pos.z) <= PROX;
      if (together) parent[find(i)] = find(j);
    }
    const comps = new Map();
    active.forEach((tr, i) => {
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
      next.set(key, g);
      if (g !== old) {
        const names = members.map((m) => m.style.name).join(', ');
        if (type === 'talk') {
          this.showToast('Neighbours chatting – listen to their stories!');
          this.onEvent(`Chat: ${names}`, 'duo');
        } else {
          this.showToast('Three or more together – time to dance!');
          this.onEvent(`Dance: ${names}`, 'duo');
        }
      }
    }
    for (const [key, g] of this.groups) if (!next.has(key) && g.bubble) { g.bubble.material.map.dispose(); g.bubble.removeFromParent(); }
    for (const tr of this.tracked.values()) tr.group = null;
    for (const g of next.values()) for (const m of g.members) m.group = g;
    this.groups = next;
    const talking = [...next.values()].some((g) => g.type === 'talk');
    if (talking !== this.talking) this.overlayDirty = true;
    this.talking = talking;
    this.dancing = [...next.values()].some((g) => g.type === 'dance');
  }

  /** Fact bubbles over chatting avatars: the two take turns, a new fact every few seconds. */
  updateBubbles(t) {
    for (const g of this.groups.values()) {
      if (g.type !== 'talk') continue;
      if (t >= g.nextTurn) {
        g.turn++;
        g.factIdx = (g.factIdx + (g.turn > 0 ? 1 : 0)) % FACTS.length;
        g.nextTurn = t + 6;
        if (g.bubble) { g.bubble.material.map.dispose(); g.bubble.removeFromParent(); }
        g.bubble = factBubble(FACTS[g.factIdx]);
        this.archive.add(g.bubble);
      }
      const speaker = g.members[g.turn % g.members.length];
      if (!speaker) continue;
      const sc = speaker.rig.style.scale ?? 1;
      g.bubble.position.copy(speaker.stage).add(_v.set(-Math.sign(speaker.stage.x) * 0.5, 1.95 * sc, 0.3));
      const fadeIn = Math.min(1, (t - (g.nextTurn - 6)) / 0.3);
      g.bubble.material.opacity = fadeIn;
    }
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
    } else if (tr.seat) {
      yawTarget = 0; // sitting on a bench → the avatar stands, facing out of the screen
    }
    tr.stage.lerp(target, 1 - Math.exp(-dt * 6));
    rig.root.position.copy(tr.stage);
    let dy = yawTarget - tr.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    tr.yaw += dy * (1 - Math.exp(-dt * 8));
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
    if (g && g.type === 'talk') {
      rig.resetTargets();
      animIdle(rig, t, idx);
      animTalk(rig, t, g.members[g.turn % g.members.length] === tr, idx * 1.7);
    } else if (g) {
      rig.resetTargets();
      animIdle(rig, t, idx);
      animGesture(rig, idx % 3 === 2 ? 'cheer' : 'dance', 0.5 + ((t - g.t0 + idx * 0.7) % 2.856)); // 2.856 s = two whole dance cycles, so the loop is seamless
    } else {
      rig.copyPoseFrom(p.rig, true);
      if (tr.seat) {
        // sitting on a bench: the avatar stands, but still mirrors arms, head and upper body
        for (const j of ['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']) rig.target[j].identity();
        rig.offsetTarget.set(0, 0, 0);
      }
      if (tr.filtered) {
        // mirrored: the person's right hand is the avatar's left
        const side = rightHand ? 'L' : 'R';
        rig.set('uArm' + side, 0.04, 0, side === 'L' ? 0.09 : -0.09);
        rig.set('fArm' + side, -0.15, 0, 0);
        rig.set('hand' + side, 0, 0, 0);
      }
    }
    rig.update(dt, age < 0.05 ? 1000 : 22);

    // name tag & filter icon
    const sc = rig.style.scale ?? 1;
    tr.tag.position.copy(tr.stage).add(_v.set(0, 2.25 * sc, 0.2));
    tr.tag.material.opacity = (g?.type === 'talk' ? 0 : clamp(1 - (age - 5) / 1.5, 0, 1)) * s;
    tr.tag.visible = tr.tag.material.opacity > 0.01;
    tr.filterIcon.visible = tr.filtered;
    tr.filterIcon.position.copy(tr.stage).add(_v.set(0.45, 1.75 * sc, 0.3));
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
    this.stageCones.forEach((c) => {
      c.visible = sc > 0.01;
      c.material.uniforms.intensity.value = sc * 0.35;
      c.material.uniforms.color.value.set('#ffe2b0'); // warm, vintage
    });
    // confetti while people dance
    const cf = this.spotLevel;
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
    // spotlights
    // vintage spotlights on the stage while people dance
    const sp = this.spotLevel;
    const fest = e > 3.5;
    this.spots.forEach((s) => {
      const col = _c.set('#ffd9a0');
      s.light.color.copy(col);
      s.light.intensity = sp * (60 + night * 140);
      s.beam.visible = sp > 0.01;
      s.beam.material.uniforms.color.value.copy(col);
      s.beam.material.uniforms.intensity.value = sp * (0.06 + night * 0.3);
    });
    // guide strips in the paving: faster pulses and warmer colour as the crowd grows
    this.guidePhase += dt * (0.45 + e * 0.12);
    this.guideMat.uniforms.phase.value = this.guidePhase;
    this.guideMat.uniforms.intensity.value = 1.8 + night * 1.2;
    this.guideMat.uniforms.color.value.set(e > 3.5 ? '#ff7ab0' : '#ffc95a');
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
    // level meter
    const x0 = W - 420;
    ctx.fillStyle = 'rgba(12,10,8,0.55)';
    ctx.fillRect(x0 - 20, 30, 400, 92);
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(x0 + 20 + (i - 1) * 40, 66, 13, 0, Math.PI * 2);
      ctx.fillStyle = i <= this.level ? ['#f1c453', '#f4a261', '#e76f51', '#ff4f7a'][i - 1] : 'rgba(255,255,255,0.18)';
      ctx.fill();
    }
    ctx.fillStyle = '#f4e6c6';
    ctx.font = 'bold 28px Helvetica, Arial';
    ctx.fillText(LEVELS[this.level].short.toUpperCase(), x0 + 180, 76);
    ctx.font = '22px Helvetica, Arial';
    ctx.fillStyle = '#d8c8a4';
    ctx.fillText(this.count === 0 ? 'nobody here right now' : `${this.count} ${this.count === 1 ? 'neighbour' : 'neighbours'} on the square`, x0, 108);
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
function factBubble(text) {
  const W = 900, pad = 34, lineH = 46;
  const ctx0 = makeCanvas(8, 8).getContext('2d');
  ctx0.font = '600 38px Georgia, serif';
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
  ctx.beginPath(); ctx.moveTo(W / 2 - 22, H - 33); ctx.lineTo(W / 2 - 4, H - 4); ctx.lineTo(W / 2 + 18, H - 33); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(W / 2 - 22, H - 31); ctx.lineTo(W / 2 - 4, H - 4); ctx.lineTo(W / 2 + 18, H - 31); ctx.stroke();
  ctx.fillStyle = '#2a1d10';
  ctx.font = '600 38px Georgia, serif';
  ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, pad + 34 + i * lineH));
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: toTexture(c, { wrap: false }), transparent: true, depthWrite: false, depthTest: false }));
  const worldW = 2.9;
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
