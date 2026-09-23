import PartySocket from 'partysocket';

/** Resolves the room-server host: env var in production, local `wrangler dev` when running on localhost. */
export function partyHost() {
  const env = import.meta.env.VITE_PARTY_HOST;
  if (env) return env;
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return 'localhost:8787';
  return null;
}

export function roomName() {
  const r = new URLSearchParams(location.search).get('room');
  return (r || 'guldheden').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'guldheden';
}

/** Thin wrapper around PartySocket with typed callbacks. */
export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.id = sessionStorage.getItem('gh-id') || crypto.randomUUID();
    sessionStorage.setItem('gh-id', this.id);
    this.hostId = null;
    this.connected = false;
    this.room = roomName();
    this.socket = null;
  }

  get isHost() { return !this.socket || this.hostId === this.id; }
  get online() { return !!this.socket && this.connected; }

  connect(hello) {
    const host = partyHost();
    if (!host) return false;
    this.hello = hello;
    this.socket = new PartySocket({ host, party: 'guldheden', room: this.room, id: this.id });
    this.socket.addEventListener('open', () => {
      this.connected = true;
      this.send({ t: 'hello', ...this.hello });
      this.h.onStatus?.('online');
    });
    this.socket.addEventListener('close', () => {
      this.connected = false;
      this.h.onStatus?.('offline');
    });
    this.socket.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.t) {
        case 'welcome':
          this.h.onWelcome?.(msg);
          break;
        case 'host':
          this.hostId = msg.id;
          this.h.onHost?.(this.isHost);
          break;
        case 'join': this.h.onJoin?.(msg); break;
        case 'leave': this.h.onLeave?.(msg.id); break;
        case 'p': this.h.onPlayer?.(msg); break;
        case 'npcs': this.h.onNpcs?.(msg.list); break;
        case 'state': this.h.onState?.(msg); break;
        case 'cmd': this.h.onCmd?.(msg); break;
        case 'chat': this.h.onChat?.(msg); break;
        default:
      }
    });
    return true;
  }

  send(obj) {
    if (this.socket && this.connected) this.socket.send(JSON.stringify(obj));
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Pack a rig's joint rotations as a flat, rounded array (x,y,z,w per joint). */
export function packRig(rig, joints) {
  const out = new Array(joints.length * 4);
  joints.forEach((n, i) => {
    const q = rig.joints[n].quaternion;
    out[i * 4] = r3(q.x); out[i * 4 + 1] = r3(q.y); out[i * 4 + 2] = r3(q.z); out[i * 4 + 3] = r3(q.w);
  });
  return out;
}

export function unpackRig(rig, joints, q) {
  joints.forEach((n, i) => rig.target[n].set(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]).normalize());
}

export const round = (v, p = 100) => Math.round(v * p) / p;

/** Small stable string hash (for deterministic choices across clients). */
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
