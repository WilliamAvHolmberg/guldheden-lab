import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Articulated character rig.
// Local frame: +Z forward, +Y up, +X is the character's LEFT.
// Limbs hang along -Y in rest pose; every joint is a Group we rotate directly,
// which makes both procedural gestures and MediaPipe retargeting simple.
// ---------------------------------------------------------------------------

export const JOINTS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
];

const MIRROR = {
  uArmL: 'uArmR', fArmL: 'fArmR', handL: 'handR', uArmR: 'uArmL', fArmR: 'fArmL', handR: 'handL',
  thighL: 'thighR', shinL: 'shinR', footL: 'footR', thighR: 'thighL', shinR: 'shinL', footR: 'footL',
};

export const BONES = [
  ['hips', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'],
  ['chest', 'uArmL'], ['uArmL', 'fArmL'], ['fArmL', 'handL'],
  ['chest', 'uArmR'], ['uArmR', 'fArmR'], ['fArmR', 'handR'],
  ['hips', 'thighL'], ['thighL', 'shinL'], ['shinL', 'footL'],
  ['hips', 'thighR'], ['thighR', 'shinR'], ['shinR', 'footR'],
];

const matCache = new Map();
export function M(color, rough = 0.8, metal = 0, extra = {}) {
  const key = `${color}|${rough}|${metal}|${JSON.stringify(extra)}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));
  }
  return matCache.get(key);
}

const geoCache = new Map();
function G(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
const capsule = (r, l) => G(`cap${r}_${l}`, () => new THREE.CapsuleGeometry(r, l, 6, 12));
const sphere = (seg = 16) => G(`sph${seg}`, () => new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75)));
const cyl = (rt, rb, h, seg = 16, open = false) => G(`cyl${rt}_${rb}_${h}_${seg}_${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
const box = (w, h, d) => G(`box${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));

function part(parent, geom, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geom, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class Rig {
  constructor(style) {
    this.style = style;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.body.scale.setScalar(style.scale ?? 1);
    this.joints = {};
    this.target = {};
    for (const n of JOINTS) {
      this.joints[n] = new THREE.Group();
      this.joints[n].name = n;
      this.target[n] = new THREE.Quaternion();
    }
    const j = this.joints;
    this.hipsBase = new THREE.Vector3(0, 0.93, 0);
    this.offset = new THREE.Vector3();
    this.offsetTarget = new THREE.Vector3();
    j.hips.position.copy(this.hipsBase);
    this.body.add(j.hips);
    j.hips.add(j.spine); j.spine.position.set(0, 0.08, 0);
    j.spine.add(j.chest); j.chest.position.set(0, 0.2, 0);
    j.chest.add(j.neck); j.neck.position.set(0, 0.28, 0);
    j.neck.add(j.head); j.head.position.set(0, 0.07, 0);
    for (const [s, x] of [['L', 1], ['R', -1]]) {
      j.chest.add(j['uArm' + s]); j['uArm' + s].position.set(0.19 * x, 0.24, -0.01);
      j['uArm' + s].add(j['fArm' + s]); j['fArm' + s].position.set(0, -0.28, 0);
      j['fArm' + s].add(j['hand' + s]); j['hand' + s].position.set(0, -0.25, 0);
      j.hips.add(j['thigh' + s]); j['thigh' + s].position.set(0.1 * x, -0.03, 0);
      j['thigh' + s].add(j['shin' + s]); j['shin' + s].position.set(0, -0.44, 0);
      j['shin' + s].add(j['foot' + s]); j['foot' + s].position.set(0, -0.43, 0);
    }
    buildBody(this, style);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  resetTargets() {
    for (const n of JOINTS) this.target[n].identity();
    this.offsetTarget.set(0, 0, 0);
  }

  set(name, x = 0, y = 0, z = 0) {
    _e.set(x, y, z, 'XYZ');
    this.target[name].setFromEuler(_e);
  }

  /** Multiply an extra rotation onto an existing target. */
  add(name, x = 0, y = 0, z = 0) {
    _e.set(x, y, z, 'XYZ');
    _q.setFromEuler(_e);
    this.target[name].multiply(_q);
  }

  update(dt, sharpness = 16) {
    const k = 1 - Math.exp(-dt * sharpness);
    for (const n of JOINTS) this.joints[n].quaternion.slerp(this.target[n], k);
    this.offset.lerp(this.offsetTarget, k);
    this.joints.hips.position.copy(this.hipsBase).add(this.offset);
  }

  /** Snap without smoothing (used when an avatar first appears). */
  snap() {
    for (const n of JOINTS) this.joints[n].quaternion.copy(this.target[n]);
    this.offset.copy(this.offsetTarget);
    this.joints.hips.position.copy(this.hipsBase).add(this.offset);
  }

  /** Copy the current pose from another rig into this rig's targets, optionally as a mirror image. */
  copyPoseFrom(other, mirror = false) {
    for (const n of JOINTS) {
      const src = other.joints[mirror && MIRROR[n] ? MIRROR[n] : n].quaternion;
      const t = this.target[n];
      if (mirror) t.set(src.x, -src.y, -src.z, src.w);
      else t.copy(src);
    }
    this.offsetTarget.copy(other.offset);
    if (mirror) this.offsetTarget.x *= -1;
  }

  worldPos(name, out = new THREE.Vector3()) {
    return this.joints[name].getWorldPosition(out);
  }

  dispose() {
    this.root.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Body construction from a style description.
// ---------------------------------------------------------------------------

function buildBody(rig, s) {
  const j = rig.joints;
  const skin = M(s.skin, 0.62);
  const top = M(s.top, s.topRough ?? 0.85);
  const bottom = M(s.bottom, 0.85);
  const shoes = M(s.shoes, 0.45);
  const sleeve = s.shortSleeve ? skin : top;
  const shinMat = s.stockings ? M(s.stockings, 0.6) : (s.skirt || s.shorts ? skin : bottom);

  // pelvis & torso
  part(j.hips, sphere(), s.dress ? M(s.dress, 0.8) : bottom, 0, -0.02, 0, 0.16, 0.12, 0.105);
  part(j.spine, capsule(0.13, 0.12), top, 0, 0.1, 0, 1.15, 1, 0.78);
  part(j.chest, capsule(0.15, 0.14), top, 0, 0.12, 0, 1.22, 1, 0.72);
  if (s.bust) part(j.chest, sphere(), top, 0, 0.1, 0.06, 0.14, 0.07, 0.06);
  // neck & head
  part(j.neck, cyl(0.045, 0.05, 0.12), skin, 0, 0.02, 0);
  const headMesh = part(j.head, sphere(20), skin, 0, 0.08, 0.005, 0.098, 0.115, 0.105);
  headMesh.name = 'headMesh';
  // face
  const eye = M('#1d1a18', 0.3);
  part(j.head, sphere(8), eye, 0.035, 0.1, 0.094, 0.013, 0.015, 0.008);
  part(j.head, sphere(8), eye, -0.035, 0.1, 0.094, 0.013, 0.015, 0.008);
  part(j.head, sphere(8), skin, 0, 0.07, 0.105, 0.016, 0.025, 0.02);
  part(j.head, sphere(8), M(s.lips ?? '#a8605a', 0.5), 0, 0.03, 0.094, 0.025, 0.008, 0.01);
  part(j.head, sphere(8), skin, 0.098, 0.08, 0, 0.018, 0.03, 0.015);
  part(j.head, sphere(8), skin, -0.098, 0.08, 0, 0.018, 0.03, 0.015);
  if (s.glasses) {
    const gm = M('#222', 0.3, 0.6);
    const ring = G('glass', () => new THREE.TorusGeometry(0.024, 0.004, 6, 16));
    part(j.head, ring, gm, 0.035, 0.1, 0.104);
    part(j.head, ring, gm, -0.035, 0.1, 0.104);
  }
  if (s.beard) part(j.head, sphere(12), M(s.hair, 0.9), 0, 0.03, 0.06, 0.08, 0.06, 0.06);
  buildHair(j.head, s);
  buildHat(j.head, s);

  // arms
  for (const [side, x] of [['L', 1], ['R', -1]]) {
    part(j['uArm' + side], sphere(), top, 0, 0, 0, 0.062, 0.06, 0.06);
    part(j['uArm' + side], capsule(0.047, 0.19), s.shortSleeve ? skin : top, 0, -0.14, 0);
    if (s.shortSleeve) part(j['uArm' + side], cyl(0.056, 0.052, 0.1), top, 0, -0.04, 0);
    part(j['fArm' + side], capsule(0.04, 0.17), sleeve, 0, -0.125, 0);
    if (s.cuffs) part(j['fArm' + side], cyl(0.045, 0.045, 0.03), M(s.cuffs, 0.8), 0, -0.22, 0);
    part(j['hand' + side], sphere(), skin, 0, -0.055, 0.005, 0.038, 0.07, 0.026);
    part(j['hand' + side], sphere(), skin, 0.02 * x, -0.03, 0.02, 0.014, 0.03, 0.014);
    // legs
    part(j['thigh' + side], capsule(0.072, 0.3), s.dress ? skin : bottom, 0, -0.22, 0);
    part(j['shin' + side], capsule(0.053, 0.32), shinMat, 0, -0.21, 0);
    if (s.socks) part(j['shin' + side], cyl(0.056, 0.05, 0.14), M(s.socks, 0.9), 0, -0.34, 0);
    if (s.shorts) part(j['thigh' + side], cyl(0.085, 0.08, 0.2), bottom, 0, -0.1, 0);
    const f = part(j['foot' + side], capsule(0.042, 0.13), shoes, 0, -0.005, 0.045);
    f.rotation.x = Math.PI / 2;
  }

  // garments
  if (s.dress || s.skirt) {
    const len = s.skirtLen ?? 0.55;
    part(j.hips, cyl(0.17, 0.3, len, 20, true), M(s.dress ?? s.bottom, 0.85, 0, { side: THREE.DoubleSide }), 0, 0.03 - len / 2, 0, 1, 1, 0.85);
    if (s.dress) {
      part(j.spine, capsule(0.132, 0.12), M(s.dress, 0.85), 0, 0.1, 0, 1.16, 1, 0.79);
      if (s.polka) {
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2, y = -0.12 - (i % 3) * 0.13;
          const r = 0.19 + (i % 3) * 0.04;
          part(j.hips, sphere(6), M('#f6f0e6', 0.8), Math.cos(a) * r, y, Math.sin(a) * r * 0.85, 0.018, 0.018, 0.006);
        }
      }
    }
  }
  if (s.coat) {
    const cm = M(s.coat, 0.9, 0, { side: THREE.DoubleSide });
    part(j.hips, cyl(0.18, 0.23, s.coatLen ?? 0.5, 20, true), cm, 0, 0.02 - (s.coatLen ?? 0.5) / 2, 0, 1, 1, 0.82);
    part(j.chest, capsule(0.155, 0.14), M(s.coat, 0.9), 0, 0.11, 0, 1.24, 1, 0.76);
    part(j.spine, capsule(0.135, 0.12), M(s.coat, 0.9), 0, 0.1, 0, 1.17, 1, 0.8);
    // lapels / buttons
    for (let i = 0; i < 3; i++) part(j.spine, sphere(6), M('#1a1a1a', 0.4), 0, 0.02 + i * 0.1, 0.108, 0.012, 0.012, 0.008);
  }
  if (s.jacket) {
    part(j.chest, capsule(0.156, 0.14), M(s.jacket, 0.8), 0, 0.12, 0, 1.23, 1, 0.74);
    part(j.spine, capsule(0.136, 0.12), M(s.jacket, 0.8), 0, 0.1, 0, 1.16, 1, 0.8);
    part(j.chest, box(0.02, 0.3, 0.01), M(s.jacketZip ?? '#111', 0.4), 0, 0.12, 0.112);
  }
  if (s.tie) part(j.chest, box(0.04, 0.26, 0.012), M(s.tie, 0.5), 0, 0.1, 0.11);
  if (s.shirtCollar) part(j.chest, box(0.1, 0.05, 0.012), M(s.shirtCollar, 0.7), 0, 0.26, 0.098);
  if (s.apron) part(j.spine, box(0.3, 0.55, 0.012), M(s.apron, 0.9), 0, -0.1, 0.115);
  if (s.suspenders) {
    part(j.chest, box(0.025, 0.36, 0.01), M(s.suspenders, 0.6), 0.07, 0.08, 0.105);
    part(j.chest, box(0.025, 0.36, 0.01), M(s.suspenders, 0.6), -0.07, 0.08, 0.105);
  }
  if (s.belt) part(j.hips, cyl(0.165, 0.165, 0.04, 20), M(s.belt, 0.5), 0, 0.06, 0, 1, 1, 0.68);
  if (s.bag) {
    const b = part(j.handL, box(0.22, 0.16, 0.07), M(s.bag, 0.5), 0, -0.17, 0);
    part(b, box(0.1, 0.1, 0.01), M(s.bag, 0.5), 0, 0.12, 0, 1, 1, 1);
  }
  if (s.satchel) part(j.spine, box(0.24, 0.2, 0.08), M(s.satchel, 0.6), 0.16, -0.05, 0.02);
  if (s.backpack) part(j.chest, box(0.28, 0.36, 0.14), M(s.backpack, 0.7), 0, 0.08, -0.17);
  if (s.cane) {
    const c = part(j.handR, cyl(0.012, 0.012, 0.92, 8), M('#3b2616', 0.5), 0, -0.44, 0.02);
    part(c, sphere(8), M('#3b2616', 0.5), 0, 0.46, 0, 0.022, 0.02, 0.05);
  }
  if (s.camera) part(j.chest, box(0.14, 0.1, 0.08), M('#111', 0.4, 0.3), 0, 0.02, 0.16);
  if (s.scarf) part(j.neck, G('scarf', () => new THREE.TorusGeometry(0.06, 0.028, 8, 16)), M(s.scarf, 0.95), 0, 0, 0, 1, 1, 1).rotation.x = Math.PI / 2;
}

function buildHair(head, s) {
  if (!s.hairStyle || s.hairStyle === 'none') return;
  const hm = M(s.hair, 0.9);
  if (s.hairStyle !== 'bald') {
    const cap = new THREE.Mesh(
      G('hairCap', () => new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)),
      hm,
    );
    cap.scale.set(0.106, 0.122, 0.114);
    cap.position.set(0, 0.085, -0.008);
    cap.rotation.x = -0.25;
    cap.castShadow = true;
    head.add(cap);
  } else {
    part(head, sphere(12), hm, 0, 0.06, -0.03, 0.1, 0.06, 0.09);
  }
  if (s.hairStyle === 'long') part(head, capsule(0.09, 0.18), hm, 0, -0.02, -0.05, 1.05, 1, 0.55);
  if (s.hairStyle === 'bun') part(head, sphere(12), hm, 0, 0.17, -0.07, 0.055, 0.05, 0.05);
  if (s.hairStyle === 'bob') part(head, sphere(16), hm, 0, 0.05, -0.012, 0.118, 0.1, 0.118);
  if (s.hairStyle === 'curly') {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      part(head, sphere(8), hm, Math.cos(a) * 0.085, 0.15 + Math.sin(i) * 0.02, Math.sin(a) * 0.085 - 0.01, 0.045, 0.045, 0.045);
    }
  }
}

function buildHat(head, s) {
  const y = 0.19;
  switch (s.hat) {
    case 'fedora': {
      const hm = M(s.hatColor ?? '#3a3530', 0.8);
      part(head, cyl(0.175, 0.175, 0.012, 24), hm, 0, y - 0.015, 0);
      part(head, cyl(0.095, 0.108, 0.1, 20), hm, 0, y + 0.04, 0);
      part(head, cyl(0.109, 0.109, 0.025, 20), M('#151515', 0.6), 0, y + 0.0, 0);
      break;
    }
    case 'cap': {
      const hm = M(s.hatColor ?? '#1f2a44', 0.7);
      part(head, cyl(0.118, 0.11, 0.07, 20), hm, 0, y - 0.005, 0);
      part(head, cyl(0.12, 0.12, 0.02, 20), M('#0b0b0b', 0.3), 0, y - 0.035, 0);
      const v = part(head, box(0.16, 0.012, 0.08), M('#0b0b0b', 0.3), 0, y - 0.04, 0.13);
      v.rotation.x = 0.25;
      if (s.hatBadge) part(head, sphere(8), M(s.hatBadge, 0.3, 0.8), 0, y, 0.115, 0.02, 0.02, 0.006);
      break;
    }
    case 'flatcap': {
      const hm = M(s.hatColor ?? '#5a4a3a', 0.95);
      part(head, sphere(16), hm, 0, y - 0.02, 0.01, 0.12, 0.05, 0.13);
      const v = part(head, box(0.15, 0.012, 0.07), hm, 0, y - 0.04, 0.12);
      v.rotation.x = 0.2;
      break;
    }
    case 'cloche': {
      const hm = M(s.hatColor ?? '#6b2a3a', 0.85);
      part(head, sphere(16), hm, 0, y - 0.03, 0, 0.118, 0.085, 0.122);
      part(head, cyl(0.14, 0.15, 0.012, 20), hm, 0, y - 0.06, 0.005);
      part(head, sphere(8), M('#f1c453', 0.5), 0.09, y - 0.02, 0.06, 0.02, 0.02, 0.02);
      break;
    }
    case 'baker': {
      const hm = M('#f5f3ee', 0.95);
      part(head, cyl(0.11, 0.105, 0.05, 20), hm, 0, y - 0.02, 0);
      part(head, sphere(16), hm, 0, y + 0.09, 0, 0.14, 0.1, 0.14);
      break;
    }
    case 'nurse': {
      const hm = M('#ffffff', 0.9);
      part(head, box(0.16, 0.06, 0.1), hm, 0, y, 0.02);
      part(head, box(0.03, 0.03, 0.005), M('#c62828', 0.6), 0, y + 0.005, 0.072);
      break;
    }
    case 'beret': {
      part(head, sphere(16), M(s.hatColor ?? '#1c1c1c', 0.9), 0.02, y - 0.02, 0, 0.13, 0.04, 0.13);
      break;
    }
    case 'beanie': {
      part(head, sphere(16), M(s.hatColor ?? '#b33a3a', 0.95), 0, y - 0.04, -0.005, 0.113, 0.09, 0.12);
      break;
    }
    case 'boater': {
      const hm = M('#e6d29a', 0.9);
      part(head, cyl(0.17, 0.17, 0.012, 24), hm, 0, y - 0.015, 0);
      part(head, cyl(0.1, 0.1, 0.06, 20), hm, 0, y + 0.02, 0);
      part(head, cyl(0.101, 0.101, 0.02, 20), M('#1d2c5a', 0.6), 0, y + 0.0, 0);
      break;
    }
    default:
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const SKINS = ['#f1c7a5', '#e0ac85', '#c68863', '#9a6444', '#6f4630', '#f6d5bf', '#d9a07a'];
const HAIRS = ['#2a1d15', '#4a3122', '#6b4a2b', '#a37a45', '#d9b56c', '#1a1a1a', '#7a3b22'];
const GREYS = ['#cfcfcf', '#b9b9b9', '#e6e6e6', '#9b9b9b'];
const TOPS = ['#2e5a88', '#8a2e3b', '#3f6b4a', '#d4a13a', '#4b4b58', '#c65d2e', '#6a4c93', '#1f7a7a', '#e2e2e2'];
const PANTS = ['#2b3140', '#1f2430', '#5a5040', '#3a3a3a', '#435a7a', '#6b5b45'];
const SHOES = ['#e8e8e8', '#1c1c1c', '#5a3a22', '#2b2b2b', '#c0392b'];

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];

export function modernStyle(rand, kind = 'adult') {
  const s = {
    kind,
    skin: pick(SKINS, rand),
    hair: kind === 'elderly' ? pick(GREYS, rand) : pick(HAIRS, rand),
    hairStyle: pick(kind === 'elderly' ? ['short', 'bob', 'bald', 'curly'] : ['short', 'long', 'bun', 'short', 'bob', 'curly'], rand),
    top: pick(TOPS, rand),
    bottom: pick(PANTS, rand),
    shoes: pick(SHOES, rand),
    scale: kind === 'child' ? 0.68 : kind === 'elderly' ? 0.96 : 0.96 + rand() * 0.1,
  };
  if (rand() < 0.55) s.jacket = pick(['#1d1f24', '#3c4b3a', '#7a2e2e', '#294a6b', '#c0892e', '#5b5b5b'], rand);
  if (kind === 'elderly') {
    if (rand() < 0.6) { s.coat = pick(['#5b4a3a', '#2f3a4a', '#6b6b6b', '#7a5a4a'], rand); s.coatLen = 0.45; }
    if (rand() < 0.5) s.cane = true;
    if (rand() < 0.5) s.glasses = true;
    if (rand() < 0.3) s.hat = pick(['flatcap', 'beret'], rand);
    if (rand() < 0.3) s.scarf = pick(['#8a2e3b', '#2e5a88', '#d4a13a'], rand);
  } else {
    if (rand() < 0.2) s.hat = 'beanie';
    if (rand() < 0.3) s.backpack = pick(['#111', '#2e5a88', '#8a2e3b', '#3f6b4a'], rand);
    if (rand() < 0.15) s.glasses = true;
  }
  if (kind === 'child') { s.backpack = pick(['#e63946', '#f1c453', '#2a9d8f'], rand); s.shorts = rand() < 0.3; }
  return s;
}

export const PLAYER_STYLE = {
  kind: 'adult',
  skin: '#e8b793', hair: '#3a2718', hairStyle: 'short',
  top: '#c9a24a', bottom: '#27303f', shoes: '#f2f2f2',
  jacket: '#1f5f63', jacketZip: '#f1c453', backpack: '#20252c', scale: 1.0,
};

/** Historical avatar roster for the screen. */
export const HISTORICAL = [
  {
    id: 'gentleman', sv: 'Herren med hatten', en: 'The gentleman in the fedora', era: '1944',
    skin: '#e9bf9d', hair: '#2a1d15', hairStyle: 'short', top: '#3b3f47', bottom: '#33373f', shoes: '#1a1210',
    coat: '#474b52', coatLen: 0.35, tie: '#7a1f2b', shirtCollar: '#f4f1ea', hat: 'fedora', hatColor: '#3d352c',
  },
  {
    id: 'lady', sv: 'Damen i kappa', en: 'The lady in the long coat', era: '1944',
    skin: '#f3cfb4', hair: '#6b3a22', hairStyle: 'bob', top: '#7b2d3a', bottom: '#7b2d3a', shoes: '#2a1510',
    coat: '#7b2d3a', coatLen: 0.62, hat: 'cloche', hatColor: '#2b2b3a', stockings: '#caa58b', bag: '#1b1b1b', skirt: true, skirtLen: 0.62, lips: '#b0323b', bust: true,
  },
  {
    id: 'conductor', sv: 'Spårvagnskonduktören', en: 'The tram conductor', era: '1944',
    skin: '#e3b08c', hair: '#3b2a1d', hairStyle: 'short', top: '#1f2a44', bottom: '#1f2a44', shoes: '#0e0e0e',
    jacket: '#1c2740', jacketZip: '#d4a13a', hat: 'cap', hatColor: '#1c2740', hatBadge: '#d4a13a', satchel: '#4a321d', belt: '#111',
  },
  {
    id: 'baker', sv: 'Bagaren', en: 'The baker from the corner shop', era: '1944',
    skin: '#f0c4a0', hair: '#7a5a3a', hairStyle: 'short', top: '#f5f3ee', bottom: '#d9d5cb', shoes: '#3a2a1a',
    apron: '#ffffff', hat: 'baker', shortSleeve: true, beard: false,
  },
  {
    id: 'dancer', sv: 'Dansösen från dansbanan', en: 'The dancer from the old dance hall', era: '1958',
    skin: '#f1c9a8', hair: '#c9923e', hairStyle: 'curly', top: '#c0283a', bottom: '#c0283a', shoes: '#c0283a',
    dress: '#c0283a', polka: true, skirtLen: 0.5, stockings: '#e8c3a8', lips: '#b0323b', bust: true, belt: '#111', shortSleeve: true,
  },
  {
    id: 'postman', sv: 'Brevbäraren', en: 'The postman on his round', era: '1958',
    skin: '#d99f7a', hair: '#2a1d15', hairStyle: 'short', top: '#2a4d7a', bottom: '#223a5c', shoes: '#111',
    hat: 'cap', hatColor: '#2a4d7a', hatBadge: '#f1c453', satchel: '#6b4423', cuffs: '#f1c453',
  },
  {
    id: 'schoolboy', sv: 'Skolpojken', en: 'The schoolboy with knee socks', era: '1944',
    skin: '#f4d0b0', hair: '#a37a45', hairStyle: 'short', top: '#5a6b7a', bottom: '#4a3f35', shoes: '#2a1a10',
    shorts: true, socks: '#8a8a8a', hat: 'flatcap', hatColor: '#6b5a4a', scale: 0.8, satchel: '#6b4423',
  },
  {
    id: 'worker', sv: 'Byggarbetaren', en: 'The builder who raised Guldheden', era: '1944',
    skin: '#d8a27d', hair: '#4a3122', hairStyle: 'short', top: '#e9e2cf', bottom: '#4a4a52', shoes: '#2b1d12',
    suspenders: '#3a2a1a', hat: 'flatcap', hatColor: '#3f3a33', shortSleeve: true, beard: true,
  },
  {
    id: 'nurse', sv: 'Sjuksköterskan', en: 'The nurse from Sahlgrenska', era: '1958',
    skin: '#eec3a2', hair: '#3b2a1d', hairStyle: 'bun', top: '#f7f7f7', bottom: '#f7f7f7', shoes: '#f0f0f0',
    dress: '#f7f7f7', skirtLen: 0.5, hat: 'nurse', stockings: '#e8d8c8', bust: true, belt: '#2a4d7a',
  },
  {
    id: 'photographer', sv: 'Fotografen', en: 'The newspaper photographer', era: '1958',
    skin: '#e0b08a', hair: '#1a1a1a', hairStyle: 'short', top: '#6b5a45', bottom: '#3a3530', shoes: '#1a1210',
    jacket: '#6b5a45', hat: 'beret', camera: true, glasses: true,
  },
  {
    id: 'grandma', sv: 'Mormor med kassen', en: 'Grandmother with her shopping bag', era: '1958',
    skin: '#f0c8a8', hair: '#d8d8d8', hairStyle: 'bun', top: '#3f5a4a', bottom: '#3f5a4a', shoes: '#2a1a10',
    coat: '#3f5a4a', coatLen: 0.62, skirt: true, skirtLen: 0.62, stockings: '#b89b86', bag: '#6b4423', glasses: true, scarf: '#a33a3a', bust: true,
  },
  {
    id: 'sailor', sv: 'Sjömannen på permis', en: 'The sailor on shore leave', era: '1944',
    skin: '#d49a74', hair: '#2a1d15', hairStyle: 'short', top: '#f4f4f4', bottom: '#1b2540', shoes: '#0e0e0e',
    shirtCollar: '#1b2540', hat: 'boater', scarf: '#1b2540',
  },
];

// ---------------------------------------------------------------------------
// Procedural animation layers (write into rig.target)
// ---------------------------------------------------------------------------

export function animIdle(rig, t, seed = 0) {
  const b = Math.sin(t * 1.6 + seed) * 0.02;
  rig.set('chest', b, 0, 0);
  rig.set('head', -b * 0.5, Math.sin(t * 0.37 + seed) * 0.15, 0);
  rig.set('uArmL', 0.04, 0, 0.09 + b);
  rig.set('uArmR', 0.04, 0, -0.09 - b);
  rig.set('fArmL', -0.15, 0, 0);
  rig.set('fArmR', -0.15, 0, 0);
  rig.set('hips', 0, 0, Math.sin(t * 0.5 + seed) * 0.02);
  if (rig.style.kind === 'elderly') {
    rig.add('spine', 0.12, 0, 0);
    rig.add('neck', -0.08, 0, 0);
    if (rig.style.cane) rig.set('uArmR', -0.25, 0, -0.1);
  }
}

export function animWalk(rig, phase, amount, run = false) {
  const a = amount * (run ? 1.35 : 1);
  const s = Math.sin(phase), c = Math.cos(phase);
  const sw = run ? 0.75 : 0.45;
  rig.set('thighL', -sw * s * a, 0, 0);
  rig.set('thighR', sw * s * a, 0, 0);
  rig.set('shinL', a * (0.1 + (run ? 1.1 : 0.65) * Math.max(0, c)), 0, 0);
  rig.set('shinR', a * (0.1 + (run ? 1.1 : 0.65) * Math.max(0, -c)), 0, 0);
  rig.set('footL', -0.15 * s * a, 0, 0);
  rig.set('footR', 0.15 * s * a, 0, 0);
  const arm = run ? 0.6 : 0.35;
  rig.set('uArmL', arm * s * a, 0, 0.08);
  rig.set('uArmR', -arm * s * a, 0, -0.08);
  rig.set('fArmL', -(run ? 1.3 : 0.3) * a, 0, 0);
  rig.set('fArmR', -(run ? 1.3 : 0.3) * a, 0, 0);
  rig.set('spine', (run ? 0.18 : 0.03) * a, 0.07 * s * a, 0);
  rig.set('hips', 0, -0.08 * s * a, 0);
  rig.offsetTarget.y = -Math.abs(c) * (run ? 0.05 : 0.025) * a;
  if (rig.style.kind === 'elderly') {
    rig.add('spine', 0.12, 0, 0);
    if (rig.style.cane) rig.set('uArmR', -0.3 - 0.15 * s, 0, -0.1);
  }
}

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
function envelope(t, dur, fade = 0.3) {
  return ease(Math.min(t / fade, (dur - t) / fade, 1));
}

export const GESTURES = {
  wave: { dur: 2.6, label: 'Vinka', en: 'Wave' },
  cheer: { dur: 2.2, label: 'Jubla', en: 'Cheer' },
  clap: { dur: 2.4, label: 'Klappa', en: 'Clap' },
  dance: { dur: 4.2, label: 'Dansa', en: 'Dance' },
  jump: { dur: 1.0, label: 'Hoppa', en: 'Jump' },
  bow: { dur: 2.4, label: 'Bocka', en: 'Bow' },
  airplane: { dur: 3.2, label: 'Flygplan', en: 'Airplane' },
  smoke: { dur: 3.6, label: 'Hand→mun', en: 'Hand-to-mouth (filter test)' },
};

/** Apply a gesture layer. Returns false when finished. */
export function animGesture(rig, name, t) {
  const g = GESTURES[name];
  if (!g || t > g.dur) return false;
  const e = envelope(t, g.dur);
  switch (name) {
    case 'wave': {
      rig.set('uArmR', -0.2 * e, 0, -2.5 * e - 0.09 * (1 - e));
      rig.set('fArmR', 0, 0, (-0.35 + 0.45 * Math.sin(t * 9)) * e);
      rig.set('head', 0, 0, -0.08 * e);
      break;
    }
    case 'cheer': {
      const p = 0.18 * Math.sin(t * 11);
      rig.set('uArmL', 0, 0, (2.75 + p) * e);
      rig.set('uArmR', 0, 0, -(2.75 + p) * e);
      rig.set('fArmL', 0, 0, 0.2 * e);
      rig.set('fArmR', 0, 0, -0.2 * e);
      rig.set('head', -0.25 * e, 0, 0);
      rig.offsetTarget.y = 0.05 * Math.abs(Math.sin(t * 5.5)) * e;
      break;
    }
    case 'clap': {
      const o = 0.5 + 0.5 * Math.sin(t * 14);
      rig.set('uArmL', -1.0 * e, 0, (-0.25 - 0.25 * o) * e + 0.09 * (1 - e));
      rig.set('uArmR', -1.0 * e, 0, (0.25 + 0.25 * o) * e - 0.09 * (1 - e));
      rig.set('fArmL', -0.95 * e, 0, 0);
      rig.set('fArmR', -0.95 * e, 0, 0);
      break;
    }
    case 'dance': {
      const s = Math.sin(t * 4.4), c = Math.cos(t * 4.4);
      rig.set('hips', 0, s * 0.35 * e, c * 0.08 * e);
      rig.set('spine', 0, -s * 0.2 * e, -c * 0.12 * e);
      rig.set('uArmL', -0.5 * e, 0, (1.2 + 0.8 * s) * e);
      rig.set('uArmR', -0.5 * e, 0, -(1.2 - 0.8 * s) * e);
      rig.set('fArmL', -1.3 * e, 0, 0);
      rig.set('fArmR', -1.3 * e, 0, 0);
      rig.set('thighL', -0.3 * Math.max(0, s) * e, 0, 0.05 * e);
      rig.set('thighR', -0.3 * Math.max(0, -s) * e, 0, -0.05 * e);
      rig.set('shinL', 0.5 * Math.max(0, s) * e, 0, 0);
      rig.set('shinR', 0.5 * Math.max(0, -s) * e, 0, 0);
      rig.set('head', 0, 0, s * 0.15 * e);
      rig.offsetTarget.y = -0.04 * Math.abs(c) * e;
      break;
    }
    case 'jump': {
      const d = g.dur;
      let y = 0, crouch = 0, up = 0;
      if (t < 0.2) crouch = t / 0.2;
      else if (t < 0.8) { const u = (t - 0.2) / 0.6; y = 4 * u * (1 - u) * 0.45; up = Math.sin(u * Math.PI); crouch = 0.3 * (1 - Math.sin(u * Math.PI)); }
      else crouch = 1 - (t - 0.8) / (d - 0.8);
      rig.offsetTarget.y = y - 0.14 * crouch;
      rig.set('thighL', -0.7 * crouch - 0.3 * up, 0, 0.05);
      rig.set('thighR', -0.7 * crouch - 0.3 * up, 0, -0.05);
      rig.set('shinL', 1.2 * crouch + 0.5 * up, 0, 0);
      rig.set('shinR', 1.2 * crouch + 0.5 * up, 0, 0);
      rig.set('spine', 0.3 * crouch, 0, 0);
      rig.set('uArmL', 0.3 * crouch, 0, 2.6 * up + 0.1);
      rig.set('uArmR', 0.3 * crouch, 0, -2.6 * up - 0.1);
      break;
    }
    case 'bow': {
      rig.set('spine', 0.75 * e, 0, 0);
      rig.set('head', 0.2 * e, 0, 0);
      rig.set('uArmR', -0.75 * e, 0, 0.25 * e - 0.09 * (1 - e));
      rig.set('fArmR', -1.55 * e, 0, 0);
      rig.set('uArmL', 0.25 * e, 0, 0.09);
      break;
    }
    case 'airplane': {
      const s = Math.sin(t * 2.4);
      rig.set('uArmL', 0, 0, 1.52 * e);
      rig.set('uArmR', 0, 0, -1.52 * e);
      rig.set('spine', 0.12 * e, 0, s * 0.3 * e);
      rig.set('hips', 0, s * 0.25 * e, 0);
      rig.set('head', 0, 0, -s * 0.15 * e);
      break;
    }
    case 'smoke': {
      rig.set('uArmR', -0.9 * e, 0, 0.35 * e - 0.09 * (1 - e));
      rig.set('fArmR', -2.3 * e, 0, 0);
      rig.set('handR', 0, 0, 0);
      rig.set('head', 0.08 * e, 0, 0);
      rig.set('uArmL', 0, 0, 0.35 * e);
      rig.set('fArmL', -1.2 * e, 0, 0);
      break;
    }
    default:
      return false;
  }
  return true;
}

/** Duo animations played by paired avatars on the screen. role: 0 or 1, t: seconds. */
export function animDuo(rig, type, role, t) {
  const side = role === 0 ? 1 : -1; // role 0 stands on the left of the pair
  switch (type) {
    case 'handshake': {
      const pump = Math.sin(t * 10) * 0.12;
      if (side > 0) {
        rig.set('uArmR', -0.9 + pump, 0, 0.25);
        rig.set('fArmR', -0.3, 0, 0);
      } else {
        rig.set('uArmR', -0.9 + pump, 0, 0.25);
        rig.set('fArmR', -0.3, 0, 0);
      }
      rig.set('head', 0.1, 0, 0);
      rig.set('spine', 0.1, 0, 0);
      break;
    }
    case 'swing': {
      const s = Math.sin(t * 5), c = Math.cos(t * 5);
      rig.set('uArmL', -0.6, 0, 0.9 + 0.3 * s);
      rig.set('uArmR', -0.6, 0, -0.9 + 0.3 * s);
      rig.set('fArmL', -0.4, 0, 0);
      rig.set('fArmR', -0.4, 0, 0);
      rig.set('thighL', -0.4 * Math.max(0, s), 0, 0);
      rig.set('thighR', -0.4 * Math.max(0, -s), 0, 0);
      rig.set('shinL', 0.6 * Math.max(0, s), 0, 0);
      rig.set('shinR', 0.6 * Math.max(0, -s), 0, 0);
      rig.set('hips', 0, 0, c * 0.08);
      rig.offsetTarget.y = 0.05 * Math.abs(s);
      break;
    }
    case 'hattip': {
      rig.set('spine', 0.35 * Math.max(0, Math.sin(t * 1.6)), 0, 0);
      rig.set('uArmR', -0.4, 0, -2.2);
      rig.set('fArmR', -1.5, 0, 0);
      rig.set('uArmL', 0, 0, 0.1);
      break;
    }
    default:
  }
}

/** Seated on a bench (seat height 0.45 m), hands resting in the lap. */
export function animSit(rig, t, seed = 0) {
  const s = rig.style.scale ?? 1;
  rig.offsetTarget.set(0, 0.47 / s - 0.93, 0);
  rig.set('thighL', -1.5, 0, 0.06);
  rig.set('thighR', -1.5, 0, -0.06);
  rig.set('shinL', 1.45, 0, 0);
  rig.set('shinR', 1.45, 0, 0);
  rig.set('footL', 0.05, 0, 0);
  rig.set('footR', 0.05, 0, 0);
  rig.set('spine', -0.06 + (rig.style.kind === 'elderly' ? 0.1 : 0), 0, 0);
  rig.set('chest', Math.sin(t * 1.6 + seed) * 0.02, 0, 0);
  rig.set('uArmL', -0.45, 0, 0.12);
  rig.set('uArmR', -0.45, 0, -0.12);
  rig.set('fArmL', -0.75, 0, 0);
  rig.set('fArmR', -0.75, 0, 0);
  rig.set('head', 0.05, Math.sin(t * 0.3 + seed) * 0.35, 0);
}
