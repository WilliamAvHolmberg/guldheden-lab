import * as THREE from 'three';

// Deterministic PRNG so the square looks the same on every load.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(canvas, { repeat = [1, 1], srgb = true, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function noise(ctx, w, h, amount, rand, mono = true) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    if (mono) {
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    } else {
      d[i] += n; d[i + 1] += (rand() - 0.5) * amount; d[i + 2] += (rand() - 0.5) * amount;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx, S, rand, count, color, maxA, rMin, rMax) {
  for (let i = 0; i < count; i++) {
    const x = rand() * S, y = rand() * S, r = rMin + rand() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${color},${rand() * maxA})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    // draw wrapped so the texture tiles
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
    }
  }
}

/** Red brick pavers in stretcher bond. 512px = 3.2 m. */
export function pavingTextures() {
  const S = 512, rand = rng(11);
  const c = makeCanvas(S, S), b = makeCanvas(S, S);
  const ctx = c.getContext('2d'), bx = b.getContext('2d');
  ctx.fillStyle = '#3e2622'; ctx.fillRect(0, 0, S, S);
  bx.fillStyle = '#1a1a1a'; bx.fillRect(0, 0, S, S);
  const bw = 32, bh = 16;
  for (let row = 0; row < S / bh; row++) {
    const off = (row % 2) * bw / 2;
    for (let col = -1; col <= S / bw; col++) {
      const x = col * bw + off, y = row * bh, v = rand();
      const r = 112 + v * 38 + (rand() - 0.5) * 16, g = 50 + v * 16, bl = 44 + v * 12;
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${bl | 0})`;
      ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
      const lv = 150 + rand() * 70;
      bx.fillStyle = `rgb(${lv | 0},${lv | 0},${lv | 0})`;
      bx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
    }
  }
  blotches(ctx, S, rand, 40, '30,18,14', 0.12, 20, 80);
  noise(ctx, S, S, 24, rand);
  noise(bx, S, S, 50, rand);
  return { map: c, bump: b };
}

/** Irregular grey flagstones (tileable Voronoi). 512px = 4 m. */
export function flagstoneTextures() {
  const S = 512, N = 8, rand = rng(7);
  const pts = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    pts.push([(i + 0.1 + rand() * 0.8) / N * S, (j + 0.1 + rand() * 0.8) / N * S, rand(), rand()]);
  }
  const c = makeCanvas(S, S), b = makeCanvas(S, S);
  const ctx = c.getContext('2d'), bx = b.getContext('2d');
  const img = ctx.createImageData(S, S), bimg = bx.createImageData(S, S);
  const cell = S / N;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
    let d1 = 1e9, d2 = 1e9, id = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      let ii = ci + di, jj = cj + dj, ox = 0, oy = 0;
      if (ii < 0) { ii += N; ox = -S; } else if (ii >= N) { ii -= N; ox = S; }
      if (jj < 0) { jj += N; oy = -S; } else if (jj >= N) { jj -= N; oy = S; }
      const p = pts[jj * N + ii];
      const dx = p[0] + ox - x, dy = p[1] + oy - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; id = jj * N + ii; } else if (d < d2) d2 = d;
    }
    const edge = d2 - d1;
    const k = (y * S + x) * 4;
    const tone = pts[id][2], warm = pts[id][3];
    const n = (rand() - 0.5) * 22;
    let r = 96 + tone * 50 + n + warm * 10, g = 99 + tone * 48 + n + warm * 5, bl = 104 + tone * 44 + n;
    const gap = edge < 2.5 ? 0 : edge < 6 ? (edge - 2.5) / 3.5 : 1;
    const shade = 0.55 + 0.45 * gap;
    img.data[k] = r * shade; img.data[k + 1] = g * shade; img.data[k + 2] = bl * shade; img.data[k + 3] = 255;
    const h = gap * (170 + n * 2 + tone * 40);
    bimg.data[k] = bimg.data[k + 1] = bimg.data[k + 2] = h; bimg.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  bx.putImageData(bimg, 0, 0);
  blotches(ctx, S, rand, 30, '40,40,36', 0.15, 15, 60);
  return { map: c, bump: b };
}

/** Granite setts (cobbles). 512px = 1.6 m. */
export function cobbleTextures() {
  const S = 512, rand = rng(3), n = 16, s = S / n;
  const c = makeCanvas(S, S), b = makeCanvas(S, S);
  const ctx = c.getContext('2d'), bx = b.getContext('2d');
  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(0, 0, S, S);
  bx.fillStyle = '#000'; bx.fillRect(0, 0, S, S);
  for (let j = 0; j < n; j++) {
    const off = (j % 2) * s * 0.5;
    for (let i = -1; i <= n; i++) {
      const x = i * s + off + (rand() - 0.5) * 3, y = j * s + (rand() - 0.5) * 3;
      const v = 80 + rand() * 60;
      const g = ctx.createRadialGradient(x + s / 2 - 4, y + s / 2 - 4, 2, x + s / 2, y + s / 2, s * 0.7);
      g.addColorStop(0, `rgb(${v + 30},${v + 30},${v + 32})`);
      g.addColorStop(1, `rgb(${v - 20},${v - 20},${v - 18})`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(x + 2, y + 2, s - 4, s - 4, 6); ctx.fill();
      const bg = bx.createRadialGradient(x + s / 2, y + s / 2, 1, x + s / 2, y + s / 2, s * 0.62);
      bg.addColorStop(0, '#fff'); bg.addColorStop(1, '#333');
      bx.fillStyle = bg;
      bx.beginPath(); bx.roundRect(x + 2, y + 2, s - 4, s - 4, 6); bx.fill();
    }
  }
  noise(ctx, S, S, 30, rand);
  return { map: c, bump: b };
}

/** Weathered cream stucco. 512px = 4 m. */
export function stuccoTexture(base = [226, 213, 182], seed = 5) {
  const S = 512, rand = rng(seed);
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${base.join(',')})`; ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, rand, 60, '150,140,110', 0.1, 20, 90);
  blotches(ctx, S, rand, 40, '255,250,235', 0.12, 20, 90);
  // faint vertical rain streaks
  for (let i = 0; i < 70; i++) {
    const x = rand() * S, len = 40 + rand() * 200, y = rand() * S;
    ctx.fillStyle = `rgba(110,100,80,${rand() * 0.05})`;
    ctx.fillRect(x, y, 1 + rand() * 3, len);
  }
  noise(ctx, S, S, 14, rand);
  return c;
}

/** Red clay roof tiles. 512px = 4 m. */
export function roofTileTexture() {
  const S = 512, rand = rng(21), rowH = 32, tw = 32;
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  for (let j = 0; j < S / rowH; j++) {
    const off = (j % 2) * tw / 2;
    for (let i = -1; i <= S / tw; i++) {
      const x = i * tw + off, y = j * rowH;
      const v = rand();
      const r = 140 + v * 40, g = 58 + v * 20, b = 42 + v * 12;
      const grd = ctx.createLinearGradient(x, 0, x + tw, 0);
      grd.addColorStop(0, `rgb(${r * 0.7 | 0},${g * 0.7 | 0},${b * 0.7 | 0})`);
      grd.addColorStop(0.45, `rgb(${r | 0},${g | 0},${b | 0})`);
      grd.addColorStop(1, `rgb(${r * 0.75 | 0},${g * 0.75 | 0},${b * 0.75 | 0})`);
      ctx.fillStyle = grd;
      ctx.fillRect(x, y, tw, rowH);
      ctx.fillStyle = 'rgba(30,10,5,0.45)';
      ctx.fillRect(x, y + rowH - 4, tw, 4);
    }
  }
  blotches(ctx, S, rand, 40, '60,60,50', 0.18, 10, 60);
  noise(ctx, S, S, 16, rand);
  return c;
}

/** Blue-grey slate. 512px = 4 m. */
export function slateTexture() {
  const S = 512, rand = rng(31), rowH = 20, tw = 34;
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#2f343a'; ctx.fillRect(0, 0, S, S);
  for (let j = 0; j < Math.ceil(S / rowH); j++) {
    const off = (j % 2) * tw / 2;
    for (let i = -1; i <= S / tw; i++) {
      const x = i * tw + off, y = j * rowH, v = rand();
      ctx.fillStyle = `rgb(${62 + v * 30 | 0},${68 + v * 30 | 0},${78 + v * 30 | 0})`;
      ctx.fillRect(x + 1, y, tw - 2, rowH - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x + 1, y + rowH - 4, tw - 2, 2);
    }
  }
  blotches(ctx, S, rand, 30, '120,130,110', 0.12, 20, 80);
  noise(ctx, S, S, 14, rand);
  return c;
}

/** Vinyl wrap with crates of produce, like the covered shop windows in the photo. */
export function produceTexture(seed = 1) {
  const W = 512, H = 400, rand = rng(seed);
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#20241c'; ctx.fillRect(0, 0, W, H);
  const kinds = [
    { c: ['#f2d43b', '#e8c21c'], r: 13 }, // lemons
    { c: ['#8cc43a', '#6aa82a'], r: 13 }, // limes
    { c: ['#d63a2a', '#b82a1c', '#e35b2b'], r: 15 }, // apples
    { c: ['#b7d98a', '#9ccb6a'], r: 24 }, // cabbage
    { c: ['#f39a26', '#e9851a'], r: 15 }, // oranges
    { c: ['#e8e2c8', '#d7cfaa'], r: 14 }, // onions
    { c: ['#3f8a2e', '#2f7424'], r: 10 }, // leaves
  ];
  const cols = 4, rows = 3, cw = W / cols, ch = H / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = kinds[Math.floor(rand() * kinds.length)];
    const x0 = i * cw, y0 = j * ch;
    ctx.fillStyle = '#6b4a2c'; ctx.fillRect(x0 + 4, y0 + 4, cw - 8, ch - 8);
    ctx.save(); ctx.beginPath(); ctx.rect(x0 + 8, y0 + 8, cw - 16, ch - 20); ctx.clip();
    for (let n = 0; n < 90; n++) {
      const x = x0 + 8 + rand() * (cw - 16), y = y0 + 8 + rand() * (ch - 16), r = k.r * (0.8 + rand() * 0.4);
      const col = k.c[Math.floor(rand() * k.c.length)];
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 1, x, y, r);
      g.addColorStop(0, '#ffffffaa'); g.addColorStop(0.25, col); g.addColorStop(1, '#00000088');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#4a321d'; ctx.fillRect(x0 + 4, y0 + ch - 16, cw - 8, 12);
  }
  ctx.fillStyle = '#2f7a3a'; ctx.fillRect(0, H - 34, W, 34);
  ctx.fillStyle = '#e9f1e0'; ctx.font = 'bold 20px Helvetica, Arial';
  ctx.fillText('FRESH EVERY DAY', 16, H - 11);
  return c;
}

export function grassTexture() {
  const S = 256, rand = rng(9);
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#4c6a2e'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) {
    const v = rand();
    ctx.fillStyle = `rgba(${60 + v * 60 | 0},${90 + v * 60 | 0},${30 + v * 30 | 0},0.6)`;
    ctx.fillRect(rand() * S, rand() * S, 1, 2 + rand() * 3);
  }
  blotches(ctx, S, rand, 20, '110,90,40', 0.2, 10, 40);
  return c;
}

export function asphaltTexture() {
  const S = 256, rand = rng(13);
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#48494b'; ctx.fillRect(0, 0, S, S);
  noise(ctx, S, S, 40, rand);
  blotches(ctx, S, rand, 20, '20,20,20', 0.15, 10, 40);
  return c;
}

export function woodTexture() {
  const W = 256, H = 64, rand = rng(17);
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#8a5a34'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(60,35,18,${0.1 + rand() * 0.25})`;
    ctx.beginPath();
    const y = rand() * H;
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 2);
    ctx.stroke();
  }
  return c;
}

/** Poster on the lamp post, advertising the installation. */
export function posterTexture() {
  const W = 400, H = 560;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#16323a'); g.addColorStop(1, '#0b1a1f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // sepia "photo" block with silhouettes
  ctx.fillStyle = '#b39a74'; ctx.fillRect(30, 150, W - 60, 230);
  ctx.fillStyle = '#5a4630';
  for (let i = 0; i < 9; i++) {
    const x = 50 + i * 36, h = 70 + (i % 3) * 12;
    ctx.beginPath(); ctx.arc(x, 380 - h - 12, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 12, 380 - h, 24, h);
  }
  ctx.fillStyle = '#f1c453';
  ctx.font = 'bold 44px Georgia, serif';
  ctx.fillText('THE', 30, 70);
  ctx.fillText('INTERACTIVE', 30, 112);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px Georgia, serif';
  ctx.fillText('ARCHIVE', 30, 142 - 0);
  ctx.font = '20px Helvetica, Arial';
  ctx.fillStyle = '#e8e8e8';
  ctx.fillText('Step in – become part of', 30, 420);
  ctx.fillText('Guldhedstorget’s history.', 30, 446);
  ctx.fillStyle = '#f1c453';
  ctx.font = 'bold 18px Helvetica, Arial';
  ctx.fillText('GULDHEDSTORGET · AUTUMN 2026', 30, 520);
  return c;
}

/**
 * The wooden stage floor with its painted markings. Canvas x = lateral (left → right as seen by the
 * audience), canvas y = depth: top edge is next to the screen, bottom edge is where people step on.
 * 1 px = 6.25 mm (2048 px = 12.8 m wide, 1120 px = 7 m deep).
 */
/** One shoe print pointing up (towards the screen): wide forefoot in front, smaller heel behind. */
function drawFoot(ctx, x, y, s = 1, side = 1) {
  ctx.beginPath(); ctx.ellipse(x, y - 18 * s, 15 * s, 27 * s, side * 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x - side * 2 * s, y + 25 * s, 10 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
}
/** A pair of shoe prints (one person) centred on x, y. */
function footPair(ctx, x, y, s = 1) {
  drawFoot(ctx, x - 24 * s, y + 6 * s, s, 1);
  drawFoot(ctx, x + 24 * s, y, s, -1);
}

/**
 * Where the painted footprints are on the stage floor, in screen-local metres
 * (x towards the screen, z lateral). Used to light them up and for the talk/dance spots.
 */
export const STAGE_FLOOR = { W: 2048, H: 1120, PX: 2048 / 12.8 };
const FOOT_SPOTS_PX = {
  talk: [[0.27 * 2048 - 70, 0.5 * 1120], [0.27 * 2048 + 70, 0.5 * 1120]],
  dance: [[0.73 * 2048 - 120, 0.5 * 1120 + 30], [0.73 * 2048, 0.5 * 1120 - 40], [0.73 * 2048 + 120, 0.5 * 1120 + 30]],
};
export function footSpots(stage) {
  const { W, PX } = STAGE_FLOOR;
  const conv = ([x, y]) => ({ x: stage.x1 - y / PX, z: (x - W / 2) / PX });
  return { talk: FOOT_SPOTS_PX.talk.map(conv), dance: FOOT_SPOTS_PX.dance.map(conv) };
}

/** White shoe-print pair on transparent background – the glow overlay for one footprint spot. */
export function footPairTexture() {
  const S = 128, c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  footPair(ctx, S / 2, S / 2 + 6, 1.05);
  return toTexture(c, { wrap: false });
}

export function stageFloorTexture() {
  const W = 2048, H = 1120, PX = 2048 / 12.8, rand = rng(31);
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  // boards running left–right, staggered joints
  const boardH = 0.14 * PX;
  for (let y = 0, row = 0; y < H; y += boardH, row++) {
    let x = -rand() * 300;
    while (x < W) {
      const len = (1.6 + rand() * 1.6) * PX, v = rand();
      const r = 150 + v * 40, g = 104 + v * 28, b = 62 + v * 18;
      const grd = ctx.createLinearGradient(0, y, 0, y + boardH);
      grd.addColorStop(0, `rgb(${r + 12 | 0},${g + 8 | 0},${b + 5 | 0})`);
      grd.addColorStop(1, `rgb(${r - 14 | 0},${g - 12 | 0},${b - 8 | 0})`);
      ctx.fillStyle = grd;
      ctx.fillRect(x, y, len, boardH - 2);
      // grain
      ctx.strokeStyle = `rgba(70,40,20,${0.08 + rand() * 0.08})`;
      ctx.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        const gy = y + 3 + rand() * (boardH - 6);
        ctx.beginPath(); ctx.moveTo(x, gy);
        ctx.bezierCurveTo(x + len * 0.3, gy + (rand() - 0.5) * 6, x + len * 0.7, gy + (rand() - 0.5) * 6, x + len, gy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,24,12,0.7)';
      ctx.fillRect(x + len - 2, y, 2, boardH - 2);
      x += len;
    }
    ctx.fillStyle = 'rgba(30,18,8,0.8)';
    ctx.fillRect(0, y + boardH - 2, W, 2);
  }
  noise(ctx, W, H, 14, rand);

  // painted markings (cream paint, slightly worn)
  const paint = 'rgba(245,236,214,0.88)';
  ctx.fillStyle = paint;
  ctx.textAlign = 'center';
  ctx.font = 'bold 120px Helvetica, Arial';
  ctx.fillText('STEP IN', W / 2, H - 70);
  const pair = (x, y) => footPair(ctx, x, y);
  ctx.fillStyle = 'rgba(241,196,83,0.92)';
  // two people close together → they chat
  const talkX = W * 0.27, talkY = H * 0.5;
  pair(talkX - 70, talkY); pair(talkX + 70, talkY);
  // three people close together → they dance
  const danceX = W * 0.73, danceY = H * 0.5;
  pair(danceX - 120, danceY + 30); pair(danceX, danceY - 40); pair(danceX + 120, danceY + 30);
  // no captions on purpose: visitors should discover what standing together does
  // painted border line
  ctx.strokeStyle = 'rgba(245,236,214,0.55)';
  ctx.lineWidth = 10;
  ctx.strokeRect(24, 24, W - 48, H - 48);
  return c;
}

export function gradientSkyTexture(top, bottom) {
  const c = makeCanvas(4, 256), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
  const t = toTexture(c, { wrap: false });
  return t;
}

/** Simple sign board with text. */
export function signTexture(text, { bg = '#1d3b2a', fg = '#f4efe2', w = 512, h = 96, font = 'bold 54px Georgia, serif' } = {}) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  return toTexture(c, { wrap: false });
}

/** Tileable fbm used for cloud / misc shaders is done in GLSL; this is a small sprite for confetti/sparkles. */
export function sparkleTexture() {
  const S = 64, c = makeCanvas(S, S), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,240,200,0.8)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return toTexture(c, { wrap: false });
}

export function heartTexture() {
  const S = 128, c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#ff4f7a';
  ctx.beginPath();
  ctx.moveTo(64, 110);
  ctx.bezierCurveTo(10, 70, 10, 20, 40, 20);
  ctx.bezierCurveTo(55, 20, 64, 32, 64, 42);
  ctx.bezierCurveTo(64, 32, 73, 20, 88, 20);
  ctx.bezierCurveTo(118, 20, 118, 70, 64, 110);
  ctx.fill();
  return toTexture(c, { wrap: false });
}

/** Graphics on the back of the freestanding LED wall (seen from the rest of the square). */
export function backPanelTexture() {
  const W = 2048, H = 560;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#10262c'); g.addColorStop(1, '#0b1a1f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // sepia strip of silhouettes, like an archive photo
  ctx.fillStyle = '#b39a74'; ctx.fillRect(1180, 70, 780, 420);
  ctx.fillStyle = '#5a4630';
  for (let i = 0; i < 16; i++) {
    const x = 1220 + i * 46, h = 150 + (i % 4) * 22;
    ctx.beginPath(); ctx.arc(x, 470 - h - 18, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 17, 470 - h, 34, h);
  }
  ctx.fillStyle = '#f1c453';
  ctx.font = 'bold 110px Georgia, serif';
  ctx.fillText('THE INTERACTIVE', 90, 190);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('ARCHIVE', 90, 310);
  ctx.fillStyle = '#d7dbe0';
  ctx.font = '44px Helvetica, Arial';
  ctx.fillText('Walk round to the front – step in and become', 94, 400);
  ctx.fillText('part of Guldhedstorget’s history.', 94, 456);
  ctx.fillStyle = '#f1c453';
  ctx.font = 'bold 34px Helvetica, Arial';
  ctx.fillText('→  FOLLOW THE LIGHT STRIPS IN THE GROUND', 94, 520);
  return c;
}

/**
 * 1944 screen: one paving field of Guldhedstorget as in the 1940s photos (ArkDes ARKM.1962-101-0955):
 * a large rectangle of pale, irregular natural-stone flags framed by a darker band of small setts.
 * The texture covers one field of `wm` × `hm` metres and tiles into the grid of big rectangles.
 */
export function plazaField1944Texture(wm = 6, hm = 4, border = 0.38, fx = 1, fy = 1) {
  // several fields per tile, each in its own stone tone (light / grey / warm), as in the photos
  if (fx * fy > 1) {
    const PPM = 140, FW = Math.round(wm * PPM), FH = Math.round(hm * PPM);
    const c = makeCanvas(FW * fx, FH * fy), ctx = c.getContext('2d');
    const tones = [[214, 206, 188], [188, 184, 174], [200, 190, 170], [218, 210, 194]];
    for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) {
      ctx.drawImage(plazaFieldCanvas(wm, hm, border, PPM, tones[(i + j * 3) % tones.length], 1944 + i * 7 + j * 13), i * FW, j * FH);
    }
    return c;
  }
  return plazaFieldCanvas(wm, hm, border, 200, [214, 206, 188], 1944);
}

function plazaFieldCanvas(wm, hm, border, PPM, base, seed) {
  const W = Math.round(wm * PPM), H = Math.round(hm * PPM), rand = rng(seed);
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  // irregular flags (~1 m) via a jittered grid + nearest-two-points joints
  const nx = Math.round(wm / 0.95), ny = Math.round(hm / 0.95), cw = W / nx, ch = H / ny;
  const pts = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    pts.push({ x: (i + 0.15 + rand() * 0.7) * cw, y: (j + 0.15 + rand() * 0.7) * ch, tone: rand() });
  }
  const img = ctx.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) {
    const cy = Math.floor(y / ch);
    for (let x = 0; x < W; x++) {
      const cx = Math.floor(x / cw);
      let d1 = 1e9, d2 = 1e9, best = pts[0];
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const ix = cx + ox, iy = cy + oy;
        if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) continue;
        const p = pts[iy * nx + ix], dx = p.x - x, dy = p.y - y, dd = dx * dx + dy * dy;
        if (dd < d1) { d2 = d1; d1 = dd; best = p; } else if (dd < d2) d2 = dd;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const k = (y * W + x) * 4, t = best.tone;
      let r = base[0] + t * 16, g = base[1] + t * 14, b = base[2] + t * 12;
      if (edge < 3) { const f = 1 - edge / 3; r -= 40 * f; g -= 40 * f; b -= 38 * f; }
      d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // weathering
  for (let i = 0; i < 120; i++) {
    const x = rand() * W, y = rand() * H, r = 10 + rand() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() < 0.6 ? 'rgba(90,80,62,0.07)' : 'rgba(255,250,236,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // the frame: half a band on each edge (neighbouring fields complete it), small grey setts
  const bw = (border / 2) * PPM, sw = 0.11 * PPM, sl = 0.16 * PPM;
  const band = (x0, y0, w, h, alongX) => {
    ctx.fillStyle = '#6f6a60';
    ctx.fillRect(x0, y0, w, h);
    const rows = Math.max(1, Math.round((alongX ? h : w) / sw));
    for (let rI = 0; rI < rows; rI++) {
      let p = -rand() * sl;
      while (p < (alongX ? w : W + H)) {
        const len = sl * (0.8 + rand() * 0.4), v = 128 + rand() * 30;
        ctx.fillStyle = `rgb(${v + 6 | 0},${v + 2 | 0},${v - 8 | 0})`;
        if (alongX) ctx.fillRect(x0 + p + 1.5, y0 + rI * (h / rows) + 1.5, len - 3, h / rows - 3);
        else ctx.fillRect(x0 + rI * (w / rows) + 1.5, y0 + p + 1.5, w / rows - 3, len - 3);
        p += len;
        if (!alongX && p > h) break;
      }
    }
  };
  band(0, 0, W, bw, true);
  band(0, H - bw, W, bw, true);
  band(0, 0, bw, H, false);
  band(W - bw, 0, bw, H, false);
  noise(ctx, W, H, 12, rand);
  return c;
}

/** 1944 screen: the lawn – uneven green with lighter, sun-dried and worn patches. */
export function lawn1944Texture() {
  const S = 512, rand = rng(4419);
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.fillStyle = '#6a9440';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 220; i++) {
    const x = rand() * S, y = rand() * S, r = 8 + rand() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = rand() < 0.5 ? '78,112,44' : rand() < 0.7 ? '132,160,74' : '176,170,112';
    g.addColorStop(0, `rgba(${col},0.35)`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // blades
  for (let i = 0; i < 9000; i++) {
    const x = rand() * S, y = rand() * S;
    ctx.fillStyle = rand() < 0.5 ? 'rgba(40,70,24,0.35)' : 'rgba(170,196,110,0.3)';
    ctx.fillRect(x, y, 1, 2 + rand() * 3);
  }
  noise(ctx, S, S, 10, rand, false);
  return c;
}

/** A floating name label (sprite) shown above people on the square. */
export function nameTag(text, color = '#f1c453') {
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

/**
 * 1944 screen: a lit shop window seen from the square (after the group's reference photos):
 * 'konditori' – cakes on stands behind lace curtains, 'tobak' – shelves of cigar boxes and
 * newspapers, 'manufaktur' – mannequins in a dressing gown and a suit, rolls of fabric.
 */
export function shopWindowTexture(kind) {
  const W = 512, H = 336, rand = rng(kind.length * 97);
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  const lit = { konditori: ['#fbecc9', '#d9b98a'], tobak: ['#9a6b43', '#4e3220'], manufaktur: ['#ece6da', '#bfb6a6'] }[kind];
  grd.addColorStop(0, lit[0]); grd.addColorStop(1, lit[1]);
  ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
  const ell = (x, y, rx, ry, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };
  if (kind === 'konditori') {
    // pendant lamp, lace curtains, cakes on a glass shelf and a tiered stand, trays of pastries
    ell(W / 2, 40, 46, 14, '#fff7dc');
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const x0 of [0, W - 70]) for (let k = 0; k < 6; k++) ctx.fillRect(x0 + k * 12, 0, 7, H);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(70, 150, W - 140, 6);
    const cakes = ['#f3c6d0', '#fffaf0', '#6b3a22', '#f7e3a1', '#e88fa6'];
    for (let i = 0; i < 4; i++) {
      const x = 120 + i * 90, col = cakes[i % cakes.length];
      ctx.fillStyle = '#e8d9bd'; ctx.fillRect(x - 34, 118, 68, 32);
      ell(x, 118, 34, 9, col);
      ell(x, 112, 6, 6, '#c62a3a');
    }
    // tiered stand
    ctx.fillStyle = '#d8d8d8'; ctx.fillRect(W / 2 - 3, 190, 6, 90);
    for (const [y, r] of [[200, 40], [240, 62], [280, 84]]) {
      ell(W / 2, y, r, 7, '#f2f2f2');
      for (let k = 0; k < r / 14; k++) ell(W / 2 - r + 12 + k * 28, y - 7, 9, 7, cakes[(k + y) % cakes.length]);
    }
    ctx.fillStyle = '#fffaf0'; ctx.fillRect(40, 300, W - 80, 36);
    for (let k = 0; k < 14; k++) ell(60 + k * 30, 302, 11, 6, ['#d8a35a', '#f3c6d0', '#6b3a22'][k % 3]);
  } else if (kind === 'tobak') {
    // wooden shelves full of colourful boxes, a newspaper rack, a counter
    for (let row = 0; row < 4; row++) {
      const y = 40 + row * 62;
      ctx.fillStyle = '#3a2416'; ctx.fillRect(30, y + 44, W - 60, 6);
      let x = 36;
      while (x < W - 60) {
        const w = 18 + rand() * 26, h = 22 + rand() * 20;
        ctx.fillStyle = ['#c62a3a', '#f1c453', '#2a5d8a', '#e9e3d2', '#2d5a39', '#b5682a'][Math.floor(rand() * 6)];
        ctx.fillRect(x, y + 44 - h, w - 3, h);
        x += w;
      }
    }
    ctx.fillStyle = '#f4f1ea';
    for (let k = 0; k < 5; k++) { ctx.save(); ctx.translate(70 + k * 26, 300); ctx.rotate(-0.08 + k * 0.04); ctx.fillRect(-20, -46, 40, 52); ctx.restore(); }
    ctx.fillStyle = '#5e3b24'; ctx.fillRect(220, 270, W - 250, 66);
  } else {
    // diamond-lattice backdrop, two mannequins, rolls of fabric, a ribbon banner
    ctx.strokeStyle = 'rgba(160,150,135,0.5)'; ctx.lineWidth = 2;
    for (let k = -8; k < 16; k++) { ctx.beginPath(); ctx.moveTo(k * 40, 0); ctx.lineTo(k * 40 + 220, 336); ctx.stroke(); ctx.beginPath(); ctx.moveTo(k * 40 + 220, 0); ctx.lineTo(k * 40, 336); ctx.stroke(); }
    const mannequin = (x, coat, trim) => {
      ell(x, 64, 17, 21, '#e9d2b6');
      ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.ellipse(x, 52, 18, 10, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = coat; ctx.beginPath(); ctx.moveTo(x - 40, 96); ctx.lineTo(x + 40, 96); ctx.lineTo(x + 50, 300); ctx.lineTo(x - 50, 300); ctx.closePath(); ctx.fill();
      ctx.fillStyle = trim; ctx.fillRect(x - 6, 96, 12, 120);
      ctx.fillStyle = '#f4f1ea'; ctx.beginPath(); ctx.moveTo(x - 14, 92); ctx.lineTo(x + 14, 92); ctx.lineTo(x, 122); ctx.closePath(); ctx.fill();
    };
    mannequin(110, '#2b2f3a', '#7a1f2b');
    mannequin(W - 110, '#4a3a2e', '#c9b48a');
    ctx.fillStyle = '#fffaf0'; ctx.save(); ctx.translate(W / 2, 130); ctx.rotate(-0.25); ctx.fillRect(-120, -16, 240, 32); ctx.restore();
    ctx.fillStyle = '#7a1f2b'; ctx.font = 'italic bold 22px Georgia, serif'; ctx.textAlign = 'center';
    ctx.save(); ctx.translate(W / 2, 137); ctx.rotate(-0.25); ctx.fillText('New fabrics in!', 0, 0); ctx.restore();
    for (let k = 0; k < 5; k++) { ctx.fillStyle = ['#c9b48a', '#6d7f9a', '#a8302a', '#e9e3d2', '#3f5a4a'][k]; ctx.fillRect(176 + k * 34, 230, 28, 80); }
    ctx.fillStyle = '#d9d2c4'; ctx.fillRect(0, 306, W, 30);
  }
  // window glass: frame bars + a soft reflection
  ctx.fillStyle = '#2a2622'; ctx.fillRect(0, 0, W, 8); ctx.fillRect(0, H - 8, W, 8); ctx.fillRect(0, 0, 8, H); ctx.fillRect(W - 8, 0, 8, H);
  ctx.fillRect(W / 2 - 3, 0, 6, H);
  const refl = ctx.createLinearGradient(0, 0, W, H);
  refl.addColorStop(0, 'rgba(255,255,255,0.18)'); refl.addColorStop(0.35, 'rgba(255,255,255,0)'); refl.addColorStop(0.7, 'rgba(255,255,255,0.08)'); refl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = refl; ctx.fillRect(0, 0, W, H);
  return toTexture(c, { wrap: false });
}

/** Neon-ish script sign on the restaurant roof ("Guldheden", as in the 1940s photos). */
export function scriptSignTexture(text) {
  const W = 1024, H = 256, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.font = 'italic bold 170px "Brush Script MT", "Segoe Script", "Snell Roundhand", cursive';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(40,36,30,0.85)';
  ctx.strokeText(text, W / 2, H / 2 + 8);
  ctx.fillStyle = '#fbf7ec';
  ctx.fillText(text, W / 2, H / 2 + 8);
  return toTexture(c, { wrap: false });
}
