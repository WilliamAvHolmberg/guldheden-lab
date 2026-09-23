import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Rig, HISTORICAL, animIdle, animWalk, animDuo, animGesture, BONES, JOINTS, M } from './character.js';
import { LAYOUT, toScreenLocal, screenToWorld, inSensorZone } from './world.js';
import { hashStr } from './net.js';
import {
  rng, makeCanvas, toTexture, kidsDrawingTexture, gradientSkyTexture, signTexture, sparkleTexture,
  heartTexture, zoneDecalTexture, plaqueTexture, backPanelTexture,
} from './textures.js';

export const LEVELS = [
  { sv: 'Väntläge', en: 'Attract mode' },
  { sv: 'Solo', en: 'One visitor' },
  { sv: 'Duo', en: 'Two visitors' },
  { sv: 'Grupp', en: 'Group' },
  { sv: 'Fest', en: 'Festival' },
];

export const THEMES = {
  1944: { caption: 'GULDHEDSTORGET · 1944', sub: 'Ur arkivet', button: '1944', color: '#e0a040' },
  1958: { caption: 'GULDHEDEN · 1958', sub: 'Torget i sin glans', button: '1958', color: '#2ec4b6' },
  kids: { caption: 'BARNENS TORG', sub: 'Teckningar av klass 2B, Guldhedsskolan', button: 'BARNENS', color: '#ff5d8f' },
};
const THEME_ORDER = ['1944', '1958', 'kids'];

const DUO_TYPES = {
  swing: { sv: 'Swingdans', en: 'swing dance' },
  handshake: { sv: 'Handslag', en: 'handshake' },
  hattip: { sv: 'Hattlyft', en: 'hat tip' },
};

const SCREEN = LAYOUT.screen;
const SCREEN_W = SCREEN.z1 - SCREEN.z0;
const SCREEN_H = SCREEN.y1 - SCREEN.y0;
const SCREEN_C = new THREE.Vector3(SCREEN.x, (SCREEN.y0 + SCREEN.y1) / 2, (SCREEN.z0 + SCREEN.z1) / 2);
const RT_W = 2048, RT_H = Math.round(2048 * SCREEN_H / SCREEN_W);

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export { inSensorZone };

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
    this.themeTimer = 0;
    this.lastPress = -999;
    this.fade = 1;
    this.pendingTheme = null;
    this.tracked = new Map(); // personId -> track
    this.duos = new Map(); // pairKey -> duo
    this.cooldowns = new Map();
    this.sensorView = false;
    this.muted = false;
    this.autoRotate = true; // only the room host auto-rotates in multiplayer
    this.onShared = null; // (patch) => void, called when the local user changes shared state
    this.duoCounts = new Map();
    this.toast = null;
    this.overlayDirty = true;
    this.overlayTimer = 0;
    this.filterActive = false;

    this.hw = new THREE.Group();
    scene.add(this.hw);

    this.buildArchive();
    this.buildScreen();
    this.buildHardware(obstacles);
    this.buildKiosk(obstacles);
    this.buildLights(obstacles);
    this.buildSensorViz();
    this.buildGuides();
    // place the whole installation (built in its local frame) out on the square
    this.hw.position.set(LAYOUT.screen.cx, 0, LAYOUT.screen.cz);
    this.hw.rotation.y = LAYOUT.screen.rot;
    this.hw.updateMatrixWorld(true);
    this.kioskPos = this.kiosk.getWorldPosition(new THREE.Vector3());
    this.finalizeSeats();
    this.guidePhase = 0;
    this.setTheme('1944', true);
  }

  // =====================================================================
  // Archive scene (what the LED wall shows)
  // =====================================================================
  buildArchive() {
    this.rt = new THREE.WebGLRenderTarget(RT_W, RT_H, { samples: 4, type: THREE.HalfFloatType });
    const s = (this.archive = new THREE.Scene());
    this.archiveCam = new THREE.PerspectiveCamera(25, RT_W / RT_H, 0.1, 200);
    this.archiveCam.position.set(0, 1.55, 9.5);
    this.archiveCam.lookAt(0, 1.3, -1);

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

    this.themes = {
      1944: this.buildStage1944(),
      1958: this.buildStage1958(),
      kids: this.buildStageKids(),
    };
    for (const g of Object.values(this.themes)) { g.visible = false; s.add(g); }
    this.skies = {
      1944: gradientSkyTexture('#7fa7d6', '#dfe8ef'),
      1958: gradientSkyTexture('#5b93d1', '#e8eef2'),
      kids: this.kidsTexture,
    };

    // festive layers that escalate with the crowd
    this.fx = new THREE.Group();
    s.add(this.fx);
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
        rig, active: false, x: 0, z: -5 - r() * 3.5, dir: 1, speed: 0.8 + r() * 0.5, phase: r() * 10,
        seed: r() * 10, lane: -5 - r() * 3.5, danceOffset: r() * 3,
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

  buildStage1944() {
    const g = new THREE.Group();
    const r = rng(44);
    // pale concrete slabs
    const c = makeCanvas(256, 256), ctx = c.getContext('2d');
    ctx.fillStyle = '#bdb6a6'; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#8f887a'; ctx.lineWidth = 3;
    for (let i = 0; i <= 256; i += 64) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke(); }
    g.add(this.stageGround('#ffffff', toTexture(c), 3));
    // lawn with chairs (from the 1944 photo)
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(12, 0.12, 5), M('#5f8f3c', 1));
    lawn.position.set(-4, 0.06, -10.5);
    lawn.receiveShadow = true;
    g.add(lawn);
    for (let i = 0; i < 7; i++) {
      const ch = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.6), M('#2f6b3a', 0.7));
      seat.position.y = 0.4; ch.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.06), M('#2f6b3a', 0.7));
      back.position.set(0, 0.68, -0.3); back.rotation.x = -0.35; ch.add(back);
      for (const x of [-0.25, 0.25]) for (const z of [-0.25, 0.25]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.04), M('#e8e2d0', 0.6));
        leg.position.set(x, 0.2, z); ch.add(leg);
      }
      ch.position.set(-9 + i * 1.6 + r() * 0.3, 0.12, -9.8 - r() * 1.5);
      ch.rotation.y = (r() - 0.5) * 0.8;
      ch.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.add(ch);
    }
    // tall white block (left) & low shop building with red awning (right)
    const block = new THREE.Mesh(new THREE.BoxGeometry(12, 24, 8), M('#ece6d8', 0.95));
    block.position.set(-11, 12, -26);
    g.add(block);
    this.windowGrid(g, -15.5, 2.2, -21.95, 5, 8, 2.2, 2.8, 1.2, 1.5, M('#3b4450', 0.3, 0.4));
    const shops = new THREE.Mesh(new THREE.BoxGeometry(24, 7, 6), M('#e9dcbc', 0.95));
    shops.position.set(9, 3.5, -17);
    g.add(shops);
    this.windowGrid(g, -1.5, 5.1, -13.95, 9, 1, 2.6, 0, 1.4, 1.4, M('#3b4450', 0.3, 0.4));
    this.windowGrid(g, -1.8, 1.4, -13.95, 6, 1, 3.8, 0, 3.0, 2.2, M('#2a3038', 0.2, 0.5));
    const awning = new THREE.Mesh(new THREE.BoxGeometry(24, 0.12, 1.6), M('#b8322a', 0.8));
    awning.position.set(9, 3.1, -13.3);
    awning.rotation.x = 0.35;
    awning.castShadow = true;
    g.add(awning);
    for (const [txt, x] of [['SPECERIER', 3], ['KONDITORI', 13]]) {
      const sgn = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.6), new THREE.MeshStandardMaterial({ map: signTexture(txt, { bg: '#1f2d24', fg: '#f3e6c4' }) }));
      sgn.position.set(x, 3.9, -13.9);
      g.add(sgn);
    }
    // flagpole with Swedish flag
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 11, 10), M('#f4f1ea', 0.5));
    pole.position.set(-6.5, 5.5, -12.5);
    pole.castShadow = true;
    g.add(pole);
    const fc = makeCanvas(160, 100), fx = fc.getContext('2d');
    fx.fillStyle = '#006aa7'; fx.fillRect(0, 0, 160, 100);
    fx.fillStyle = '#fecc00'; fx.fillRect(50, 0, 20, 100); fx.fillRect(0, 40, 160, 20);
    const flagGeo = new THREE.PlaneGeometry(2.0, 1.25, 16, 4);
    flagGeo.translate(1.0, 0, 0);
    this.flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ map: toTexture(fc, { wrap: false }), side: THREE.DoubleSide }));
    this.flag.position.set(-6.45, 10.3, -12.5);
    this.flagBase = flagGeo.attributes.position.array.slice();
    g.add(this.flag);
    // young trees and old lamps
    for (const [x, z] of [[-14, -8], [2, -10], [-1, -11.5], [6, -9.5], [14, -10]]) {
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 2.6, 8), M('#4a3d33', 1));
      tr.position.set(x, 1.3, z); tr.castShadow = true; g.add(tr);
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), M('#4f7a33', 1));
        b.position.set(x + (r() - 0.5) * 0.8, 3.0 + r() * 0.8, z + (r() - 0.5) * 0.8);
        b.castShadow = true; g.add(b);
      }
    }
    for (const x of [-12, 11]) {
      const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 4, 8), M('#1c1c1c', 0.5, 0.5));
      lp.position.set(x, 2, -6.5); g.add(lp);
      const gl = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), M('#f7f1e0', 0.3, 0, { emissive: '#ffd89a', emissiveIntensity: 0.3 }));
      gl.position.set(x, 4.1, -6.5); g.add(gl);
    }
    return g;
  }

  buildStage1958() {
    const g = new THREE.Group();
    const r = rng(58);
    // striped paving like the 1958 photo of Doktor Fries Torg
    const c = makeCanvas(256, 256), ctx = c.getContext('2d');
    ctx.fillStyle = '#b9b8b2'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#e6e5df';
    for (let i = 0; i < 256; i += 32) ctx.fillRect(0, i, 256, 12);
    g.add(this.stageGround('#ffffff', toTexture(c), 4));
    // brick balcony block (left)
    const blk = new THREE.Mesh(new THREE.BoxGeometry(14, 13, 8), M('#b86a3e', 0.95));
    blk.position.set(-12, 6.5, -22);
    g.add(blk);
    this.windowGrid(g, -17.5, 1.8, -17.95, 5, 4, 2.6, 3, 1.3, 1.5, M('#2f3a44', 0.3, 0.4));
    for (let rr = 1; rr < 4; rr++) for (let cc = 0; cc < 3; cc++) {
      const bal = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.0), M('#f1ede4', 0.8));
      bal.position.set(-16 + cc * 4, 1.2 + rr * 3, -17.4);
      g.add(bal);
    }
    // cream building behind the shop row
    const back = new THREE.Mesh(new THREE.BoxGeometry(26, 10, 8), M('#eadfc4', 0.95));
    back.position.set(9, 5, -22);
    g.add(back);
    this.windowGrid(g, -2.5, 5.5, -17.95, 9, 2, 2.8, 2.6, 1.4, 1.4, M('#2f3a44', 0.3, 0.4));
    // shop row with striped awnings & signs
    const shops = new THREE.Mesh(new THREE.BoxGeometry(26, 3.8, 5), M('#f3efe6', 0.9));
    shops.position.set(9, 1.9, -15.5);
    g.add(shops);
    const awnColors = [['#c0392b', '#f5f0e6'], ['#1f7a5a', '#f5f0e6'], ['#e0a040', '#fff7e6'], ['#2e5a88', '#f5f0e6']];
    const names = ['MJÖLK & OST', 'BLOMMOR', 'KONDITORI', 'FRISÖR'];
    for (let i = 0; i < 4; i++) {
      const x = -1.5 + i * 6.3;
      const ac = makeCanvas(128, 32), ax = ac.getContext('2d');
      for (let k = 0; k < 16; k++) { ax.fillStyle = awnColors[i][k % 2]; ax.fillRect(k * 8, 0, 8, 32); }
      const aw = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.08, 1.5), new THREE.MeshStandardMaterial({ map: toTexture(ac, { wrap: false }), roughness: 0.8 }));
      aw.position.set(x, 2.9, -12.4); aw.rotation.x = 0.4; aw.castShadow = true;
      g.add(aw);
      const win = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.0, 0.05), M('#2a3038', 0.2, 0.5));
      win.position.set(x, 1.3, -12.97); g.add(win);
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.6), new THREE.MeshStandardMaterial({ map: signTexture(names[i], { bg: '#fdfbf5', fg: awnColors[i][0], font: 'bold 50px Helvetica, Arial' }) }));
      sg.position.set(x, 3.45, -12.96); g.add(sg);
    }
    // cars
    const car = (x, z, col, ry) => {
      const cg = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 2.8, 8, 16), M(col, 0.35, 0.3));
      body.rotation.z = Math.PI / 2; body.scale.set(1, 1, 1.35); body.position.y = 0.72; cg.add(body);
      const cab = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 12), M(col, 0.35, 0.3));
      cab.scale.set(1.3, 0.7, 0.85); cab.position.set(-0.2, 1.15, 0); cg.add(cab);
      const win = new THREE.Mesh(new THREE.SphereGeometry(0.91, 20, 12), M('#20262c', 0.1, 0.6));
      win.scale.set(1.0, 0.55, 0.8); win.position.set(-0.2, 1.22, 0); cg.add(win);
      for (const wx of [-1.25, 1.25]) for (const wz of [-0.72, 0.72]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 16), M('#111', 0.6));
        w.rotation.x = Math.PI / 2; w.position.set(wx, 0.33, wz); cg.add(w);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.23, 12), M('#eee', 0.2, 0.9));
        hub.rotation.x = Math.PI / 2; hub.position.set(wx, 0.33, wz); cg.add(hub);
      }
      const bump = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 1.7), M('#ddd', 0.2, 1));
      bump.position.set(2.05, 0.5, 0); cg.add(bump);
      const b2 = bump.clone(); b2.position.x = -2.05; cg.add(b2);
      cg.position.set(x, 0, z); cg.rotation.y = ry;
      cg.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.add(cg);
    };
    car(13, -9, '#7fa9c9', 0.1);
    car(-15, -9.5, '#c94f4f', -0.2);
    // rock outcrop, benches, flower bed
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), M('#9b958a', 0.9));
    rock.scale.set(2.2, 0.5, 1.2); rock.position.set(-4, 0.1, -9); rock.castShadow = true; g.add(rock);
    for (const x of [2, 6]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 0.5), M('#2f6b3a', 0.7));
      b.position.set(x, 0.45, -8.5); b.castShadow = true; g.add(b);
      const bb = new THREE.Mesh(new THREE.BoxGeometry(2, 0.45, 0.08), M('#2f6b3a', 0.7));
      bb.position.set(x, 0.75, -8.75); g.add(bb);
    }
    for (let i = 0; i < 26; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), M(['#e84a5f', '#ffcf40', '#ff8c42', '#b04dff'][i % 4], 0.8));
      f.position.set(-9 + r() * 4, 0.25, -11 + r() * 1.2); g.add(f);
    }
    for (const x of [-9, 9.5]) {
      const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 5.5, 8), M('#dadada', 0.4, 0.6));
      lp.position.set(x, 2.75, -7); g.add(lp);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.3), M('#dadada', 0.4, 0.6));
      head.position.set(x + 0.35, 5.5, -7); g.add(head);
    }
    return g;
  }

  buildStageKids() {
    // the drawing fills the whole view as a background; the floor only catches shadows
    const g = new THREE.Group();
    this.kidsTexture = toTexture(kidsDrawingTexture(), { wrap: false });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.ShadowMaterial({ opacity: 0.28 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -10;
    floor.receiveShadow = true;
    g.add(floor);
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
          vec3 sepia = vec3(l * 1.08, l * 0.93, l * 0.72);
          vec3 col = mix(sepia, c, clamp(saturation, 0.0, 1.0));
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
    // floor decal marking the interaction zone
    const decalGeo = new THREE.PlaneGeometry(18, 18);
    decalGeo.rotateX(-Math.PI / 2);
    const decal = new THREE.Mesh(decalGeo, new THREE.MeshStandardMaterial({ map: toTexture(zoneDecalTexture(), { wrap: false }), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
    decal.rotation.y = Math.PI / 2;
    decal.position.set(x - 0.2, 0.025, 0);
    decal.receiveShadow = true;
    this.hw.add(decal);
    this.buildBenches(obstacles);
  }

  /** Audience benches flanking the zone (outside the sensor field, so sitting doesn't drive an avatar). */
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
      for (const sx of [-0.45, 0.45]) {
        const seat = new THREE.Object3D();
        seat.position.set(sx, 0, -0.02);
        g.add(seat);
        const front = new THREE.Object3D();
        front.position.set(sx, 0, 0.85);
        g.add(front);
        this.seatAnchors.push({ seat, front, group: g });
        const lp = new THREE.Vector3(sx, 0, -0.05).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y).add(g.position);
        this.addObstacle(obstacles, { t: 'circle', x: lp.x, z: lp.z, r: 0.42 });
      }
      this.hw.add(g);
    };
    // on both sides of the zone, angled towards the screen
    bench(-3.6, 10.4, -2.5, 0); bench(-3.6, -10.4, -2.5, 0);
    bench(-7.4, 11.8, -4, 0); bench(-7.4, -11.8, -4, 0);
    // behind the zone, facing the screen (between the audience and the big street)
    bench(-12.6, 3.6, 0, 3.6); bench(-12.6, -3.6, 0, -3.6);
  }

  /** Called once the installation group is placed in the world. */
  finalizeSeats() {
    const v = new THREE.Vector3();
    this.seats = this.seatAnchors.map((a) => {
      const pos = a.seat.getWorldPosition(new THREE.Vector3());
      const front = a.front.getWorldPosition(v).clone();
      const heading = Math.atan2(front.x - pos.x, front.z - pos.z);
      return { pos, front, heading, occupant: null };
    });
  }

  buildKiosk(obstacles) {
    const k = (this.kiosk = new THREE.Group());
    k.position.set(-3.3, 0, -8.2);
    this.hw.add(k);
    const steel = M('#9aa1a8', 0.32, 0.85);
    const add = (geo, mat, x, y, z, parent = k) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
    add(new THREE.CylinderGeometry(0.32, 0.34, 0.03, 24), M('#3a3d42', 0.6, 0.4), 0, 0.015, 0);
    add(new THREE.BoxGeometry(0.22, 1.0, 0.34), steel, 0, 0.51, 0);
    // info plaque on the column front
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.35), new THREE.MeshStandardMaterial({ map: toTexture(plaqueTexture(), { wrap: false }), roughness: 0.4 }));
    plaque.rotation.y = -Math.PI / 2;
    plaque.position.set(-0.111, 0.55, 0);
    k.add(plaque);
    // angled control panel
    const head = new THREE.Group();
    head.position.set(0, 1.04, 0);
    head.rotation.z = 0.5;
    k.add(head);
    add(new THREE.BoxGeometry(0.38, 0.07, 0.64), steel, 0, 0, 0, head);
    this.panelCanvas = makeCanvas(640, 384);
    this.panelTex = toTexture(this.panelCanvas, { wrap: false });
    const pg = new THREE.PlaneGeometry(0.6, 0.36);
    pg.rotateX(-Math.PI / 2);
    pg.rotateY(-Math.PI / 2);
    const panel = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: this.panelTex, roughness: 0.25, metalness: 0.2, emissive: '#ffffff', emissiveMap: this.panelTex, emissiveIntensity: 0.35 }));
    panel.position.y = 0.036;
    head.add(panel);
    this.buttons = [];
    const ids = ['1944', '1958', 'kids', 'sound'];
    const colors = { 1944: '#e0a040', 1958: '#2ec4b6', kids: '#ff5d8f', sound: '#8be08b' };
    ids.forEach((id, i) => {
      const z = -0.21 + i * 0.14;
      add(new THREE.CylinderGeometry(0.048, 0.05, 0.014, 24), M('#1a1c1f', 0.4, 0.6), -0.03, 0.04, z, head);
      const capMat = new THREE.MeshStandardMaterial({ color: colors[id], roughness: 0.3, emissive: colors[id], emissiveIntensity: 0.6 });
      const cap = add(new THREE.CylinderGeometry(0.038, 0.038, 0.024, 24), capMat, -0.03, 0.055, z, head);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.08, 12), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(-0.03, 0.06, z);
      head.add(hit);
      hit.userData.kioskButton = id;
      cap.userData.kioskButton = id;
      this.buttons.push({ id, cap, hit, mat: capMat, press: 0, hover: false });
    });
    this.addObstacle(obstacles, { t: 'circle', x: k.position.x, z: k.position.z, r: 0.38 });
    this.drawPanel();
  }

  drawPanel() {
    const c = this.panelCanvas, ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.fillStyle = '#0f1216'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1c232b'; ctx.fillRect(24, 20, W - 48, 110);
    ctx.fillStyle = '#f1c453'; ctx.font = 'bold 28px Helvetica, Arial';
    ctx.fillText('DET INTERAKTIVA ARKIVET', 44, 58);
    ctx.fillStyle = '#e8e8e8'; ctx.font = '24px Helvetica, Arial';
    const th = THEMES[this.theme];
    ctx.fillText(`Visar nu: ${th.caption}`, 44, 96);
    ctx.fillStyle = this.muted ? '#ff8080' : '#8be08b';
    ctx.font = '20px Helvetica, Arial';
    ctx.fillText(this.muted ? 'LJUD AV' : 'LJUD PÅ', W - 150, 96);
    const labels = { 1944: '1944', 1958: '1958', kids: 'BARNENS', sound: this.muted ? 'LJUD PÅ' : 'LJUD AV' };
    ['1944', '1958', 'kids', 'sound'].forEach((id, i) => {
      const x = ((-0.21 + i * 0.14) + 0.3) / 0.6 * W;
      const active = id === this.theme;
      ctx.fillStyle = active ? '#f1c453' : '#b9c0c7';
      ctx.font = `${active ? 'bold ' : ''}24px Helvetica, Arial`;
      ctx.textAlign = 'center';
      ctx.fillText(labels[id], x, 330);
      if (active) { ctx.fillRect(x - 40, 342, 80, 4); }
      ctx.textAlign = 'left';
    });
    ctx.fillStyle = '#7d858d'; ctx.font = '18px Helvetica, Arial';
    ctx.fillText('Tryck för att byta epok', 44, 170);
    this.panelTex.needsUpdate = true;
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
    this.festoonLights = [new THREE.PointLight('#ffc98a', 0, 16, 1.5), new THREE.PointLight('#ffc98a', 0, 16, 1.5)];
    this.festoonLights[0].position.set(-5.5, 3.8, -4);
    this.festoonLights[1].position.set(-5.5, 3.8, 4);
    this.hw.add(...this.festoonLights);
  }

  /** LED light strips in the paving that guide people from the entrances to the zone. */
  buildGuides() {
    const W = (lx, lz) => screenToWorld(lx, lz, 0.03);
    const paths = [
      [new THREE.Vector3(0, 0.03, 18.5), new THREE.Vector3(0, 0.03, 14.5), W(-9, 0)], // from the big street (south)
      [new THREE.Vector3(-27, 0.03, -1), new THREE.Vector3(-19, 0.03, 0.5), new THREE.Vector3(-13.5, 0.03, 5), W(-6.5, -9.2)], // west
      [new THREE.Vector3(17.5, 0.03, -21), new THREE.Vector3(15, 0.03, -9), new THREE.Vector3(12.5, 0.03, 2.5), W(-5.5, 9.2)], // north path
      [new THREE.Vector3(-3, 0.03, -18.5), new THREE.Vector3(-9.5, 0.03, -9), new THREE.Vector3(-10.8, 0.03, 0), W(-4.6, -9.6)], // from behind the screen
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
    // sensing volume outline on the ground + frustum rays
    const outline = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const d = 0.3 + (11.2 * i) / N;
      const hw = Math.min(6.5 + d * 0.55, 11);
      outline.push(new THREE.Vector3(SCREEN.x - d, 0.05, hw));
    }
    for (let i = N; i >= 0; i--) {
      const d = 0.3 + (11.2 * i) / N;
      const hw = Math.min(6.5 + d * 0.55, 11);
      outline.push(new THREE.Vector3(SCREEN.x - d, 0.05, -hw));
    }
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
      for (const p of [outline[N], outline[N + 1], outline[0]]) rays.push(s, p);
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
  pressButton(id) {
    const b = this.buttons.find((x) => x.id === id);
    if (b) b.press = 1;
    this.lastPress = this.time;
    this.audio?.click();
    if (id === 'sound') {
      this.muted = !this.muted;
      this.audio?.setInstallationMuted(this.muted);
      this.onEvent(this.muted ? 'Pillar: installation sound off' : 'Pillar: installation sound on', 'kiosk');
      this.drawPanel();
      this.onShared?.({ muted: this.muted });
      return;
    }
    if (id !== this.theme) {
      this.setTheme(id);
      this.onEvent(`Pillar: switched era to ${THEMES[id].caption}`, 'kiosk');
      this.onShared?.({ theme: id });
    }
  }

  /** Shared state changed by someone else in the room. */
  applyShared(state, by) {
    if (state.theme && state.theme !== this.theme && state.theme !== this.pendingTheme) {
      this.setTheme(state.theme);
      this.themeTimer = 0;
      if (by) this.onEvent(`${by} pressed the pillar → ${THEMES[state.theme].caption}`, 'kiosk');
    }
    if (typeof state.muted === 'boolean' && state.muted !== this.muted) {
      this.muted = state.muted;
      this.audio?.setInstallationMuted(this.muted);
      this.drawPanel();
    }
  }

  setTheme(id, immediate = false) {
    if (immediate) {
      this.theme = id;
      for (const [k, g] of Object.entries(this.themes)) g.visible = k === id;
      this.archive.background = this.skies[id];
      this.drawPanel();
      this.overlayDirty = true;
      return;
    }
    this.pendingTheme = id;
  }

  setHover(id) {
    for (const b of this.buttons) b.hover = b.id === id;
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
      if (!inSensorZone(p.pos)) continue;
      seen.add(p.id);
      let tr = this.tracked.get(p.id);
      if (!tr) {
        tr = this.startTrack(p);
        this.tracked.set(p.id, tr);
      }
      tr.person = p;
      tr.lastSeen = t;
      tr.leaving = false;
    }
    for (const [id, tr] of this.tracked) {
      if (!seen.has(id) && t - tr.lastSeen > 1.0 && !tr.leaving) {
        tr.leaving = true;
        tr.leaveT = t;
        this.onEvent(`${tr.person.name} left the zone – ${tr.style.sv} fades away`, 'leave');
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
      const msgs = [
        'Torget somnar in igen…',
        'En granne! Arkivet vaknar.',
        'Två grannar – färgen börjar återvända.',
        'En grupp! Ljusslingorna tänds.',
        'FEST PÅ TORGET! Precis som på dansbanans tid.',
      ];
      if (this.level > prevLevel) this.showToast(msgs[this.level]);
      this.onEvent(`Level ${this.level}: ${LEVELS[this.level].en} (${this.count} ${this.count === 1 ? 'person' : 'people'})`, 'level');
      this.audio?.setLevel(this.level);
    }
    this.energy += (this.level - this.energy) * (1 - Math.exp(-dt * 1.2));

    // --- proximity duos ---
    this.updateDuos(active, t);

    // --- avatars ---
    this.filterActive = false;
    for (const tr of this.tracked.values()) this.updateAvatar(tr, dt, t);

    // --- theme switching / auto-rotation ---
    this.themeTimer += dt;
    if (this.autoRotate && !this.pendingTheme && this.themeTimer > 90 && t - this.lastPress > 45) {
      this.pendingTheme = THEME_ORDER[(THEME_ORDER.indexOf(this.theme) + 1) % THEME_ORDER.length];
      this.onEvent(`Auto-rotation → ${THEMES[this.pendingTheme].caption}`, 'kiosk');
      this.onShared?.({ theme: this.pendingTheme });
    }
    if (this.pendingTheme) {
      this.fade = Math.max(0, this.fade - dt * 3);
      if (this.fade === 0) {
        this.setTheme(this.pendingTheme, true);
        this.pendingTheme = null;
        this.themeTimer = 0;
      }
    } else this.fade = Math.min(1, this.fade + dt * 2.5);

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
    u.saturation.value = e < 1 ? e * 0.12 : e < 2 ? 0.12 + (e - 1) * 0.4 : e < 3 ? 0.52 + (e - 2) * 0.43 : 0.95 + (e - 3) * 0.2;
    u.grain.value = 0.14 - Math.min(e, 4) * 0.03;
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
    ctx.fillText(style.sv, 256, 52);
    ctx.fillStyle = '#d9c8a0'; ctx.font = 'italic 26px Georgia, serif';
    ctx.fillText(`${style.en} · ${style.era}`, 256, 90);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: toTexture(c, { wrap: false }), transparent: true, depthWrite: false }));
    tag.scale.set(1.5, 0.33, 1);
    this.archive.add(tag);
    const filterIcon = makeFilterIcon();
    filterIcon.visible = false;
    this.archive.add(filterIcon);
    this.emit('sparkle', stage.clone().add(_v.set(0, 1.0, 0)), 14, 1.0, 1.2);
    this.onEvent(`${p.name} detected → becomes "${style.sv}" – ${style.en}`, 'track');
    this.audio?.chime(0);
    return {
      id: p.id, person: p, style, rig, born: this.time, lastSeen: this.time, leaving: false,
      stage, yaw: 0, tag, filterIcon, filterT: 0, filtered: false, filterLogged: false, duo: null,
    };
  }

  stagePos(p) {
    const l = toScreenLocal(p.pos, _v3);
    const x = clamp(l.z, -9, 9) * 0.62;
    const d = clamp(-l.x, 0.5, 12);
    const z = 3.2 - (d - 0.5) * 0.55;
    return new THREE.Vector3(x, 0, z);
  }

  updateDuos(active, t) {
    const PROX = 1.5;
    const present = new Set();
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const d = Math.hypot(a.person.pos.x - b.person.pos.x, a.person.pos.z - b.person.pos.z);
      if (d > PROX) continue;
      const key = [a.id, b.id].sort().join('|');
      present.add(key);
      if (this.duos.has(key) || a.duo || b.duo) continue;
      if ((this.cooldowns.get(key) ?? -99) > t) continue;
      const types = Object.keys(DUO_TYPES);
      const n = (this.duoCounts.get(key) ?? 0) + 1;
      this.duoCounts.set(key, n);
      const type = types[hashStr(key + n) % types.length];
      const [left, right] = this.stagePos(a.person).x <= this.stagePos(b.person).x ? [a, b] : [b, a];
      const duo = { key, a: left, b: right, type, t0: t, dur: 5 };
      this.duos.set(key, duo);
      left.duo = duo; right.duo = duo;
      this.onEvent(`Proximity: ${a.person.name} ↔ ${b.person.name} → ${DUO_TYPES[type].en} between ${a.style.sv} & ${b.style.sv}`, 'duo');
      this.showToast(`${DUO_TYPES[type].sv}! ${left.style.sv} & ${right.style.sv}`);
      this.audio?.chime(1);
    }
    for (const [key, duo] of this.duos) {
      const done = t - duo.t0 > duo.dur || !this.tracked.has(duo.a.id) || !this.tracked.has(duo.b.id);
      if (done) {
        duo.a.duo = null; duo.b.duo = null;
        this.duos.delete(key);
        this.cooldowns.set(key, t + 12);
      }
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
    const duo = tr.duo;
    let duoT = 0;
    if (duo) {
      duoT = t - duo.t0;
      const mid = this.stagePos(duo.a.person).add(this.stagePos(duo.b.person)).multiplyScalar(0.5);
      const role = duo.a === tr ? 0 : 1;
      const side = role === 0 ? -1 : 1;
      if (duo.type === 'swing') {
        const ang = duoT * 2.2 + (role ? Math.PI : 0);
        target = mid.clone().add(_v.set(Math.cos(ang) * 0.45 * -1, 0, Math.sin(ang) * 0.45));
        yawTarget = Math.atan2(mid.x - target.x, mid.z - target.z) + 0.3;
      } else {
        target = mid.clone().add(_v.set(side * 0.42, 0, 0));
        yawTarget = role === 0 ? Math.PI / 2 * 0.85 : -Math.PI / 2 * 0.85;
      }
      if (Math.floor(duoT * 3) !== Math.floor((duoT - dt) * 3)) {
        this.emit(duo.type === 'handshake' ? 'sparkle' : 'heart', mid.clone().add(_v.set(0, 2.0, 0)), 2, 0.5, 0.8);
      }
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
    if (duo) {
      rig.resetTargets();
      animIdle(rig, t, 1);
      animDuo(rig, duo.type, duo.a === tr ? 0 : 1, duoT);
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

    // name tag & filter icon
    const sc = rig.style.scale ?? 1;
    tr.tag.position.copy(tr.stage).add(_v.set(0, 2.25 * sc, 0.2));
    tr.tag.material.opacity = clamp(1 - (age - 5) / 1.5, 0, 1) * s;
    tr.tag.visible = tr.tag.material.opacity > 0.01;
    tr.filterIcon.visible = tr.filtered;
    tr.filterIcon.position.copy(tr.stage).add(_v.set(0.45, 1.75 * sc, 0.3));
  }

  updateExtras(dt, t) {
    const want = [2, 2, 4, 7, 12][this.level];
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
    if (this.flag && this.themes[1944].visible) {
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
    const sc = smooth(2.6, 3.4, e);
    this.stageCones.forEach((c, i) => {
      c.visible = sc > 0.01;
      c.material.uniforms.intensity.value = sc * 0.35;
      c.material.uniforms.color.value.set(e > 3.5 ? ['#ff6b9a', '#ffd166', '#6ecbff'][i] : '#ffe9c4');
    });
    // confetti
    const cf = smooth(3.4, 3.9, e);
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
    this.archiveCam.lookAt(this.archiveCam.position.x * 0.5, 1.3, -1);
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
    const sp = smooth(2.5, 3.2, e);
    const fest = e > 3.5;
    const FEST = ['#ff6b9a', '#ffd166', '#6ecbff', '#b69cff'];
    this.spots.forEach((s, i) => {
      // static fixtures: fixed aim, only brightness (and a fixed festival tint) follows the level
      const col = fest ? _c.set(FEST[i]) : _c.set('#fff1dc');
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
    // kiosk buttons
    for (const b of this.buttons) {
      b.press = Math.max(0, b.press - dt * 4);
      b.cap.position.y = 0.055 - b.press * 0.01;
      const active = b.id === this.theme || (b.id === 'sound' && !this.muted);
      b.mat.emissiveIntensity = 0.35 + (active ? 0.9 : 0) + (b.hover ? 1.2 : 0) + b.press * 3 + night * 0.5;
    }
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
    for (const duo of this.duos.values()) {
      pushLine(_v.copy(duo.a.person.pos).setY(0.08), _v2.copy(duo.b.person.pos).setY(0.08), pink);
      pushLine(_v.copy(duo.a.person.pos).setY(1.2), _v2.copy(duo.b.person.pos).setY(1.2), pink);
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
    ctx.fillText(LEVELS[this.level].sv.toUpperCase(), x0 + 180, 76);
    ctx.font = '22px Helvetica, Arial';
    ctx.fillStyle = '#d8c8a4';
    ctx.fillText(this.count === 0 ? 'ingen här just nu' : `${this.count} ${this.count === 1 ? 'granne' : 'grannar'} på torget`, x0, 108);
    // attract text
    if (this.count === 0) {
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#fff6e0';
      ctx.font = 'bold 64px Georgia, serif';
      ctx.fillText('Kliv fram och bli en del av torgets historia', W / 2, H / 2 + 10);
      ctx.font = 'italic 34px Georgia, serif';
      ctx.fillStyle = '#f1dcae';
      ctx.fillText('Step closer and become part of the square’s history', W / 2, H / 2 + 62);
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
      duos: [...this.duos.values()].map((d) => ({ a: d.a.person.name, b: d.b.person.name, type: DUO_TYPES[d.type].sv })),
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
