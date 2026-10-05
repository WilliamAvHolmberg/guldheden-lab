import * as THREE from 'three';
import { Rig, modernStyle, animIdle, animWalk, animGesture, animSit, GESTURES } from './character.js';
import { resolveCollisions, LAYOUT, headingToScreen, onStage, screenToWorld } from './world.js';
import { rng } from './textures.js';

const NAMES = [
  'Anna', 'Erik', 'Maja', 'Omar', 'Karin', 'Lars', 'Sara', 'Ali', 'Ingrid', 'Jonas', 'Elsa', 'Nils',
  'Fatima', 'Gustav', 'Aya', 'Bertil', 'Linnea', 'Sven', 'Mira', 'Hassan', 'Birgitta', 'Oskar', 'Leila', 'Göran',
];

const SPAWNS = [
  () => new THREE.Vector3(-30 + Math.random() * 50, 0, 24 + Math.random() * 2),
  () => new THREE.Vector3(-46, 0, -14 + Math.random() * 26),
  () => new THREE.Vector3(16 + Math.random() * 3.5, 0, -45),
];

const SQUARE = { x0: -22, x1: 19, z0: -19, z1: 13.5 };

// the area right in front of the LED wall where visitors stop to play (world-space bounding box)
const ENGAGE = (() => {
  const a = screenToWorld(-6.5, -5.5), b = screenToWorld(-1.8, 5.5);
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
})();

// spots at the edge of the audience area, used when someone presses "+ Visitor" so they arrive in seconds
const ENTRANCES = [
  () => new THREE.Vector3(-1 + Math.random() * 2, 0, 16.2), // through the opening in the chains
  () => screenToWorld(-9 - Math.random() * 2, -13.5),
  () => screenToWorld(-9 - Math.random() * 2, 13.5),
  () => screenToWorld(-4, -13.8),
  () => screenToWorld(-4, 13.8),
];

const LINES = {
  adult: ['Look, it’s the old square!', 'Come on, let’s get closer!', 'Which figure am I?', 'Haha, it copies me!', 'We need more people for colour!', 'Lovely lights tonight'],
  elderly: ['The dance hall used to be right here.', 'That’s exactly how it looked in 1944!', 'I remember the bakery on the corner.', 'My mother did her shopping just there.', 'How lovely to see the square alive again', 'Come and sit down for a while!'],
  child: ['Look, I’m flying!', 'Grandma, you’re a tram conductor!', 'My drawing is on the screen!', 'Again, again!', 'We’re dancing!'],
};

function insideObstacle(p, obstacles, r = 0.5) {
  for (const o of obstacles) {
    if (o.t === 'circle') { if (Math.hypot(p.x - o.x, p.z - o.z) < o.r + r) return true; }
    else if (p.x > o.x0 - r && p.x < o.x1 + r && p.z > o.z0 - r && p.z < o.z1 + r) return true;
  }
  return false;
}

/** Waypoints from a to b that respect the chain line and the building layout. */
export function route(a, b) {
  const pts = [];
  const CZ = LAYOUT.chainZ;
  const south = (p) => p.z > CZ;
  const north = (p) => p.x > 13.5 && p.z < -20.5;
  if (north(a) && !north(b)) pts.push(new THREE.Vector3(17.5, 0, -21), new THREE.Vector3(16.5, 0, -18));
  if (south(a) !== south(b)) {
    const crossX = a.x + (b.x - a.x) * ((CZ - a.z) / (b.z - a.z || 1e-6));
    if (crossX > -22.3 && crossX < 18.3) {
      const g = LAYOUT.gapX;
      pts.push(new THREE.Vector3(g, 0, south(a) ? 17 : 13.5), new THREE.Vector3(g, 0, south(a) ? 13.5 : 17));
    }
  }
  if (!north(a) && north(b)) pts.push(new THREE.Vector3(16.5, 0, -18), new THREE.Vector3(17.5, 0, -21));
  pts.push(b.clone());
  return pts;
}

let NEXT_ID = 1;

export class Crowd {
  constructor(scene, obstacles, onEvent = () => {}) {
    this.scene = scene;
    this.obstacles = obstacles;
    this.onEvent = onEvent;
    this.agents = [];
    this.rand = rng(77);
    this.nameIdx = 0;
  }

  randomPoint(area = SQUARE) {
    for (let i = 0; i < 40; i++) {
      const p = new THREE.Vector3(area.x0 + Math.random() * (area.x1 - area.x0), 0, area.z0 + Math.random() * (area.z1 - area.z0));
      if (!insideObstacle(p, this.obstacles)) return p;
    }
    return new THREE.Vector3(0, 0, 0);
  }

  spawn({ kind, at, goScreen = false, near = null, name, id, seed, silent = false, hurry = false } = {}) {
    const r = Math.random();
    kind = kind ?? (r < 0.3 ? 'elderly' : r < 0.42 ? 'child' : 'adult');
    seed = seed ?? Math.floor(Math.random() * 1e9);
    const style = modernStyle(rng(seed), kind);
    const rig = new Rig(style);
    this.scene.add(rig.root);
    const pos = at ? at.clone() : SPAWNS[Math.floor(Math.random() * SPAWNS.length)]();
    const a = {
      seed,
      netPos: pos.clone(),
      netHeading: 0,
      id: id ?? `npc-${Math.random().toString(36).slice(2, 8)}-${NEXT_ID++}`,
      name: name ?? NAMES[this.nameIdx++ % NAMES.length],
      kind, rig, pos, heading: 0, isPlayer: false,
      speed: kind === 'elderly' ? 0.75 + Math.random() * 0.2 : kind === 'child' ? 1.35 : 1.15 + Math.random() * 0.3,
      vel: new THREE.Vector3(), phase: Math.random() * 10,
      state: 'walk', waypoints: [], next: null, timer: 0, gesture: null, gestureT: 0,
      nextGesture: 2 + Math.random() * 3, bornAt: performance.now() / 1000, stuck: 0, lastDist: 1e9,
      hurry, sayCd: 6 + Math.random() * 14, sayId: 0, sitting: false,
    };
    if (goScreen) this.goScreen(a, near);
    else this.goWander(a);
    this.agents.push(a);
    if (!silent) this.onEvent(`${a.name} (${kind}) arrives at the square`, 'spawn');
    return a;
  }

  /** "+ Visitor": appear at the nearest edge of the square and hurry to the screen. */
  spawnFast() {
    const at = ENTRANCES[Math.floor(Math.random() * ENTRANCES.length)]();
    return this.spawn({ at, goScreen: true, hurry: true });
  }

  spawnGroup(n = 4) {
    const center = this.randomPoint(ENGAGE);
    const start = ENTRANCES[0]();
    const kinds = ['elderly', 'adult', 'child', 'elderly', 'adult', 'adult'];
    const out = [];
    for (let i = 0; i < n; i++) {
      const at = start.clone().add(new THREE.Vector3((i % 3) * 0.9, 0, Math.floor(i / 3) * 0.9));
      const a = this.spawn({ kind: kinds[i % kinds.length], at, goScreen: true, hurry: true, near: center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (i - n / 2) * 1.1)) });
      out.push(a);
    }
    return out;
  }

  setPath(a, target) {
    a.waypoints = route(a.pos, target);
    a.next = a.waypoints.shift();
    a.state = 'walk';
    a.stuck = 0;
    a.lastDist = 1e9;
  }

  goWander(a) {
    a.intent = 'wander';
    this.setPath(a, this.randomPoint());
  }

  goScreen(a, near = null) {
    a.intent = 'screen';
    let p = near ?? this.randomPoint(ENGAGE);
    if (insideObstacle(p, this.obstacles, 0.4)) p = this.randomPoint(ENGAGE);
    this.setPath(a, p);
  }

  goLeave(a) {
    a.intent = 'leave';
    this.setPath(a, SPAWNS[Math.floor(Math.random() * SPAWNS.length)]());
  }

  removeAgent(a) {
    if (a.seat) { a.seat.occupant = null; a.seat = null; }
    a.rig.dispose();
    this.agents.splice(this.agents.indexOf(a), 1);
  }

  clear() {
    for (const a of [...this.agents]) this.removeAgent(a);
  }

  arrive(a, people) {
    a.hurry = false;
    if (a.intent === 'leave') { this.removeAgent(a); return; }
    if (a.intent === 'sit' && a.seat) {
      a.state = 'sit';
      a.sitting = true;
      a.timer = 20 + Math.random() * 25;
      return;
    }
    if (a.intent === 'screen') {
      a.state = 'engage';
      a.timer = 18 + Math.random() * 22;
      a.faceScreen = true;
      a.approached = false;
      return;
    }
    if (a.intent === 'approach') {
      a.state = 'engage';
      a.timer = Math.max(a.timer, 8);
      a.faceScreen = true;
      return;
    }
    // wander arrival: idle a bit, then decide
    a.state = 'idle';
    a.timer = 2 + Math.random() * 5;
  }

  goSit(a) {
    const free = (this.seats ?? []).filter((s) => !s.occupant);
    if (!free.length) return false;
    free.sort((p, q) => p.front.distanceTo(a.pos) - q.front.distanceTo(a.pos));
    const seat = free[Math.floor(Math.random() * Math.min(2, free.length))];
    seat.occupant = a;
    a.seat = seat;
    a.intent = 'sit';
    this.setPath(a, seat.front.clone());
    return true;
  }

  decide(a) {
    const onSquare = performance.now() / 1000 - a.bornAt;
    const r = Math.random();
    if (Math.random() < (a.kind === 'elderly' ? 0.5 : 0.12) && this.goSit(a)) return;
    if (onSquare > 70 && r < 0.4) this.goLeave(a);
    else if (r < 0.55) this.goScreen(a);
    else this.goWander(a);
  }

  // ---------------- multiplayer ----------------
  /** Host → compact snapshot of every visitor. */
  serialize() {
    const r = (v) => Math.round(v * 100) / 100;
    return this.agents.map((a) => ({
      id: a.id, n: a.name, k: a.kind, s: a.seed, x: r(a.pos.x), z: r(a.pos.z), h: r(a.heading),
      g: a.gesture, gt: a.gesture ? r(a.gestureT) : 0,
      st: a.sitting ? 1 : 0,
      ...(a.sayUntil > performance.now() ? { sy: a.sayText, si: a.sayId } : {}),
    }));
  }

  /** Non-host clients mirror the host's visitors as puppets. */
  applySnapshot(list) {
    const seen = new Set();
    for (const d of list) {
      seen.add(d.id);
      let a = this.agents.find((x) => x.id === d.id);
      if (!a) {
        a = this.spawn({ id: d.id, name: d.n, kind: d.k, seed: d.s, at: new THREE.Vector3(d.x, 0, d.z) });
        a.heading = d.h;
      }
      a.netPos.set(d.x, 0, d.z);
      a.netHeading = d.h;
      if (d.g && (a.gesture !== d.g || Math.abs(a.gestureT - d.gt) > 0.5)) { a.gesture = d.g; a.gestureT = d.gt; }
      if (!d.g && a.gesture && a.gestureT > 0.3) a.gesture = null;
      a.sitting = !!d.st;
      if (d.si && d.si !== a.sayId) { a.sayId = d.si; this.onSay?.(a, d.sy); }
    }
    for (const a of [...this.agents]) if (!seen.has(a.id)) this.removeAgent(a);
  }

  setPuppet(on) {
    if (this.puppet === on) return;
    this.puppet = on;
    if (!on) for (const a of this.agents) { a.vel.set(0, 0, 0); this.goWander(a); }
  }

  updatePuppets(dt, t) {
    for (const a of this.agents) {
      const prev = a.pos.clone();
      a.pos.lerp(a.netPos, 1 - Math.exp(-dt * 8));
      if (a.pos.distanceTo(a.netPos) > 4) a.pos.copy(a.netPos);
      const spd = prev.distanceTo(a.pos) / Math.max(dt, 1e-3);
      let dh = a.netHeading - a.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      a.heading += dh * (1 - Math.exp(-dt * 8));
      this.animate(a, dt, t, spd);
    }
  }

  animate(a, dt, t, spd) {
    const rig = a.rig;
    rig.resetTargets();
    animIdle(rig, t, a.seed % 10);
    if (a.sitting) animSit(rig, t, a.seed % 10);
    else if (spd > 0.08) {
      a.phase += dt * spd * (a.kind === 'child' ? 6.5 : 5.2);
      animWalk(rig, a.phase, Math.min(1, spd / 0.9));
    }
    if (a.gesture) {
      a.gestureT += dt;
      if (!animGesture(rig, a.gesture, a.gestureT)) a.gesture = null;
    }
    rig.update(dt, 14);
    rig.root.position.copy(a.pos);
    rig.root.rotation.y = a.heading;
  }

  update(dt, t, people) {
    if (this.puppet) { this.updatePuppets(dt, t); return; }
    for (const a of [...this.agents]) {
      let moving = false;
      if (a.state === 'walk' && a.next) {
        const to = new THREE.Vector3().subVectors(a.next, a.pos).setY(0);
        const d = to.length();
        if (d < 0.35) {
          a.next = a.waypoints.shift();
          if (!a.next) { this.arrive(a, people); if (!this.agents.includes(a)) continue; }
        } else {
          to.normalize();
          // separation from everyone else
          for (const o of people) {
            if (o === a) continue;
            const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, dd = Math.hypot(dx, dz);
            if (dd < 0.9 && dd > 1e-4) { to.x += (dx / dd) * (0.9 - dd) * 1.5; to.z += (dz / dd) * (0.9 - dd) * 1.5; }
          }
          to.normalize();
          const sp = a.speed * (a.hurry ? 1.75 : 1) * Math.min(1, d / 0.8 + 0.4);
          a.vel.lerp(to.multiplyScalar(sp), 1 - Math.exp(-dt * 6));
          moving = true;
          // stuck detection
          if (d > a.lastDist - 0.05 * dt) a.stuck += dt; else a.stuck = Math.max(0, a.stuck - dt);
          a.lastDist = Math.min(a.lastDist, d);
          if (a.stuck > 3) {
            a.stuck = 0;
            a.lastDist = 1e9;
            if (a.waypoints.length) a.next = a.waypoints.shift();
            else this.arrive(a, people);
          }
        }
      } else if (a.state === 'sit') {
        a.pos.lerp(a.seat.pos, 1 - Math.exp(-dt * 6));
        let dh0 = a.seat.heading - a.heading;
        dh0 = Math.atan2(Math.sin(dh0), Math.cos(dh0));
        a.heading += dh0 * (1 - Math.exp(-dt * 6));
        a.timer -= dt;
        if (a.timer <= 0) { a.state = 'standup'; a.sitting = false; a.timer = 0.7; }
      } else if (a.state === 'standup') {
        a.pos.lerp(a.seat.front, 1 - Math.exp(-dt * 5));
        a.timer -= dt;
        if (a.timer <= 0) { a.seat.occupant = null; a.seat = null; this.decide(a); }
      } else if (a.state === 'idle') {
        a.timer -= dt;
        if (a.timer <= 0) this.decide(a);
      } else if (a.state === 'engage') {
        a.timer -= dt;
        a.nextGesture -= dt;
        if (!a.gesture && a.nextGesture <= 0) {
          const pool = ['wave', 'wave', 'cheer', 'clap', 'dance', 'bow', 'airplane', 'jump'];
          if (a.kind === 'elderly') pool.push('wave', 'bow', 'clap', 'smoke');
          if (a.kind === 'child') pool.push('jump', 'jump', 'airplane', 'dance');
          a.gesture = pool[Math.floor(Math.random() * pool.length)];
          a.gestureT = 0;
          a.nextGesture = 2.5 + Math.random() * 4;
        }
        // occasionally walk up to someone else at the screen (triggers the duo animations)
        if (!a.approached && Math.random() < dt * 0.06) {
          a.approached = true;
          const others = people.filter((o) => o !== a && onStage(o.pos));
          if (others.length) {
            const o = others[Math.floor(Math.random() * others.length)];
            const side = Math.random() < 0.5 ? -1 : 1;
            a.intent = 'approach';
            this.setPath(a, new THREE.Vector3(o.pos.x, 0, o.pos.z + side * 0.9));
          }
        }
        if (a.state === 'engage' && a.timer <= 0) {
          if (Math.random() < 0.6) this.goLeave(a); else this.goWander(a);
        }
      }
      if (!moving) a.vel.multiplyScalar(Math.exp(-dt * 8));
      const seated = a.state === 'sit' || a.state === 'standup';
      if (!seated) {
        a.pos.addScaledVector(a.vel, dt);
        resolveCollisions(a.pos, 0.28, this.obstacles);
      }
      // occasional remarks (speech bubbles), mostly while watching the screen or sitting
      a.sayCd -= dt;
      if (a.sayCd <= 0) {
        a.sayCd = 12 + Math.random() * 22;
        if (['engage', 'sit', 'idle'].includes(a.state) && Math.random() < 0.7) {
          const pool = LINES[a.kind] ?? LINES.adult;
          a.sayText = pool[Math.floor(Math.random() * pool.length)];
          a.sayId = 1 + Math.floor(Math.random() * 1e9);
          a.sayUntil = performance.now() + 4500;
          this.onSay?.(a, a.sayText);
        }
      }

      // heading
      const spd = a.vel.length();
      let targetHeading = a.heading;
      if (seated) targetHeading = a.heading;
      else if (spd > 0.15) targetHeading = Math.atan2(a.vel.x, a.vel.z);
      else if (a.state === 'engage' && a.faceScreen) targetHeading = headingToScreen(a.pos) + Math.sin(t * 0.3 + a.seed) * 0.15;
      let dh = targetHeading - a.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      a.heading += dh * (1 - Math.exp(-dt * 6));

      this.animate(a, dt, t, spd);
    }
  }
}

export { GESTURES };
