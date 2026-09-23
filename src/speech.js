import * as THREE from 'three';
import { makeCanvas, toTexture } from './textures.js';

/** Word-wrap text into at most maxLines lines that fit maxWidth. */
function wrap(ctx, text, maxWidth, maxLines = 3) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  }
  return lines;
}

function bubbleSprite(text, { name = null, accent = '#f1c453' } = {}) {
  const W = 640, pad = 26, lineH = 40;
  const measure = makeCanvas(8, 8).getContext('2d');
  measure.font = '600 32px system-ui, sans-serif';
  const lines = wrap(measure, text, W - pad * 2);
  const nameH = name ? 34 : 0;
  const H = pad * 2 + nameH + lines.length * lineH + 22;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  const bw = Math.min(W - 4, Math.max(...lines.map((l) => measure.measureText(l).width), name ? measure.measureText(name).width * 0.8 : 0) + pad * 2);
  const x0 = (W - bw) / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x0, 2, bw, H - 24, 22);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W / 2 - 16, H - 23); ctx.lineTo(W / 2, H - 2); ctx.lineTo(W / 2 + 16, H - 23);
  ctx.closePath();
  ctx.fill();
  let y = pad + 4;
  if (name) {
    ctx.fillStyle = accent === '#f1c453' ? '#9a6a00' : accent;
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, W / 2, y + 16);
    y += nameH;
  }
  ctx.fillStyle = '#16181b';
  ctx.font = '600 32px system-ui, sans-serif';
  ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y + 28 + i * lineH));
  const tex = toTexture(c, { wrap: false });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
  const worldW = 2.8;
  sp.scale.set(worldW, worldW * (H / W), 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 20;
  return sp;
}

/** Speech bubbles above people's heads (chat messages and NPC remarks). */
export class Speech {
  constructor() {
    this.active = new Map(); // person id -> { sprite, until, person }
  }

  say(person, text, { seconds, name, accent } = {}) {
    if (!person?.rig || !text) return;
    this.clear(person.id);
    const sprite = bubbleSprite(text, { name, accent });
    const scale = person.rig.style.scale ?? 1;
    // above the name tag if the person has one
    sprite.position.set(0, 2.05 * scale + (person.isRemote ? 0.2 : 0.05), 0);
    person.rig.root.add(sprite);
    const dur = seconds ?? Math.min(9, 3.5 + text.length * 0.06);
    this.active.set(person.id, { sprite, until: performance.now() + dur * 1000, person });
  }

  clear(id) {
    const b = this.active.get(id);
    if (!b) return;
    b.sprite.removeFromParent();
    b.sprite.material.map.dispose();
    b.sprite.material.dispose();
    this.active.delete(id);
  }

  update() {
    const now = performance.now();
    for (const [id, b] of this.active) {
      const left = (b.until - now) / 1000;
      if (left <= 0 || !b.person.rig.root.parent) { this.clear(id); continue; }
      b.sprite.material.opacity = Math.min(1, left / 0.5);
    }
  }
}
