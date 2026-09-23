#!/usr/bin/env node
// Multiplayer smoke test for the Guldhedstorget room server.
//
//   node scripts/smoke-test.mjs protocol [--server <host>]   two clients, checks every message type (~2 s)
//   node scripts/smoke-test.mjs bot [--server <host>] [--room bot-test] [--seconds 30]
//        a fake player that walks up to the screen, waves, switches the era and asks the host for a group
//
// --server defaults to localhost:8787 (wrangler dev). For production pass the workers.dev host.

const args = Object.fromEntries(
  process.argv.slice(3).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []),
);
const mode = process.argv[2] ?? 'protocol';
const server = args.server ?? 'localhost:8787';
const proto = server.startsWith('localhost') || server.startsWith('127.') ? 'ws' : 'wss';
const url = (room, id) => `${proto}://${server}/parties/guldheden/${room}?_pk=${id}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(room, id, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url(room, id));
    const got = [];
    ws.onmessage = (e) => got.push(JSON.parse(e.data));
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', name })); resolve({ ws, got }); };
    ws.onerror = () => reject(new Error(`could not connect to ${url(room, id)}`));
  });
}

async function protocol() {
  const room = `smoke-${Date.now()}`;
  const a = await client(room, 'a1', 'Anna');
  await sleep(300);
  const b = await client(room, 'b2', 'Bo');
  await sleep(300);
  a.ws.send(JSON.stringify({ t: 'p', x: 1, z: 2, h: 0, y: 0, q: [] }));
  a.ws.send(JSON.stringify({ t: 'npcs', list: [{ id: 'n1' }] }));
  b.ws.send(JSON.stringify({ t: 'state', theme: 'kids' }));
  b.ws.send(JSON.stringify({ t: 'cmd', cmd: 'group' }));
  b.ws.send(JSON.stringify({ t: 'chat', text: 'Hej från Bo!' }));
  await sleep(600);
  a.ws.close();
  await sleep(600);
  b.ws.close();

  const has = (c, pred) => c.got.some(pred);
  const checks = [
    ['A receives welcome', has(a, (m) => m.t === 'welcome')],
    ['A (first in room) is elected host', has(a, (m) => m.t === 'host' && m.id === 'a1')],
    ['A sees B join', has(a, (m) => m.t === 'join' && m.id === 'b2')],
    ['B receives A\'s player snapshot', has(b, (m) => m.t === 'p' && m.id === 'a1')],
    ['B receives host NPC snapshot', has(b, (m) => m.t === 'npcs')],
    ['A receives B\'s era change', has(a, (m) => m.t === 'state' && m.state.theme === 'kids')],
    ['B\'s command is forwarded to host A', has(a, (m) => m.t === 'cmd' && m.cmd === 'group')],
    ['A receives B\'s chat message with name', has(a, (m) => m.t === 'chat' && m.id === 'b2' && m.name === 'Bo' && m.text === 'Hej från Bo!')],
    ['B sees A leave', has(b, (m) => m.t === 'leave' && m.id === 'a1')],
    ['Host migrates to B', has(b, (m) => m.t === 'host' && m.id === 'b2')],
  ];
  for (const [label, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${label}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(failed ? `\n${failed} check(s) failed against ${server}` : `\nAll ${checks.length} checks passed against ${server}`);
  process.exit(failed ? 1 : 0);
}

async function bot() {
  // default to a separate test room so the bot never disturbs real people in the main room
  const room = args.room ?? 'bot-test';
  const seconds = Number(args.seconds ?? 30);
  const { ws, got } = await client(room, `bot-${Math.random().toString(36).slice(2, 7)}`, 'Bertil (bot)');
  console.log(`Bot joined room "${room}" on ${server} for ${seconds}s`);
  const zRot = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
  let t = 0;
  const iv = setInterval(() => {
    t += 1 / 15;
    const q = [];
    for (let i = 0; i < 17; i++) q.push(0, 0, 0, 1);
    q.splice(8 * 4, 4, ...zRot(-2.5)); // uArmR raised
    q.splice(9 * 4, 4, ...zRot(-0.35 + 0.45 * Math.sin(t * 9))); // fArmR waving
    // walk in from the big street towards the LED wall (it faces south, so walking north = heading π)
    ws.send(JSON.stringify({ t: 'p', x: 1.4, z: Math.max(6.5, 16 - t * 1.5), h: Math.PI, y: 0, q }));
    if (Math.abs(t - 3) < 0.04) ws.send(JSON.stringify({ t: 'chat', text: 'Hej! Jag är en bot som testar torget.' }));
    if (Math.abs(t - 6) < 0.04) ws.send(JSON.stringify({ t: 'state', theme: '1958' }));
    if (Math.abs(t - 7) < 0.04) ws.send(JSON.stringify({ t: 'cmd', cmd: 'group' }));
  }, 1000 / 15);
  await sleep(seconds * 1000);
  clearInterval(iv);
  ws.close();
  const npcs = got.filter((m) => m.t === 'npcs').at(-1)?.list.length ?? 0;
  console.log('Messages:', got.filter((m) => !['p', 'npcs'].includes(m.t)).map((m) => m.t + (m.t === 'host' ? `:${m.id}` : '')).join(', '));
  console.log(`Last NPC snapshot from host: ${npcs} visitors`);
  process.exit(0);
}

(mode === 'bot' ? bot() : protocol()).catch((e) => { console.error(e.message); process.exit(1); });
