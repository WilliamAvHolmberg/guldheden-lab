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
  ctx.fillText('FÄRSKT VARJE DAG', 16, H - 11);
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
  ctx.fillText('DET', 30, 70);
  ctx.fillText('INTERAKTIVA', 30, 112);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px Georgia, serif';
  ctx.fillText('ARKIVET', 30, 142 - 0);
  ctx.font = '20px Helvetica, Arial';
  ctx.fillStyle = '#e8e8e8';
  ctx.fillText('Kliv fram – bli en del av', 30, 420);
  ctx.fillText('Guldhedstorgets historia.', 30, 446);
  ctx.fillStyle = '#f1c453';
  ctx.font = 'bold 18px Helvetica, Arial';
  ctx.fillText('GULDHEDSTORGET · HÖSTEN 2026', 30, 520);
  return c;
}

/** Ground decal marking the interaction zone in front of the screen. */
export function zoneDecalTexture() {
  const S = 1024;
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  for (const [r, w] of [[500, 6], [340, 3], [180, 3]]) {
    ctx.lineWidth = w;
    ctx.setLineDash(r === 500 ? [] : [18, 14]);
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0, false); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold 34px Helvetica, Arial';
  ctx.textAlign = 'center';
  ctx.save(); ctx.translate(cx, cy - 420); ctx.rotate(Math.PI); ctx.fillText('KLIV IN · STEP IN', 0, 0); ctx.restore();
  // footprints
  const foot = (x, y, a) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.ellipse(0, 0, 5, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 13, 4, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  ctx.fillStyle = 'rgba(241,196,83,0.75)';
  for (const [x, y] of [[-150, -250], [150, -250], [0, -260]]) {
    foot(cx + x - 8, cy + y, 0);
    foot(cx + x + 8, cy + y + 4, 0);
  }
  return c;
}

/** Info plaque next to the screen, including the privacy note. */
export function plaqueTexture() {
  const W = 512, H = 640;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1e22'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f1c453'; ctx.fillRect(0, 0, W, 12);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 40px Georgia, serif';
  ctx.fillText('Det interaktiva', 36, 80);
  ctx.fillText('arkivet', 36, 126);
  ctx.font = '22px Helvetica, Arial';
  ctx.fillStyle = '#d7d7d7';
  const lines = [
    'Kliv fram så får du en historisk',
    'figur från Guldhedstorget som',
    'rör sig som du.',
    '',
    'Ju fler grannar som deltar,',
    'desto mer färg, ljus och musik.',
    '',
    'Gå nära någon – se vad som',
    'händer mellan era figurer.',
  ];
  lines.forEach((l, i) => ctx.fillText(l, 36, 190 + i * 32));
  ctx.fillStyle = '#2a2f35'; ctx.fillRect(24, 500, W - 48, 110);
  ctx.fillStyle = '#9fd3b0';
  ctx.font = 'bold 20px Helvetica, Arial';
  ctx.fillText('INTEGRITET', 44, 534);
  ctx.fillStyle = '#cfcfcf';
  ctx.font = '18px Helvetica, Arial';
  ctx.fillText('Sensorerna läser bara kroppens ledpunkter.', 44, 564);
  ctx.fillText('Ingen video sparas eller skickas vidare.', 44, 590);
  return c;
}

/** Children's crayon drawing of the square — one of the rotating backgrounds. */
export function kidsDrawingTexture() {
  const W = 2048, H = 768, rand = rng(42);
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#fbf7ee'; ctx.fillRect(0, 0, W, H);
  const crayon = (color, width, pts, jitter = 3, passes = 3) => {
    ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let p = 0; p < passes; p++) {
      ctx.globalAlpha = 0.55 + rand() * 0.3;
      ctx.lineWidth = width * (0.7 + rand() * 0.5);
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const jx = x + (rand() - 0.5) * jitter, jy = y + (rand() - 0.5) * jitter;
        i ? ctx.lineTo(jx, jy) : ctx.moveTo(jx, jy);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  const scribbleFill = (color, x, y, w, h, dens = 14) => {
    for (let yy = y; yy < y + h; yy += dens * 0.5) {
      crayon(color, dens, [[x, yy], [x + w, yy + (rand() - 0.5) * 6]], 6, 1);
    }
  };
  // sky scribbles
  scribbleFill('#8ec6ef', 0, 0, W, 420, 26);
  // sun
  ctx.fillStyle = '#ffd23d';
  ctx.beginPath(); ctx.arc(1820, 120, 80, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    crayon('#ffb400', 10, [[1820 + Math.cos(a) * 100, 120 + Math.sin(a) * 100], [1820 + Math.cos(a) * 160, 120 + Math.sin(a) * 160]]);
  }
  // clouds
  for (const [x, y] of [[300, 120], [900, 90], [1350, 160]]) {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x + i * 45, y + Math.sin(i) * 12, 50, 0, Math.PI * 2); ctx.fill(); }
  }
  // grass
  scribbleFill('#6cc24a', 0, 560, W, 210, 28);
  // buildings: long yellow house with red roof, tall tower
  scribbleFill('#f3dc8a', 1100, 300, 820, 290, 18);
  crayon('#333', 6, [[1100, 300], [1920, 300], [1920, 590], [1100, 590], [1100, 300]]);
  scribbleFill('#d9432e', 1080, 240, 860, 60, 18);
  for (let i = 0; i < 7; i++) {
    const x = 1140 + i * 110;
    ctx.fillStyle = '#3d7fd1'; ctx.fillRect(x, 340, 60, 60);
    crayon('#222', 4, [[x, 340], [x + 60, 340], [x + 60, 400], [x, 400], [x, 340]]);
  }
  // "screen" in the house with little figures
  ctx.fillStyle = '#2b2b40'; ctx.fillRect(1230, 450, 520, 130);
  crayon('#ff66cc', 5, [[1230, 450], [1750, 450], [1750, 580], [1230, 580], [1230, 450]]);
  scribbleFill('#b8b8e8', 180, 180, 260, 400, 16); // tower
  crayon('#333', 6, [[180, 180], [440, 180], [440, 580], [180, 580], [180, 180]]);
  for (let r = 0; r < 6; r++) for (let q = 0; q < 3; q++) {
    ctx.fillStyle = '#ffe36b'; ctx.fillRect(205 + q * 80, 200 + r * 62, 40, 36);
  }
  // trees
  for (const x of [560, 760, 960]) {
    crayon('#7a4a22', 22, [[x, 590], [x, 470]]);
    ctx.fillStyle = '#2f9e44';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + (rand() - 0.5) * 90, 420 + (rand() - 0.5) * 70, 55, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#e8322a';
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x + (rand() - 0.5) * 100, 420 + (rand() - 0.5) * 80, 9, 0, Math.PI * 2); ctx.fill(); }
  }
  // flowers
  for (let i = 0; i < 30; i++) {
    const x = rand() * W, y = 640 + rand() * 110;
    crayon('#2c8a2c', 5, [[x, y], [x, y - 40]]);
    ctx.fillStyle = ['#ff4d6d', '#ffd23d', '#b04dff', '#ff8c1a'][i % 4];
    for (let p = 0; p < 5; p++) { const a = p / 5 * Math.PI * 2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 10, y - 40 + Math.sin(a) * 10, 8, 0, Math.PI * 2); ctx.fill(); }
  }
  // stick people holding hands
  const stick = (x, y, col) => {
    ctx.strokeStyle = col;
    crayon(col, 6, [[x, y - 110], [x, y - 40]]);
    crayon(col, 6, [[x, y - 40], [x - 22, y]]);
    crayon(col, 6, [[x, y - 40], [x + 22, y]]);
    crayon(col, 6, [[x - 40, y - 90], [x + 40, y - 90]]);
    ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, y - 132, 22, 0, Math.PI * 2); ctx.stroke();
  };
  [[640, 740, '#d62828'], [720, 740, '#1d4ed8'], [800, 740, '#7c3aed'], [1500, 740, '#111']].forEach(([x, y, c2]) => stick(x, y, c2));
  // title in kid letters
  ctx.fillStyle = '#e63946';
  ctx.font = 'bold 86px "Comic Sans MS", "Chalkboard SE", cursive';
  ctx.save(); ctx.rotate(-0.03); ctx.fillText('GULDHEDSTORGET', 520, 110); ctx.restore();
  ctx.fillStyle = '#333';
  ctx.font = '38px "Comic Sans MS", "Chalkboard SE", cursive';
  ctx.fillText('av Ella 7 år, Omar 8 år & klass 2B', 540, 175);
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
  ctx.fillText('DET INTERAKTIVA', 90, 190);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('ARKIVET', 90, 310);
  ctx.fillStyle = '#d7dbe0';
  ctx.font = '44px Helvetica, Arial';
  ctx.fillText('Gå runt till framsidan – kliv in och bli en del', 94, 400);
  ctx.fillText('av Guldhedstorgets historia.', 94, 456);
  ctx.fillStyle = '#f1c453';
  ctx.font = 'bold 34px Helvetica, Arial';
  ctx.fillText('→  FÖLJ LJUSSLINGORNA I MARKEN', 94, 520);
  return c;
}
