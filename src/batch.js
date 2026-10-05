import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Static batching: merges every plain Mesh below `root` that shares a material (and shadow flags)
 * into one mesh, so the square is drawn with tens of draw calls instead of over a thousand.
 * Only use it on things that never move again. Meshes with `userData.dynamic` are left alone,
 * as are InstancedMesh, Sprites, Points and Lines.
 */
export function staticBatch(root) {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const victims = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.userData.dynamic || !o.visible) return;
    if (Array.isArray(o.material)) return;
    let skip = false;
    for (let p = o.parent; p && p !== root; p = p.parent) if (p.userData.dynamic || !p.visible) skip = true;
    if (skip) return;
    const g = o.geometry;
    const attrs = Object.keys(g.attributes).sort().join(',');
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}|${attrs}`;
    if (!groups.has(key)) groups.set(key, { material: o.material, cast: o.castShadow, receive: o.receiveShadow, renderOrder: o.renderOrder, list: [] });
    const geo = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld));
    for (const name of Object.keys(geo.morphAttributes)) delete geo.morphAttributes[name];
    groups.get(key).list.push(geo);
    victims.push(o);
  });
  for (const o of victims) o.removeFromParent();
  let merged = 0;
  for (const { material, cast, receive, renderOrder, list } of groups.values()) {
    const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!geo) continue;
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.renderOrder = renderOrder;
    m.matrixAutoUpdate = false;
    root.add(m);
    merged++;
  }
  return { before: victims.length, after: merged };
}
