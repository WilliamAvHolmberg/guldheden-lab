// PartyServer (Cloudflare Durable Object) room for Guldhedstorget.
// - relays player snapshots (position + joint rotations) between clients
// - keeps the shared installation state (era on the screen, sound on/off)
// - elects a "host" client that simulates the NPC visitors and broadcasts them

import { Server, routePartykitRequest } from 'partyserver';

export class Guldheden extends Server {
  constructor(ctx, env) {
    super(ctx, env);
    this.shared = { theme: '1944', muted: false };
    this.hostId = null;
    this.meta = new Map(); // connection id -> { name, style }
    this.lastChat = new Map(); // connection id -> timestamp (simple rate limit)
  }

  broadcastJSON(msg, exclude = []) {
    this.broadcast(JSON.stringify(msg), exclude);
  }

  electHost() {
    const ids = [...this.getConnections()].map((c) => c.id).filter((id) => this.meta.has(id));
    if (this.hostId && ids.includes(this.hostId)) return;
    this.hostId = ids[0] ?? null;
    this.broadcastJSON({ t: 'host', id: this.hostId });
  }

  onConnect(conn) {
    conn.send(JSON.stringify({
      t: 'welcome',
      id: conn.id,
      host: this.hostId,
      state: this.shared,
      players: [...this.meta.entries()].map(([id, m]) => ({ id, ...m })),
    }));
  }

  onMessage(sender, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.t) {
      case 'hello': {
        const name = String(msg.name ?? 'Granne').slice(0, 24);
        this.meta.set(sender.id, { name, style: msg.style });
        this.broadcastJSON({ t: 'join', id: sender.id, name, style: msg.style }, [sender.id]);
        this.electHost();
        sender.send(JSON.stringify({ t: 'host', id: this.hostId }));
        break;
      }
      case 'p': // player snapshot
        msg.id = sender.id;
        this.broadcast(JSON.stringify(msg), [sender.id]);
        break;
      case 'npcs':
        if (sender.id === this.hostId) this.broadcast(raw, [sender.id]);
        break;
      case 'state': {
        if (typeof msg.theme === 'string') this.shared.theme = msg.theme;
        if (typeof msg.muted === 'boolean') this.shared.muted = msg.muted;
        this.broadcastJSON({ t: 'state', state: this.shared, by: this.meta.get(sender.id)?.name, reason: msg.reason }, [sender.id]);
        break;
      }
      case 'chat': {
        const text = String(msg.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
        const now = Date.now();
        if (!text || now - (this.lastChat.get(sender.id) ?? 0) < 400) break;
        this.lastChat.set(sender.id, now);
        this.broadcastJSON({ t: 'chat', id: sender.id, name: this.meta.get(sender.id)?.name ?? 'Granne', text }, [sender.id]);
        break;
      }
      case 'cmd': // visitor spawning is done by the host
        if (this.hostId && this.hostId !== sender.id) {
          const host = this.getConnection(this.hostId);
          host?.send(JSON.stringify({ t: 'cmd', cmd: msg.cmd, by: this.meta.get(sender.id)?.name }));
        }
        break;
      default:
    }
  }

  onClose(conn) {
    this.lastChat.delete(conn.id);
    if (this.meta.delete(conn.id)) this.broadcastJSON({ t: 'leave', id: conn.id });
    if (conn.id === this.hostId) { this.hostId = null; this.electHost(); }
  }

  onError(conn) {
    this.onClose(conn);
  }
}

export default {
  async fetch(request, env) {
    return (await routePartykitRequest(request, env)) ?? new Response('Guldhedstorget room server', { status: 404 });
  },
};
