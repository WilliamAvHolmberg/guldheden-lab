import * as THREE from 'three';
import { Rig, PLAYER_STYLE, animIdle, animWalk, animGesture, animSit, GESTURES } from './character.js';
import { resolveCollisions, headingToScreen } from './world.js';

const GESTURE_KEYS = ['wave', 'cheer', 'clap', 'dance', 'jump', 'bow', 'airplane', 'smoke'];

export class Player {
  constructor(scene, camera, dom, { obstacles, buildings, onClick, onHover, style }) {
    this.id = 'player';
    this.name = 'You';
    this.kind = 'adult';
    this.isPlayer = true;
    this.rig = new Rig(style ?? PLAYER_STYLE);
    scene.add(this.rig.root);
    this.camera = camera;
    this.obstacles = obstacles;
    this.buildings = buildings;
    // start at the opening in the chains by the big street, looking at the screen
    this.pos = new THREE.Vector3(-2.5, 0, 17.8);
    this.heading = headingToScreen(this.pos);
    this.seat = null;
    this.vel = new THREE.Vector3();
    this.phase = 0;
    this.gesture = null;
    this.gestureT = 0;
    this.keys = new Set();
    this.yaw = this.heading + Math.PI;
    this.pitch = 0.32;
    this.dist = 5.2;
    this.camTarget = this.pos.clone().add(new THREE.Vector3(0, 1.45, 0));
    this.camPos = new THREE.Vector3();
    this.poseActive = false;
    this.enabled = true;
    this.onClick = onClick;
    this.onHover = onHover;

    const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this.play('jump'); e.preventDefault(); }
      const n = Number(e.key);
      if (n >= 1 && n <= GESTURE_KEYS.length) this.play(GESTURE_KEYS[n - 1]);
      if (e.code === 'KeyF') this.faceScreen();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    let down = null;
    dom.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, moved: 0, button: e.button };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (down) {
        const dx = e.movementX, dy = e.movementY;
        down.moved += Math.abs(dx) + Math.abs(dy);
        if (down.moved > 4) {
          this.yaw -= dx * 0.005;
          this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, -0.15, 1.35);
        }
      } else this.onHover?.(e.clientX, e.clientY);
    });
    dom.addEventListener('pointerup', (e) => {
      if (down && down.moved <= 4) this.onClick?.(e.clientX, e.clientY);
      down = null;
    });
    dom.addEventListener('wheel', (e) => {
      this.dist = THREE.MathUtils.clamp(this.dist * (1 + e.deltaY * 0.001), 1.4, 22);
      e.preventDefault();
    }, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  play(name) {
    if (!GESTURES[name]) return;
    this.gesture = name;
    this.gestureT = 0;
  }

  faceScreen() {
    this.heading = headingToScreen(this.pos);
    this.yaw = this.heading + Math.PI;
  }

  sitAt(seat) {
    if (seat.occupant && seat.occupant !== this) return false;
    this.standUp();
    seat.occupant = this;
    this.seat = seat;
    this.gesture = null;
    return true;
  }

  standUp() {
    if (!this.seat) return;
    this.pos.copy(this.seat.front);
    this.seat.occupant = null;
    this.seat = null;
  }

  update(dt, t, pose = null) {
    // --- movement ---
    const k = this.keys;
    let fx = 0, fz = 0;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    }
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = fwd.multiplyScalar(fz).add(right.multiplyScalar(fx));
    if (this.seat && wish.lengthSq() > 0) this.standUp();
    const speed = run ? 4.2 : 1.7;
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    this.vel.lerp(wish, 1 - Math.exp(-dt * 8));
    if (this.seat) {
      this.vel.set(0, 0, 0);
      this.pos.lerp(this.seat.pos, 1 - Math.exp(-dt * 8));
      let dh0 = this.seat.heading - this.heading;
      dh0 = Math.atan2(Math.sin(dh0), Math.cos(dh0));
      this.heading += dh0 * (1 - Math.exp(-dt * 8));
    } else {
      this.pos.addScaledVector(this.vel, dt);
      resolveCollisions(this.pos, 0.3, this.obstacles);
    }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -60, 40);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -58, 40);

    const spd = this.vel.length();
    if (spd > 0.2) {
      const h = Math.atan2(this.vel.x, this.vel.z);
      let dh = h - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * (1 - Math.exp(-dt * 10));
    }

    // --- animation layers ---
    const rig = this.rig;
    rig.resetTargets();
    animIdle(rig, t, 0);
    if (this.seat) animSit(rig, t, 0);
    else if (spd > 0.08) {
      this.phase += dt * spd * (run ? 3.4 : 5.0);
      animWalk(rig, this.phase, Math.min(1, spd / 1.4), run && spd > 2.5);
    }
    this.poseActive = !!pose;
    if (pose) {
      pose.apply(rig);
      this.gesture = null;
    } else if (this.gesture) {
      this.gestureT += dt;
      if (!animGesture(rig, this.gesture, this.gestureT)) this.gesture = null;
    }
    rig.update(dt, pose ? 20 : 16);
    rig.root.position.copy(this.pos);
    rig.root.rotation.y = this.heading;

    // --- camera ---
    const tgt = this.pos.clone().add(new THREE.Vector3(0, 1.45, 0));
    this.camTarget.lerp(tgt, 1 - Math.exp(-dt * 10));
    const off = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    // pull the camera in if a building is in the way
    let d = this.dist;
    const p = new THREE.Vector3();
    for (let i = 1; i <= 24; i++) {
      const dd = (this.dist * i) / 24;
      p.copy(this.camTarget).addScaledVector(off, dd);
      if (this.insideBuilding(p)) { d = Math.max(0.6, dd - this.dist / 24); break; }
    }
    this.camPos.copy(this.camTarget).addScaledVector(off, d);
    this.camPos.y = Math.max(0.25, this.camPos.y);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  insideBuilding(p) {
    for (const b of this.buildings) {
      if (p.x > b.x0 - 0.2 && p.x < b.x1 + 0.2 && p.z > b.z0 - 0.2 && p.z < b.z1 + 0.2 && p.y < b.h + 0.5) return true;
    }
    return false;
  }
}

export { GESTURE_KEYS };
