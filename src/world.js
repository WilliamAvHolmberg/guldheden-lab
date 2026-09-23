import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  rng, toTexture, pavingTextures, flagstoneTextures, cobbleTextures, stuccoTexture,
  roofTileTexture, slateTexture, produceTexture, grassTexture, asphaltTexture, woodTexture,
  posterTexture, signTexture,
} from './textures.js';

// World layout (metres). X = east, Z = south, Y = up.
// The long three-storey building runs along the east side (facade at x = 21, facing west).
// The low slate-roofed building closes the north side (facade at z = -21, facing south).
// The chain bollards and cobbled street close the south side, trees the west side.
export const LAYOUT = {
  square: { x0: -24, x1: 21, z0: -21, z1: 16 },
  long: { x0: 21, x1: 33, z0: -22, z1: 26, h: 9.3 },
  low: { x0: -20, x1: 9, z0: -31, z1: -21, h: 3.6 },
  // Freestanding LED wall out on the square, facing the big street to the south so the audience
  // stands with their backs to the street. Installation geometry is built in a local frame where
  // the screen plane is x = 0 facing local -X, lateral axis = local Z; (cx, cz, rot) places it.
  screen: { cx: 0, cz: 2, rot: Math.PI / 2, x: 0, z0: -6, z1: 6, y0: 0.45, y1: 3.25 },
  chainZ: 15.2,
  gapX: 0,
};

const TMP = new THREE.Object3D();

// ---------------- screen frame helpers ----------------
const S_COS = Math.cos(LAYOUT.screen.rot), S_SIN = Math.sin(LAYOUT.screen.rot);

/** World position → installation-local (x < 0 is in front of the screen, z is lateral). */
export function toScreenLocal(p, out = new THREE.Vector3()) {
  const dx = p.x - LAYOUT.screen.cx, dz = p.z - LAYOUT.screen.cz;
  return out.set(dx * S_COS - dz * S_SIN, p.y ?? 0, dx * S_SIN + dz * S_COS);
}

/** Installation-local (lx, lz) → world. */
export function screenToWorld(lx, lz, y = 0, out = new THREE.Vector3()) {
  return out.set(LAYOUT.screen.cx + lx * S_COS + lz * S_SIN, y, LAYOUT.screen.cz - lx * S_SIN + lz * S_COS);
}

/** Local heading (0 = local +Z) → world heading. */
export const screenHeading = (localHeading) => localHeading + LAYOUT.screen.rot;

/** World heading that makes someone at pos look at the screen (slightly towards its middle). */
export function headingToScreen(pos) {
  const l = toScreenLocal(pos);
  const target = screenToWorld(0, l.z * 0.4);
  return Math.atan2(target.x - pos.x, target.z - pos.z);
}

/** Is a world position inside the pose sensors' field of view? */
export function inSensorZone(pos) {
  const l = toScreenLocal(pos, _zl);
  const d = -l.x;
  if (d < 0.3 || d > 11.5) return false;
  return Math.abs(l.z) < Math.min(6.5 + d * 0.55, 11);
}
const _zl = new THREE.Vector3();

/** Distance in front of the screen (negative = behind it) and lateral offset. */
export function screenOffset(pos) {
  const l = toScreenLocal(pos, _zl);
  return { d: -l.x, lateral: l.z };
}

/** BoxGeometry with UVs scaled so the texture maps in world metres (tile = metres per texture). */
export function boxUV(w, h, d, tile = 4) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tile);
    }
  }
  return g;
}

function planeUV(w, h, tile) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * h / tile);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Hipped roof with the ridge along Z. width = X extent, depth = Z extent. */
export function hipRoof(width, depth, height, tile = 4) {
  const hw = width / 2, hd = depth / 2, inset = Math.min(hw, hd);
  const pos = [], uvs = [];
  const slopeSide = Math.hypot(height, hw), slopeEnd = Math.hypot(height, inset);
  const tri = (a, b, c, ua, ub, uc) => { pos.push(...a, ...b, ...c); uvs.push(...ua, ...ub, ...uc); };
  // +X side
  let A = [hw, 0, hd], B = [hw, 0, -hd], C = [0, height, -hd + inset], D = [0, height, hd - inset];
  let uA = [0, 0], uB = [depth / tile, 0], uC = [(depth - inset) / tile, slopeSide / tile], uD = [inset / tile, slopeSide / tile];
  tri(A, B, C, uA, uB, uC); tri(A, C, D, uA, uC, uD);
  // -X side
  A = [-hw, 0, -hd]; B = [-hw, 0, hd]; C = [0, height, hd - inset]; D = [0, height, -hd + inset];
  tri(A, B, C, uA, uB, uC); tri(A, C, D, uA, uC, uD);
  // +Z end
  tri([-hw, 0, hd], [hw, 0, hd], [0, height, hd - inset], [0, 0], [width / tile, 0], [hw / tile, slopeEnd / tile]);
  // -Z end
  tri([hw, 0, -hd], [-hw, 0, -hd], [0, height, -hd + inset], [0, 0], [width / tile, 0], [hw / tile, slopeEnd / tile]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/** Collects many boxes/cylinders per material and turns them into InstancedMeshes. */
class Batch {
  constructor() { this.sets = new Map(); }
  add(geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
    const key = geo.uuid + mat.uuid;
    if (!this.sets.has(key)) this.sets.set(key, { geo, mat, list: [] });
    TMP.position.set(x, y, z);
    TMP.rotation.set(rx, ry, rz);
    TMP.scale.set(sx, sy, sz);
    TMP.updateMatrix();
    this.sets.get(key).list.push(TMP.matrix.clone());
  }
  build(parent, cast = true, receive = true) {
    for (const { geo, mat, list } of this.sets.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = cast;
      im.receiveShadow = receive;
      im.computeBoundingSphere();
      parent.add(im);
    }
  }
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 16);

// --- simple 3D value noise for tree canopies ---
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const h = hash3(xi + dx, yi + dy, zi + dz);
    r += h * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r;
}

function blobGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = vnoise(v.x * 2.2 + seed, v.y * 2.2, v.z * 2.2) * 0.35 + vnoise(v.x * 5 + seed, v.y * 5, v.z * 5) * 0.15;
    v.multiplyScalar(0.8 + n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildWorld(scene, renderer) {
  const obstacles = [];
  const addBox = (x0, x1, z0, z1) => obstacles.push({ t: 'box', x0, x1, z0, z1 });
  const addCircle = (x, z, r) => obstacles.push({ t: 'circle', x, z, r });

  const rand = rng(1234);
  const root = new THREE.Group();
  scene.add(root);
  const batch = new Batch();

  // ---------------- materials ----------------
  const pav = pavingTextures(), flag = flagstoneTextures(), cob = cobbleTextures();
  const matPaving = new THREE.MeshStandardMaterial({ map: toTexture(pav.map), bumpMap: toTexture(pav.bump, { srgb: false }), bumpScale: 1.2, roughness: 0.92 });
  const matFlag = new THREE.MeshStandardMaterial({ map: toTexture(flag.map), bumpMap: toTexture(flag.bump, { srgb: false }), bumpScale: 2.0, roughness: 0.85 });
  const matCobble = new THREE.MeshStandardMaterial({ map: toTexture(cob.map), bumpMap: toTexture(cob.bump, { srgb: false }), bumpScale: 2.5, roughness: 0.88 });
  const matGrass = new THREE.MeshStandardMaterial({ map: toTexture(grassTexture()), roughness: 1 });
  const matAsphalt = new THREE.MeshStandardMaterial({ map: toTexture(asphaltTexture()), roughness: 0.95 });
  const matStucco = new THREE.MeshStandardMaterial({ map: toTexture(stuccoTexture()), roughness: 0.95 });
  const matStuccoWhite = new THREE.MeshStandardMaterial({ map: toTexture(stuccoTexture([236, 230, 214], 8)), roughness: 0.95 });
  const matStuccoTower = new THREE.MeshStandardMaterial({ map: toTexture(stuccoTexture([218, 205, 168], 12)), roughness: 0.95 });
  const matStuccoOchre = new THREE.MeshStandardMaterial({ map: toTexture(stuccoTexture([214, 150, 92], 15)), roughness: 0.95 });
  const matRoof = new THREE.MeshStandardMaterial({ map: toTexture(roofTileTexture()), roughness: 0.8, side: THREE.DoubleSide });
  const matSlate = new THREE.MeshStandardMaterial({ map: toTexture(slateTexture()), roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide });
  const matGlass = new THREE.MeshStandardMaterial({ color: '#1a2430', roughness: 0.06, metalness: 0.6, envMapIntensity: 1.3 });
  const matGlassLit = new THREE.MeshStandardMaterial({ color: '#1a2430', roughness: 0.06, metalness: 0.6, emissive: '#ffcf8a', emissiveIntensity: 0 });
  const matFrame = new THREE.MeshStandardMaterial({ color: '#4a3f38', roughness: 0.6 });
  const matFrameWhite = new THREE.MeshStandardMaterial({ color: '#f2efe8', roughness: 0.6 });
  const matMint = new THREE.MeshStandardMaterial({ color: '#8fd6bd', roughness: 0.6 });
  const matDark = new THREE.MeshStandardMaterial({ color: '#23262a', roughness: 0.5 });
  const matTeal = new THREE.MeshStandardMaterial({ color: '#1f8f7e', roughness: 0.6 });
  const matPlinth = new THREE.MeshStandardMaterial({ color: '#8e867a', roughness: 0.9 });
  const matBlackMetal = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.4, metalness: 0.6 });
  const matConcrete = new THREE.MeshStandardMaterial({ color: '#7f7b73', roughness: 0.95 });
  const matGranite = new THREE.MeshStandardMaterial({ color: '#8d8d8a', roughness: 0.8 });
  const matBrick = new THREE.MeshStandardMaterial({ color: '#8a3a2a', roughness: 0.9 });
  const matWood = new THREE.MeshStandardMaterial({ map: toTexture(woodTexture()), roughness: 0.8 });
  const matTrunk = new THREE.MeshStandardMaterial({ color: '#4a3d33', roughness: 1 });
  const produceMats = [1, 2, 3].map((s) => new THREE.MeshStandardMaterial({ map: toTexture(produceTexture(s), { wrap: false }), roughness: 0.35, metalness: 0.0 }));
  const globeMat = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.3, emissive: '#ffe2b0', emissiveIntensity: 0.05 });

  // ---------------- ground ----------------
  const ground = new THREE.Mesh(planeUV(600, 600, 6), matAsphalt);
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  root.add(ground);

  const addGround = (mat, x0, x1, z0, z1, tile, y) => {
    const m = new THREE.Mesh(planeUV(x1 - x0, z1 - z0, tile), mat);
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  // grass & tree area to the west, courtyards
  addGround(matGrass, -70, -24, -60, 16, 5, 0.0);
  addGround(matGrass, 33, 70, -60, 16, 5, 0.0);
  addGround(matGrass, -24, -2, -60, -31, 5, 0.0);
  // the square itself
  const S = LAYOUT.square;
  addGround(matPaving, S.x0, S.x1, S.z0, S.z1, 3.2, 0.005);
  addGround(matPaving, 14, 21, -46, S.z0, 3.2, 0.005); // north path
  addGround(matPaving, -34, S.x0, -21, 16, 3.2, 0.004); // west sidewalk under trees
  // flagstone patches
  for (const [x0, x1] of [[-21.5, -10], [-7.5, 3.5], [6, 17.5]]) {
    for (const [z0, z1] of [[-18, -7.5], [-5, 12.5]]) addGround(matFlag, x0, x1, z0, z1, 4, 0.012);
  }
  // cobbled street to the south
  addGround(matCobble, -70, 70, 16.4, 27, 1.6, 0.006);
  // curb
  batch.add(UNIT_BOX, matGranite, (S.x0 + S.x1) / 2 - 5, 0.04, 16.2, S.x1 - S.x0 + 10, 0.08, 0.35);

  // ---------------- long building (east) ----------------
  const L = LAYOUT.long;
  const LW = L.x1 - L.x0, LD = L.z1 - L.z0, LCX = (L.x0 + L.x1) / 2, LCZ = (L.z0 + L.z1) / 2;
  const long = new THREE.Mesh(boxUV(LW, L.h, LD, 4), matStucco);
  long.position.set(LCX, L.h / 2, LCZ);
  long.castShadow = long.receiveShadow = true;
  root.add(long);
  batch.add(UNIT_BOX, matPlinth, LCX, 0.2, LCZ, LW + 0.06, 0.4, LD + 0.06);
  batch.add(UNIT_BOX, matStucco, L.x0 - 0.06, 3.55, LCZ, 0.14, 0.16, LD + 0.1); // cornice band
  const roof = new THREE.Mesh(hipRoof(LW + 1.0, LD + 1.0, 3.0), matRoof);
  roof.position.set(LCX, L.h, LCZ);
  roof.castShadow = roof.receiveShadow = true;
  root.add(roof);
  batch.add(UNIT_CYL, matDark, L.x0 - 0.45, L.h - 0.05, LCZ, 0.08, LD + 1, 0.08, 0, Math.PI / 2);
  for (const [cx, cz] of [[26, -14], [28, -3], [26, 9], [28, 19]]) {
    batch.add(UNIT_BOX, matBrick, cx, L.h + 2.0, cz, 0.7, 2.4, 0.9);
    batch.add(UNIT_BOX, matDark, cx, L.h + 3.25, cz, 0.85, 0.1, 1.05);
  }
  for (const z of [-21.5, -8.2, 7.2, 25.5]) batch.add(UNIT_CYL, matDark, L.x0 - 0.12, L.h / 2, z, 0.05, L.h, 0.05);

  const facadeX = L.x0;
  const frameBox = (x, y, z, w, h, mat = matFrame, t = 0.07, depth = 0.1) => {
    batch.add(UNIT_BOX, mat, x, y + h / 2, z, depth, t, w + t); // top
    batch.add(UNIT_BOX, mat, x, y - h / 2, z, depth, t, w + t); // bottom
    batch.add(UNIT_BOX, mat, x, y, z - w / 2, depth, h, t);
    batch.add(UNIT_BOX, mat, x, y, z + w / 2, depth, h, t);
  };
  const litWindows = [];
  for (let i = 0; i < 12; i++) {
    const zc = L.z0 + 2 + i * 4;
    // ground floor shopfronts (bays 4-6 are replaced by the LED wall)
    {
      const w = 3.4, h = 2.7, yc = 0.45 + h / 2;
      frameBox(facadeX - 0.05, yc, zc, w, h, matDark, 0.12, 0.14);
      const kind = i === 2 || i === 5 || i === 9 ? 'door' : i === 7 || i === 8 ? 'teal' : 'produce';
      if (kind === 'produce') {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), produceMats[i % 3]);
        p.position.set(facadeX - 0.03, yc, zc);
        p.rotation.y = -Math.PI / 2;
        p.receiveShadow = true;
        root.add(p);
      } else if (kind === 'teal') {
        batch.add(UNIT_BOX, matTeal, facadeX - 0.04, yc, zc, 0.04, h, w);
        for (let g = -1; g <= 1; g++) batch.add(UNIT_BOX, matDark, facadeX - 0.065, yc, zc + g * 0.9, 0.01, h, 0.03);
      } else {
        batch.add(UNIT_BOX, matGlass, facadeX - 0.03, yc, zc - 0.6, 0.04, h, 2.0);
        batch.add(UNIT_BOX, matDark, facadeX - 0.04, yc - 0.15, zc + 1.1, 0.06, h - 0.3, 1.0);
        batch.add(UNIT_BOX, matFrame, facadeX - 0.07, yc, zc + 0.4, 0.05, h, 0.06);
        batch.add(UNIT_BOX, matGlass, facadeX - 0.07, yc + 0.3, zc + 1.1, 0.02, 1.2, 0.6);
      }
      batch.add(UNIT_BOX, matPlinth, facadeX - 0.1, 0.25, zc, 0.12, 0.4, w + 0.2);
    }
    // upper floors
    for (let f = 0; f < 2; f++) {
      const y = 3.5 + f * 2.9 + 1.45;
      for (const [dz, w] of [[-0.9, 1.5], [1.2, 0.8]]) {
        const z = zc + dz, h = 1.3;
        const lit = rand() < 0.35;
        const gm = lit ? matGlassLit : matGlass;
        batch.add(UNIT_BOX, gm, facadeX - 0.01, y, z, 0.03, h, w);
        if (lit) litWindows.push([facadeX - 0.02, y, z, w, h]);
        frameBox(facadeX - 0.04, y, z, w, h, matFrame, 0.07, 0.08);
        batch.add(UNIT_BOX, matFrame, facadeX - 0.04, y, z, 0.08, h, 0.05);
        batch.add(UNIT_BOX, matPlinth, facadeX - 0.09, y - h / 2 - 0.05, z, 0.16, 0.05, w + 0.15);
        if (w > 1 && (i + f) % 3 === 1) {
          // Juliet balcony railing
          batch.add(UNIT_BOX, matBlackMetal, facadeX - 0.25, y - 0.2, z, 0.03, 0.03, w + 0.1);
          batch.add(UNIT_BOX, matBlackMetal, facadeX - 0.25, y - 0.62, z, 0.03, 0.03, w + 0.1);
          for (let k = 0; k <= 8; k++) batch.add(UNIT_BOX, matBlackMetal, facadeX - 0.25, y - 0.41, z - w / 2 + (k / 8) * w, 0.02, 0.42, 0.02);
          for (const s of [-1, 1]) batch.add(UNIT_BOX, matBlackMetal, facadeX - 0.13, y - 0.41, z + s * (w / 2 + 0.05), 0.22, 0.03, 0.03);
        }
      }
    }
  }
  // end walls get a few windows too
  for (let f = 0; f < 3; f++) for (const x of [24, 27, 30]) {
    batch.add(UNIT_BOX, matGlass, x, 1.8 + f * 2.9 + (f ? 0.3 : 0), L.z1 + 0.01, 1.2, 1.3, 0.03);
    batch.add(UNIT_BOX, matGlass, x, 1.8 + f * 2.9 + (f ? 0.3 : 0), L.z0 - 0.01, 1.2, 1.3, 0.03);
  }
  addBox(L.x0 - 0.15, L.x1, L.z0, L.z1);

  // ---------------- low building (north) with slate roof & triangular dormers ----------------
  const B = LAYOUT.low;
  const BW = B.x1 - B.x0, BD = B.z1 - B.z0, BCX = (B.x0 + B.x1) / 2, BCZ = (B.z0 + B.z1) / 2;
  const low = new THREE.Mesh(boxUV(BW, B.h, BD, 4), matStuccoWhite);
  low.position.set(BCX, B.h / 2, BCZ);
  low.castShadow = low.receiveShadow = true;
  root.add(low);
  batch.add(UNIT_BOX, matPlinth, BCX, 0.2, BCZ, BW + 0.06, 0.4, BD + 0.06);
  const slate = new THREE.Mesh(hipRoof(BD + 1.2, BW + 1.2, 5.0), matSlate);
  slate.rotation.y = Math.PI / 2;
  slate.position.set(BCX, B.h, BCZ);
  slate.castShadow = slate.receiveShadow = true;
  root.add(slate);
  // dormers on the south slope
  const triShape = new THREE.Shape([new THREE.Vector2(-0.75, 0), new THREE.Vector2(0.75, 0), new THREE.Vector2(0, 1.15)]);
  const dormerGeo = new THREE.ExtrudeGeometry(triShape, { depth: 1.8, bevelEnabled: false });
  const innerShape = new THREE.Shape([new THREE.Vector2(-0.52, 0.12), new THREE.Vector2(0.52, 0.12), new THREE.Vector2(0, 0.88)]);
  const innerGeo = new THREE.ShapeGeometry(innerShape);
  const eaveZ = B.z1 + 0.6, ridgeZ = BCZ;
  const slopeY = (z) => B.h + ((eaveZ - z) / (eaveZ - ridgeZ)) * 5.0;
  for (const x of [-15.5, -9.8, -4, 1.8, 7.0]) {
    const zf = B.z1 - 1.0;
    const d = new THREE.Mesh(dormerGeo, matMint);
    d.position.set(x, slopeY(zf) - 0.05, zf - 1.8);
    d.castShadow = true;
    root.add(d);
    const glass = new THREE.Mesh(innerGeo, new THREE.MeshStandardMaterial({ color: '#f4f4ef', roughness: 0.4 }));
    glass.position.set(x, slopeY(zf) - 0.05, zf + 0.005);
    root.add(glass);
    const pane = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.4, 0.2), new THREE.Vector2(0.4, 0.2), new THREE.Vector2(0, 0.76)])), matGlass);
    pane.position.set(x, slopeY(zf) - 0.05, zf + 0.01);
    root.add(pane);
  }
  // facade: windows, arched door, shop windows
  const bf = B.z1;
  for (let k = 0; k < 9; k++) {
    const x = B.x0 + 2 + k * 3.1;
    if (k === 1) {
      // arched door
      batch.add(UNIT_BOX, matWood, x, 1.1, bf + 0.02, 1.2, 2.2, 0.06);
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 20, 1, false, -Math.PI / 2, Math.PI), matWood);
      arch.rotation.x = Math.PI / 2;
      arch.position.set(x, 2.2, bf + 0.02);
      root.add(arch);
      batch.add(UNIT_BOX, matFrameWhite, x, 1.1, bf + 0.03, 1.4, 2.3, 0.02);
      continue;
    }
    const w = k % 3 === 0 ? 2.2 : 1.6, h = k % 3 === 0 ? 2.1 : 1.4, y = k % 3 === 0 ? 1.45 : 1.8;
    batch.add(UNIT_BOX, matGlass, x, y, bf + 0.01, w, h, 0.03);
    batch.add(UNIT_BOX, matFrameWhite, x, y + h / 2, bf + 0.04, w + 0.1, 0.07, 0.06);
    batch.add(UNIT_BOX, matFrameWhite, x, y - h / 2, bf + 0.04, w + 0.1, 0.07, 0.06);
    batch.add(UNIT_BOX, matFrameWhite, x - w / 2, y, bf + 0.04, 0.07, h, 0.06);
    batch.add(UNIT_BOX, matFrameWhite, x + w / 2, y, bf + 0.04, 0.07, h, 0.06);
    batch.add(UNIT_BOX, matFrameWhite, x, y, bf + 0.04, 0.05, h, 0.05);
  }
  addBox(B.x0, B.x1, B.z0, B.z1 + 0.1);
  // street name sign
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.32), new THREE.MeshStandardMaterial({ map: signTexture('GULDHEDSTORGET', { bg: '#1c4f9c', fg: '#ffffff', font: 'bold 60px Helvetica, Arial' }), roughness: 0.4 }));
  sign.position.set(B.x0 + 1.4, 3.05, bf + 0.03);
  root.add(sign);
  // planters with shrubs in front of the low building
  const shrubGeo = blobGeometry(3.3);
  const shrubMats = ['#3f5f2e', '#4d6b35', '#5a6e2d'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  for (let k = 0; k < 6; k++) {
    const x = B.x0 + 4.5 + k * 4.4;
    batch.add(UNIT_BOX, matConcrete, x, 0.25, bf + 0.9, 2.2, 0.5, 0.7);
    for (let s = 0; s < 3; s++) {
      const m = new THREE.Mesh(shrubGeo, shrubMats[(k + s) % 3]);
      m.position.set(x - 0.7 + s * 0.7, 0.75, bf + 0.9);
      m.scale.set(0.45, 0.35, 0.35);
      m.castShadow = true;
      root.add(m);
    }
    addBox(x - 1.1, x + 1.1, bf + 0.55, bf + 1.25);
  }

  // dark glass entrance vestibule between the buildings
  batch.add(UNIT_BOX, matGlass, 11.5, 1.6, -23.5, 5, 3.2, 5);
  batch.add(UNIT_BOX, matDark, 11.5, 3.3, -23.3, 5.6, 0.25, 5.8);
  addBox(9, 14, -26, -21);

  // ---------------- tower behind ----------------
  const tower = new THREE.Mesh(boxUV(14, 27, 12, 4), matStuccoTower);
  tower.position.set(5, 13.5, -40);
  tower.castShadow = tower.receiveShadow = true;
  root.add(tower);
  batch.add(UNIT_BOX, matPlinth, 5, 27.3, -40, 14.3, 0.6, 12.3);
  batch.add(UNIT_BOX, matStuccoTower, 3, 28.5, -41, 4, 2, 4);
  for (let r = 0; r < 9; r++) for (let c = 0; c < 6; c++) {
    const y = 1.8 + r * 3;
    batch.add(UNIT_BOX, rand() < 0.3 ? matGlassLit : matGlass, -1.5 + c * 2.3, y, -33.98, 1.3, 1.4, 0.03);
    batch.add(UNIT_BOX, matPlinth, -1.5 + c * 2.3, y - 0.75, -33.93, 1.45, 0.06, 0.12);
  }
  for (let r = 0; r < 9; r++) for (let c = 0; c < 5; c++) {
    batch.add(UNIT_BOX, matGlass, -2.02, 1.8 + r * 3, -44.5 + c * 2.3, 0.03, 1.4, 1.3);
    batch.add(UNIT_BOX, matGlass, 12.02, 1.8 + r * 3, -44.5 + c * 2.3, 0.03, 1.4, 1.3);
  }
  addBox(-2, 12, -46, -34);

  // ---------------- background buildings ----------------
  const bg = (x, z, w, d, h, mat, roofH, rot = false) => {
    const m = new THREE.Mesh(boxUV(w, h, d, 4), mat);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    if (roofH) {
      const r = new THREE.Mesh(hipRoof(rot ? d + 0.8 : w + 0.8, rot ? w + 0.8 : d + 0.8, roofH), matRoof);
      if (rot) r.rotation.y = Math.PI / 2;
      r.position.set(x, h, z);
      r.castShadow = true;
      root.add(r);
    }
    for (let yy = 1.8; yy < h - 1; yy += 3) for (let xx = x - w / 2 + 1.5; xx < x + w / 2 - 1; xx += 2.6) {
      batch.add(UNIT_BOX, matGlass, xx, yy, z + d / 2 + 0.01, 1.2, 1.35, 0.03);
    }
    addBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2);
  };
  bg(-15, -47, 20, 11, 12.5, matStuccoOchre, 3.5, true);
  bg(-60, -8, 12, 34, 12, matStuccoTower, 3.5);
  bg(47, -2, 12, 40, 15, matStuccoOchre, 3.5);
  bg(-40, -48, 16, 10, 15, matStucco, 3.5, true);
  bg(28, -52, 18, 10, 18, matStuccoWhite, 0);

  // ---------------- trees ----------------
  const blobGeos = [blobGeometry(1.1), blobGeometry(7.7), blobGeometry(13.3)];
  const palettes = {
    green: ['#3e5a2a', '#4a6a30', '#556f34', '#35502a'],
    autumn: ['#b8752c', '#a4602a', '#c98f3a', '#8c6a2a', '#6b7a2e'],
  };
  const leafMatCache = new Map();
  const leafMat = (c) => {
    if (!leafMatCache.has(c)) leafMatCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
    return leafMatCache.get(c);
  };
  const tree = (x, z, s, autumn) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.34 * s, 3.4 * s, 10), matTrunk);
    trunk.position.y = 1.7 * s;
    trunk.castShadow = true;
    g.add(trunk);
    for (let b = 0; b < 3; b++) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.14 * s, 2.2 * s, 6), matTrunk);
      const a = (b / 3) * Math.PI * 2 + rand();
      br.position.set(Math.cos(a) * 0.5 * s, 3.8 * s, Math.sin(a) * 0.5 * s);
      br.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
      br.castShadow = true;
      g.add(br);
    }
    const n = 9 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const pal = rand() < autumn ? palettes.autumn : palettes.green;
      const m = new THREE.Mesh(blobGeos[i % 3], leafMat(pal[Math.floor(rand() * pal.length)]));
      const a = rand() * Math.PI * 2, rr = rand() * 2.0 * s;
      m.position.set(Math.cos(a) * rr, (4.4 + rand() * 2.6) * s, Math.sin(a) * rr);
      const sc = (1.4 + rand() * 1.1) * s;
      m.scale.set(sc, sc * 0.85, sc);
      m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    root.add(g);
    addCircle(x, z, 0.45 * s);
  };
  [
    [-27, -22, 1.25, 0.85], [-30, -12, 1.1, 0.2], [-27, -3, 1.0, 0.35], [-31, 6, 1.2, 0.15],
    [-27.5, 13, 0.9, 0.45], [-37, -2, 1.3, 0.1], [-38, -21, 1.1, 0.25], [-36, 18, 1.0, 0.3],
    [16.5, -30, 0.85, 0.4], [37, -14, 1.0, 0.2], [37, 10, 1.1, 0.25], [-12, -36, 1.0, 0.2],
    [25, -38, 0.9, 0.5], [-45, 10, 1.2, 0.2], [-46, -30, 1.3, 0.2], [23, 30, 0.9, 0.4],
  ].forEach(([x, z, s, a]) => tree(x, z, s, a));

  // ---------------- lamp posts ----------------
  const lamps = [];
  const globeGeo = new THREE.SphereGeometry(0.27, 24, 16);
  const lamp = (x, z) => {
    batch.add(UNIT_CYL, matBlackMetal, x, 0.25, z, 0.13, 0.5, 0.13);
    batch.add(UNIT_CYL, matBlackMetal, x, 0.55, z, 0.09, 0.15, 0.09);
    batch.add(UNIT_CYL, matBlackMetal, x, 2.4, z, 0.05, 3.7, 0.05);
    batch.add(UNIT_CYL, matBlackMetal, x, 4.1, z, 0.08, 0.1, 0.08);
    const g = new THREE.Mesh(globeGeo, globeMat);
    g.position.set(x, 4.42, z);
    root.add(g);
    lamps.push(new THREE.Vector3(x, 4.42, z));
    addCircle(x, z, 0.2);
  };
  [[-12, 12.2], [17.6, -10.8], [18.2, 10.8], [-16, -13.5], [1.5, -16], [-20, 4], [11, 13.2]].forEach(([x, z]) => lamp(x, z));
  const lampLights = [];
  for (const i of [0, 1, 2, 3]) {
    const l = new THREE.PointLight('#ffd9a0', 0, 18, 1.6);
    l.position.copy(lamps[i]).add(new THREE.Vector3(0, -0.3, 0));
    root.add(l);
    lampLights.push(l);
  }
  // poster on the front lamp post, facing the street
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.86), new THREE.MeshStandardMaterial({ map: toTexture(posterTexture(), { wrap: false }), roughness: 0.5 }));
  poster.position.set(-12, 2.9, 12.28);
  root.add(poster);
  batch.add(UNIT_BOX, matBlackMetal, -12, 2.9, 12.26, 0.66, 0.9, 0.01);
  // utility cabinet
  batch.add(UNIT_BOX, new THREE.MeshStandardMaterial({ color: '#5d6166', roughness: 0.5, metalness: 0.4 }), -10.6, 0.55, 12.6, 0.28, 1.1, 0.22);
  addCircle(-10.6, 12.6, 0.25);

  // ---------------- bollards & chains ----------------
  const posts = [];
  for (let x = -22; x <= 18; x += 4) posts.push(x);
  const chainLinks = [];
  const CZ = LAYOUT.chainZ;
  posts.forEach((x) => {
    batch.add(UNIT_CYL, matConcrete, x, 0.38, CZ, 0.15, 0.76, 0.15);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), matConcrete);
    cap.position.set(x, 0.76, CZ);
    cap.castShadow = true;
    root.add(cap);
    batch.add(UNIT_CYL, matGranite, x, 0.02, CZ, 0.3, 0.04, 0.3);
    addCircle(x, CZ, 0.2);
  });
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i], b = posts[i + 1];
    if (a < LAYOUT.gapX && b > LAYOUT.gapX) continue; // opening into the square
    const n = Math.round((b - a) / 0.07);
    for (let k = 0; k <= n; k++) {
      const u = k / n, x = a + (b - a) * u;
      const y = 0.62 - 0.22 * 4 * u * (1 - u);
      const slope = -0.22 * 4 * (1 - 2 * u) / (b - a);
      chainLinks.push([x, y, Math.atan(slope), k % 2]);
    }
    addBox(a, b, CZ - 0.08, CZ + 0.08);
  }
  const linkGeo = new THREE.TorusGeometry(0.03, 0.008, 6, 10);
  linkGeo.scale(1.6, 1, 1);
  const links = new THREE.InstancedMesh(linkGeo, matBlackMetal, chainLinks.length);
  chainLinks.forEach(([x, y, a, odd], i) => {
    TMP.position.set(x, y, CZ);
    TMP.rotation.set(odd ? Math.PI / 2 : 0, 0, a, 'ZXY');
    TMP.scale.set(1, 1, 1);
    TMP.updateMatrix();
    links.setMatrixAt(i, TMP.matrix);
  });
  links.castShadow = true;
  root.add(links);

  // ---------------- benches ----------------
  const bench = (x, z, ry) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    const slat = new THREE.BoxGeometry(1.8, 0.04, 0.11);
    for (let s = 0; s < 3; s++) {
      const m = new THREE.Mesh(slat, matWood);
      m.position.set(0, 0.45, -0.15 + s * 0.13);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    for (let s = 0; s < 2; s++) {
      const m = new THREE.Mesh(slat, matWood);
      m.position.set(0, 0.62 + s * 0.14, -0.26);
      m.rotation.x = -0.2;
      m.castShadow = true;
      g.add(m);
    }
    for (const lx of [-0.75, 0.75]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.45), matBlackMetal);
      leg.position.set(lx, 0.225, -0.05);
      leg.castShadow = true;
      g.add(leg);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.05), matBlackMetal);
      back.position.set(lx, 0.65, -0.27);
      g.add(back);
    }
    root.add(g);
    const c = Math.abs(Math.cos(ry)), s2 = Math.abs(Math.sin(ry));
    const hx = 0.95 * c + 0.3 * s2, hz = 0.95 * s2 + 0.3 * c;
    addBox(x - hx, x + hx, z - hz, z + hz);
  };
  bench(-13, -19.3, 0);
  bench(-4.5, -19.3, 0);
  bench(3.8, -19.3, 0);
  bench(-23, -6, Math.PI / 2);
  bench(-23, 2, Math.PI / 2);

  // ---------------- bicycles along the long building ----------------
  const bikeColors = ['#1c1c1c', '#7a1f2b', '#2e5a88', '#c9c9c9', '#3f6b4a', '#d4a13a', '#111'];
  const wheelGeo = new THREE.TorusGeometry(0.33, 0.02, 8, 28);
  const tube = (g, a, b, r, mat) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    m.castShadow = true;
    g.add(m);
  };
  const bikeMatCache = {};
  for (let i = 0; i < 14; i++) {
    if (rand() < 0.15) continue;
    const z = 7.6 + i * 0.85;
    const g = new THREE.Group();
    g.position.set(19.9 + rand() * 0.2, 0, z);
    g.rotation.y = Math.PI / 2 + (rand() - 0.5) * 0.15 + Math.PI;
    const col = bikeColors[Math.floor(rand() * bikeColors.length)];
    const fm = bikeMatCache[col] ?? (bikeMatCache[col] = new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0.5 }));
    for (const wz of [-0.52, 0.52]) {
      const w = new THREE.Mesh(wheelGeo, matBlackMetal);
      w.position.set(0, 0.34, wz);
      w.rotation.y = Math.PI / 2;
      w.castShadow = true;
      g.add(w);
    }
    const P = { rear: [0, 0.34, -0.52], front: [0, 0.34, 0.52], crank: [0, 0.3, -0.05], seat: [0, 0.82, -0.2], head: [0, 0.85, 0.35] };
    tube(g, P.rear, P.crank, 0.015, fm);
    tube(g, P.crank, P.seat, 0.018, fm);
    tube(g, P.rear, P.seat, 0.012, fm);
    tube(g, P.crank, P.head, 0.02, fm);
    tube(g, P.seat, P.head, 0.018, fm);
    tube(g, P.head, P.front, 0.016, fm);
    tube(g, [0, 0.95, 0.3], [0, 0.85, 0.35], 0.016, fm);
    tube(g, [-0.28, 0.98, 0.3], [0.28, 0.98, 0.3], 0.013, matBlackMetal);
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.25), matDark);
    saddle.position.set(0, 0.87, -0.22);
    g.add(saddle);
    if (rand() < 0.5) {
      const basket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.25), matBlackMetal);
      basket.position.set(0, 0.95, 0.55);
      g.add(basket);
    }
    g.rotation.z = (rand() - 0.5) * 0.08;
    root.add(g);
  }
  batch.add(UNIT_BOX, matBlackMetal, 20.2, 0.35, 13.5, 0.04, 0.04, 12);
  addBox(19.1, 21, 7.1, 19.5);

  // ---------------- fallen leaves ----------------
  const leafCount = 2600;
  const leafGeo = new THREE.PlaneGeometry(0.08, 0.055);
  leafGeo.rotateX(-Math.PI / 2);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide }), leafCount);
  const leafCols = ['#a5652a', '#c78a3c', '#8a4f22', '#d3a24a', '#6e4a2a', '#b3702e'].map((c) => new THREE.Color(c));
  for (let i = 0; i < leafCount; i++) {
    let x, z;
    const r = rand();
    if (r < 0.45) { x = -26 + rand() * 48; z = 14 + rand() * 9; } // along the curb and street
    else if (r < 0.7) { x = -34 + rand() * 12; z = -26 + rand() * 42; } // under the trees
    else { x = -24 + rand() * 45; z = -21 + rand() * 37; }
    TMP.position.set(x, 0.02 + rand() * 0.01, z);
    TMP.rotation.set((rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3);
    TMP.scale.setScalar(0.7 + rand() * 0.8);
    TMP.updateMatrix();
    leaves.setMatrixAt(i, TMP.matrix);
    leaves.setColorAt(i, leafCols[Math.floor(rand() * leafCols.length)]);
  }
  leaves.receiveShadow = true;
  root.add(leaves);

  batch.build(root);

  // ---------------- sky, clouds, lights ----------------
  const sky = new Sky();
  sky.scale.setScalar(4500);
  scene.add(sky);
  const envSky = new Sky();
  envSky.scale.setScalar(900);
  const envScene = new THREE.Scene();
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;

  const cloudMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
    uniforms: {
      time: { value: 0 },
      tint: { value: new THREE.Color('#ffffff') },
      shade: { value: new THREE.Color('#9aa4b4') },
      cover: { value: 0.46 },
      opacity: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform float time, cover, opacity;
      uniform vec3 tint, shade;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) {
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        if (d.y < 0.0) discard;
        vec2 uv = d.xz / (d.y + 0.15) * 0.9 + vec2(time * 0.006, time * 0.002);
        float n = fbm(vec3(uv * 1.3, time * 0.004));
        float c = smoothstep(cover, cover + 0.22, n);
        float n2 = fbm(vec3(uv * 1.3 + vec2(0.06, 0.09), time * 0.004));
        float lit = clamp(0.55 + (n - n2) * 4.0, 0.0, 1.0);
        vec3 col = mix(shade, tint, lit);
        float fade = smoothstep(0.0, 0.18, d.y);
        gl_FragColor = vec4(col, c * fade * opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), cloudMat);
  clouds.renderOrder = -1;
  scene.add(clouds);

  const hemi = new THREE.HemisphereLight('#cfe0ff', '#6a5a48', 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);
  sun.target.position.set(0, 0, -5);

  scene.fog = new THREE.Fog('#c9d6e6', 90, 480);

  const PRESETS = {
    day: {
      sun: new THREE.Vector3(-0.62, 0.55, 0.56), sunColor: '#fff2dc', sunI: 2.7, hemiSky: '#cfe0ff', hemiGround: '#6a5a48', hemiI: 0.6,
      turbidity: 4.5, rayleigh: 1.1, mie: 0.004, exposure: 0.5, fog: '#c7d4e4', cloudTint: '#ffffff', cloudShade: '#9aa6b8', cover: 0.44,
      lamps: 0, windows: 0, night: 0,
    },
    dusk: {
      sun: new THREE.Vector3(-0.9, 0.06, 0.42), sunColor: '#ffac66', sunI: 1.4, hemiSky: '#a8a8d8', hemiGround: '#4a3a38', hemiI: 0.45,
      turbidity: 9, rayleigh: 2.6, mie: 0.006, exposure: 0.7, fog: '#b8a0a0', cloudTint: '#ffb08a', cloudShade: '#6a5a78', cover: 0.5,
      lamps: 0.7, windows: 0.8, night: 0.5,
    },
    night: {
      sun: new THREE.Vector3(-0.8, -0.2, 0.4), moon: new THREE.Vector3(0.3, 0.8, 0.35), sunColor: '#9fb4ff', sunI: 0.28, hemiSky: '#34466e', hemiGround: '#1a1a22', hemiI: 0.22,
      turbidity: 2, rayleigh: 0.3, mie: 0.003, exposure: 1.15, fog: '#0f1522', cloudTint: '#39445a', cloudShade: '#141a26', cover: 0.5,
      lamps: 1, windows: 1, night: 1,
    },
  };

  const env = { mode: 'day', night: 0 };
  function setTimeOfDay(mode) {
    const p = PRESETS[mode];
    env.mode = mode;
    env.night = p.night;
    for (const s of [sky, envSky]) {
      const u = s.material.uniforms;
      u.turbidity.value = p.turbidity;
      u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = p.mie;
      u.mieDirectionalG.value = 0.8;
      u.sunPosition.value.copy(p.sun).normalize();
    }
    const lightDir = (p.moon ?? p.sun).clone().normalize();
    sun.position.copy(sun.target.position).addScaledVector(lightDir, 120);
    sun.color.set(p.sunColor);
    sun.intensity = p.sunI;
    hemi.color.set(p.hemiSky);
    hemi.groundColor.set(p.hemiGround);
    hemi.intensity = p.hemiI;
    renderer.toneMappingExposure = p.exposure;
    scene.fog.color.set(p.fog);
    cloudMat.uniforms.tint.value.set(p.cloudTint);
    cloudMat.uniforms.shade.value.set(p.cloudShade);
    cloudMat.uniforms.cover.value = p.cover;
    globeMat.emissiveIntensity = 0.05 + p.lamps * 6;
    lampLights.forEach((l) => { l.intensity = p.lamps * 14; });
    matGlassLit.emissiveIntensity = p.windows * 1.4;
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0, 0.1, 2000);
    scene.environment = envRT.texture;
    scene.environmentIntensity = mode === 'night' ? 0.12 : mode === 'dusk' ? 0.35 : 0.55;
  }
  setTimeOfDay('day');

  function update(dt, t, camera) {
    cloudMat.uniforms.time.value = t;
    clouds.position.copy(camera.position);
  }

  const buildings = [
    { x0: L.x0, x1: L.x1, z0: L.z0, z1: L.z1, h: L.h + 3 },
    { x0: B.x0, x1: B.x1, z0: B.z0, z1: B.z1, h: B.h + 5 },
    { x0: 9, x1: 14, z0: -26, z1: -21, h: 3.4 },
    { x0: -2, x1: 12, z0: -46, z1: -34, h: 28 },
  ];
  return { obstacles, buildings, lamps, setTimeOfDay, update, env, root };
}

/** Push a circle (x, z, r) out of all obstacles. Mutates pos. */
export function resolveCollisions(pos, r, obstacles) {
  for (const o of obstacles) {
    if (o.t === 'circle') {
      const dx = pos.x - o.x, dz = pos.z - o.z;
      const d = Math.hypot(dx, dz), m = o.r + r;
      if (d < m && d > 1e-5) { pos.x = o.x + (dx / d) * m; pos.z = o.z + (dz / d) * m; }
    } else {
      const cx = Math.max(o.x0, Math.min(pos.x, o.x1)), cz = Math.max(o.z0, Math.min(pos.z, o.z1));
      const dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz);
      if (d < r) {
        if (d > 1e-5) { pos.x = cx + (dx / d) * r; pos.z = cz + (dz / d) * r; }
        else {
          // centre is inside the box: push out along the shallowest axis
          const pen = [pos.x - o.x0, o.x1 - pos.x, pos.z - o.z0, o.z1 - pos.z];
          const i = pen.indexOf(Math.min(...pen));
          if (i === 0) pos.x = o.x0 - r; else if (i === 1) pos.x = o.x1 + r; else if (i === 2) pos.z = o.z0 - r; else pos.z = o.z1 + r;
        }
      }
    }
  }
}
