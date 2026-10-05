import * as THREE from 'three';
import { Rig, JOINTS, modernStyle } from './character.js';
import { Net, packRig, unpackRig, round } from './net.js';
import { makeCanvas, toTexture, rng } from './textures.js';

const SEND_HZ = 15;
const NPC_HZ = 8;

/** Style for a human player, derived from their id so everyone sees the same outfit. */
export function playerStyle(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const s = modernStyle(rng(h), 'adult');
  s.jacket = s.jacket ?? ['#1f5f63', '#7a2e2e', '#294a6b', '#c0892e', '#3c4b3a'][h % 5];
  s.backpack = s.backpack ?? '#20252c';
  return s;
}

function nameTag(text, color = '#f1c453') {
  const c = makeCanvas(256, 64), ctx = c.getContext('2d');
  ctx.font = 'bold 30px system-ui, sans-serif';
  const w = Math.min(248, ctx.measureText(text).width + 28);
  ctx.fillStyle = 'rgba(10,12,14,0.72)';
  ctx.beginPath(); ctx.roundRect(128 - w / 2, 8, w, 46, 23); ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 42);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: toTexture(c, { wrap: false }), depthWrite: false, transparent: true, toneMapped: false }));
  sp.scale.set(1.0, 0.25, 1);
  sp.renderOrder = 10;
  return sp;
}

class RemotePerson {
  constructor(scene, id, name, style, kind = 'adult') {
    this.id = id;
    this.name = name;
    this.kind = kind;
    this.isPlayer = false;
    this.isRemote = true;
    this.rig = new Rig(style);
    this.pos = new THREE.Vector3(0, 0, 0);
    this.netPos = new THREE.Vector3();
    this.heading = 0;
    this.netHeading = 0;
    this.hasData = false;
    this.rig.root.visible = false;
    scene.add(this.rig.root);
    this.tag = nameTag(name);
    this.rig.root.add(this.tag);
    this.tag.position.set(0, 2.05 * (style.scale ?? 1), 0);
  }

  ingest(d) {
    this.netPos.set(d.x, 0, d.z);
    this.netHeading = d.h;
    if (!this.hasData) { this.pos.copy(this.netPos); this.heading = d.h; this.rig.root.visible = true; }
    this.hasData = true;
    if (d.q) unpackRig(this.rig, JOINTS, d.q);
    this.rig.offsetTarget.set(0, d.y ?? 0, 0);
    this.lastMsg = performance.now();
  }

  update(dt) {
    if (!this.hasData) return;
    this.pos.lerp(this.netPos, 1 - Math.exp(-dt * 10));
    if (this.pos.distanceTo(this.netPos) > 5) this.pos.copy(this.netPos);
    let dh = this.netHeading - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading += dh * (1 - Math.exp(-dt * 10));
    this.rig.update(dt, 14);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.heading;
  }

  dispose() {
    this.tag.material.map.dispose();
    this.rig.dispose();
  }
}

/**
 * Multiplayer glue: remote players (and their webcam guests), NPC ownership by the room host,
 * and shared installation state. Falls back to single-player when no PartyKit host is configured.
 */
export class Multiplayer {
  constructor({ scene, player, crowd, installation, log, onStatus, onChat }) {
    this.onChat = onChat;
    this.scene = scene;
    this.player = player;
    this.crowd = crowd;
    this.installation = installation;
    this.log = log;
    this.onStatus = onStatus;
    this.remotes = new Map(); // id -> RemotePerson
    this.guests = new Map(); // id -> RemotePerson (a remote player's second webcam person)
    this.sendT = 0;
    this.npcT = 0;
    this.initialSpawned = false;
    this.net = new Net({
      onStatus: (s) => { this.status = s; this.onStatus?.(); },
      onWelcome: (m) => {
        this.installation.applyShared(m.state);
        for (const p of m.players) if (p.id !== this.net.id) this.addRemote(p);
      },
      onJoin: (m) => {
        if (m.id === this.net.id) return;
        this.addRemote(m);
        this.log(`${m.name} joined the square (online)`, 'track');
        this.onStatus?.();
      },
      onLeave: (id) => {
        const r = this.remotes.get(id);
        if (r) { this.log(`${r.name} left (online)`, 'leave'); r.dispose(); this.remotes.delete(id); }
        const g = this.guests.get(id);
        if (g) { g.dispose(); this.guests.delete(id); }
        this.onStatus?.();
      },
      onHost: (isHost) => {
        this.crowd.setPuppet(!isHost);
        if (isHost && !this.initialSpawned && this.crowd.agents.length === 0) this.spawnInitial();
        this.onStatus?.();
      },
      onPlayer: (m) => {
        let r = this.remotes.get(m.id);
        if (!r) return;
        r.ingest(m);
        if (m.gs) {
          let g = this.guests.get(m.id);
          if (!g) {
            const st = playerStyle(`${m.id}-guest`);
            g = new RemotePerson(this.scene, `${m.id}-guest`, `${r.name}’s guest`, st);
            this.guests.set(m.id, g);
          }
          g.ingest(m.gs);
        } else if (this.guests.has(m.id)) {
          this.guests.get(m.id).dispose();
          this.guests.delete(m.id);
        }
      },
      onChat: (m) => {
        const who = this.remotes.get(m.id);
        this.onChat?.({ person: who, name: m.name, text: m.text, self: false });
      },
      onNpcs: (list) => { if (!this.net.isHost) this.crowd.applySnapshot(list); },
      onState: (m) => this.installation.applyShared(m.state, m.by),
      onCmd: (m) => {
        if (!this.net.isHost) return;
        this.runCmd(m.cmd);
        if (m.by) this.log(`${m.by} asked for: ${m.cmd === 'group' ? 'a group of visitors' : m.cmd === 'add' ? 'a visitor' : 'an empty square'}`, 'kiosk');
      },
    });
    this.installation.onShared = (patch) => this.net.send({ t: 'state', ...patch });
  }

  get id() { return this.net.id; }
  get online() { return this.net.online; }
  get isHost() { return this.net.isHost; }
  get count() { return this.remotes.size + 1; }

  start(name, style) {
    this.name = name;
    const ok = this.net.connect({ name, style });
    if (!ok) this.spawnInitial(); // single-player
    else {
      // if the server never answers, behave like single-player after a moment
      setTimeout(() => { if (!this.net.online && !this.initialSpawned) this.spawnInitial(); }, 3000);
    }
    return ok;
  }

  spawnInitial() {
    this.initialSpawned = true;
    this.crowd.spawn({ kind: 'adult', at: new THREE.Vector3(19.5, 0, 14) });
    this.crowd.spawn({ kind: 'elderly', at: new THREE.Vector3(-14, 0, -12) });
  }

  addRemote({ id, name, style }) {
    if (this.remotes.has(id)) return;
    this.remotes.set(id, new RemotePerson(this.scene, id, name, style ?? playerStyle(id)));
  }

  /** Visitor commands (add / group / clear) run on the host; others forward them. */
  command(cmd) {
    if (this.net.online && !this.net.isHost) { this.net.send({ t: 'cmd', cmd }); return false; }
    this.runCmd(cmd);
    return true;
  }

  runCmd(cmd) {
    if (cmd === 'add') this.crowd.spawnFast();
    else if (cmd === 'group') this.crowd.spawnGroup(4);
    else if (cmd === 'clear') this.crowd.clear();
  }

  /** Send a chat message; returns false when offline (the message is still shown locally). */
  chat(text) {
    if (!this.net.online) return false;
    this.net.send({ t: 'chat', text });
    return true;
  }

  people() {
    const out = [];
    for (const r of this.remotes.values()) if (r.hasData) out.push(r);
    for (const g of this.guests.values()) if (g.hasData && performance.now() - g.lastMsg < 1500) out.push(g);
    return out;
  }

  update(dt, t, guest) {
    for (const r of this.remotes.values()) r.update(dt);
    for (const g of this.guests.values()) g.update(dt);
    if (!this.net.online) return;
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / SEND_HZ;
      const p = this.player;
      const msg = { t: 'p', x: round(p.pos.x), z: round(p.pos.z), h: round(p.heading), y: round(p.rig.offset.y), q: packRig(p.rig, JOINTS) };
      if (guest) msg.gs = { x: round(guest.pos.x), z: round(guest.pos.z), h: round(guest.heading), y: 0, q: packRig(guest.rig, JOINTS) };
      this.net.send(msg);
    }
    if (this.net.isHost) {
      this.npcT -= dt;
      if (this.npcT <= 0) {
        this.npcT = 1 / NPC_HZ;
        this.net.send({ t: 'npcs', list: this.crowd.serialize() });
      }
    }
  }
}
