'use strict';
/* Pixel Agents — uma cidadezinha pixel art onde cada terminal do Claude Code é um morador.
   Trabalhando: fica na mesa do escritório (Claude HQ).
   Livre / de folga: sai para a cidade — conversa com os outros, toma café, senta no banco, fuma no fumódromo. */

const W = 512;
const DESK_W = 64;
const DESK_H = 50;
const SPEED = 34; // px lógicos por segundo
const WORK = new Set(['typing', 'reading', 'delegating', 'thinking', 'waiting']);

const STATE = {
  typing:     { label: 'digitando',  color: '#4ade80' },
  reading:    { label: 'lendo',      color: '#60a5fa' },
  thinking:   { label: 'pensando',   color: '#c084fc' },
  delegating: { label: 'delegando',  color: '#f472b6' },
  waiting:    { label: 'aguardando', color: '#facc15' },
  idle:       { label: 'livre',      color: '#94a3b8' },
  away:       { label: 'de folga',   color: '#64748b' },
  npc:        { label: 'morador',    color: '#fbbf24' },
};

// Moradores da cidade (não são terminais): conversam, fumam e tomam café com os agentes.
// Desligue com ?npcs=0 na URL.
const NPCS = [
  { id: 'npc-neide', name: 'Dona Neide' },
  { id: 'npc-ze', name: 'Seu Zé' },
  { id: 'npc-bia', name: 'Bia (estagiária)' },
  { id: 'npc-carlao', name: 'Carlão do NOC' },
];
const USAGE_COLORS = { input: '#60a5fa', output: '#4ade80', cacheWrite: '#f472b6', cacheRead: '#a78bfa' };

// ---------- falas ----------
const CHATS = [
  ['Viu o alerta do Zabbix?', 'Falso positivo de novo…', 'Clássico.'],
  ['Quantos tokens você gastou hoje?', 'Nem me pergunta.', 'O cache salvou a gente.'],
  ['Deploy na sexta?', 'Jamais.', '…foi ontem.'],
  ['Funciona na minha máquina.', 'Sua máquina não vai pra produção.'],
  ['Refatorei tudo!', 'Tinha teste?', '…tinha boa intenção.'],
  ['O dashboard ficou lindo.', 'Tá mostrando o quê?', 'Detalhes.'],
  ['Quem mexeu no YAML?', 'Não fui eu.', 'O git blame diz que foi.'],
  ['Tô esperando o humano responder.', 'Ele foi dormir?', 'Provavelmente.'],
  ['Me pediram "só um ajustezinho".', 'Quantos arquivos?', '47.'],
  ['Bora pedir um subagente?', 'Pra quê?', 'Pra ele ler o README por mim.'],
  ['Achei o bug!', 'Onde?', 'No código que eu escrevi ontem.'],
  ['O Grafana caiu?', 'Não, só o datasource.', 'Ah, então caiu.'],
];
const SMOKE_LINES = ['Só mais um commit…', '*fuuu*', 'Esse bug não me pega.', 'Pausa merecida.', 'Quem precisa de linter?', 'Já volto pro terminal.'];
const COFFEE_LINES = ['☕', 'Café é vida.', 'Mais um expresso…', '☕☕'];

// ---------- sprites ----------
const BASE = [
  '...HHHHHH...',
  '..HHHHHHHH..',
  '..HSSSSSSH..',
  '..SSESSESS..',
  '..SSSSSSSS..',
  '...SSMMSS...',
  '....SSSS....',
  '..TTTTTTTT..',
  '.STTTTTTTTS.',
  '.STTTTTTTTS.',
  '.STTTTTTTTS.',
  '..TTTTTTTT..',
  '..PPPPPPPP..',
  '..PPP..PPP..',
  '..PPP..PPP..',
  '..BBB..BBB..',
];
const patch = (rows, ch) => rows.map((r, i) => (ch[i] !== undefined ? ch[i] : r));
const FRAMES = {
  stand: BASE,
  walk1: patch(BASE, { 13: '..PPP...PP..', 14: '..PPP...PP..', 15: '..BBB...BB..' }),
  walk2: patch(BASE, { 13: '..PP...PPP..', 14: '..PP...PPP..', 15: '..BB...BBB..' }),
  type1: patch(BASE, { 8: 'STTTTTTTTTS.', 9: '.TTTTTTTTTS.', 10: '..TTTTTTTTS.' }),
  type2: patch(BASE, { 8: '.STTTTTTTTTS', 9: '.STTTTTTTTT.', 10: '.STTTTTTTT..' }),
  read:  patch(BASE, { 3: '..SSSSSSSS..', 4: '..SSESSESS..' }),
  sleep: patch(BASE, { 3: '..SKKSSKKS..', 5: '...SSSSSS...' }),
  puff:  patch(BASE, { 5: '...SSMMSSS..', 6: '....SSSSSS..', 7: '..TTTTTTTTS.', 8: '.STTTTTTTT..', 9: '.STTTTTTTT..' }),
  talk:  patch(BASE, { 5: '...SSKKSS...' }),
};

const SKINS = ['#f5d0a9', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const HAIRS = ['#2b1d0e', '#6b3e1e', '#d6a84f', '#1f2937', '#b91c1c', '#7c3aed', '#e5e7eb'];

function hash(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function paletteFor(id) {
  const h = hash(id);
  return {
    H: HAIRS[(h >> 8) % HAIRS.length], S: SKINS[(h >> 16) % SKINS.length],
    T: `hsl(${h % 360} 65% 55%)`, P: '#2f3e66', B: '#1f1b2e', E: '#1a1625', K: '#1a1625', M: '#a0522d',
  };
}
function drawSprite(frame, pal, x, y, maxRows = 16) {
  const rows = FRAMES[frame];
  for (let r = 0; r < Math.min(maxRows, rows.length); r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const k = row[c];
      if (k === '.') continue;
      ctx.fillStyle = pal[k];
      ctx.fillRect(x + c, y + r, 1, 1);
    }
  }
}

// ---------- utilidades ----------
const canvas = document.getElementById('office');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const wrap = document.getElementById('office-wrap');
const emptyEl = document.getElementById('empty');
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
const params = new URLSearchParams(location.search);
let pipWin = null;
let promptsEnabled = true; // o servidor pode desligar o envio de prompts
const raf = (fn) => (pipWin || window).requestAnimationFrame(fn);

// ---------- mundo ----------
let world = null;
let agents = [];
const chars = new Map();
const taken = new Set(); // vagas ocupadas (fumódromo, café, bancos, praça)
let H = 300, S = 2;

function buildWorld(deskCount) {
  const rows = Math.max(2, Math.ceil(deskCount / 4));
  const O = { x: 16, y: 24, w: 4 * DESK_W + 16, h: 18 + rows * DESK_H + 20 };
  const ob = O.y + O.h; // base do escritório = topo da calçada
  const P0 = ob + 62;   // topo da praça
  H = P0 + 128;

  const desks = [];
  for (let i = 0; i < rows * 4; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    const ox = O.x + 8 + col * DESK_W, oy = O.y + 18 + row * DESK_H;
    desks.push({ ox, oy, seat: { x: ox + 26, y: oy + 4 }, corridorX: ox - 2 });
  }

  const spot = (kind, i, x, y, posture) => ({ key: `${kind}:${i}`, kind, x, y, posture });
  const smoke = [[306, ob - 52], [322, ob - 52], [350, ob - 30], [366, ob - 30]].map(([x, y], i) => spot('smoke', i, x, y, 'stand'));
  const cafe = [[399, ob - 36], [423, ob - 36], [451, ob - 36], [475, ob - 36]].map(([x, y], i) => spot('cafe', i, x, y, 'sit'));
  const benches = [{ x: 64, y: P0 + 30 }, { x: 64, y: P0 + 92 }, { x: 420, y: P0 + 30 }, { x: 420, y: P0 + 92 }];
  const bench = benches.flatMap((b, i) => [spot('bench', i * 2, b.x + 1, b.y - 12, 'sit'), spot('bench', i * 2 + 1, b.x + 15, b.y - 12, 'sit')]);
  const plaza = [[132, 10], [148, 10], [348, 10], [364, 10], [150, 76], [166, 76], [330, 76], [346, 76]]
    .map(([x, y], i) => spot('plaza', i, x, P0 + y, 'stand'));
  const pairsOf = (list) => list.reduce((acc, s, i) => (i % 2 ? acc : [...acc, [s, list[i + 1]]]), []);

  // grama, flores e pedrinhas com posição fixa
  const seed = mulberry(42);
  const tufts = Array.from({ length: 420 }, () => ({ x: Math.floor(seed() * W), y: Math.floor(seed() * H), c: seed() < 0.5 ? '#4d7c0f' : '#65a30d' }));
  const flowers = Array.from({ length: 40 }, () => ({ x: Math.floor(seed() * W), y: P0 + 4 + Math.floor(seed() * 116), c: pick(['#f472b6', '#facc15', '#f8fafc', '#fb923c']) }))
    .filter((f) => Math.hypot(f.x - 256, f.y - (P0 + 52)) > 44);

  return {
    rows, O, ob, P0, desks,
    doorX: O.x + O.w / 2 - 6,
    stripY: ob - 22,
    SWY: ob + 2,
    spots: { smoke, cafe, bench, plaza },
    pairs: { smoke: pairsOf(smoke), cafe: pairsOf(cafe), bench: pairsOf(bench), plaza: pairsOf(plaza) },
    benches,
    tables: [{ x: 417, y: ob - 24 }, { x: 469, y: ob - 24 }],
    fountain: { x: 256, y: P0 + 52 },
    trees: [[300, O.y + 18], [334, O.y + 34], [372, O.y + 16], [16, P0 + 64], [488, P0 + 10], [208, P0 + 116], [306, P0 + 120], [496, P0 + 104], [110, P0 + 118]],
    lamps: [[40, ob + 57], [200, ob + 57], [330, ob + 57], [470, ob + 57], [126, P0 + 52], [384, P0 + 52]],
    tufts, flowers,
    car: { active: false, nextAt: performance.now() + 4000 },
  };
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layout() {
  const maxDesk = Math.max(0, ...[...chars.values()].filter((c) => !c.npc).map((c) => c.deskIdx + 1));
  const prev = world;
  world = buildWorld(Math.max(maxDesk, agents.length));
  if (prev && prev.ob !== world.ob) {
    // o escritório cresceu/encolheu: realoca quem está fora e manda quem está dentro para a mesa
    for (const ch of chars.values()) {
      endAct(ch, performance.now());
      ch.path = [];
      if (ch.npc) { placeNpc(ch); continue; }
      const d = world.desks[ch.deskIdx];
      ch.x = d.seat.x; ch.y = d.seat.y; ch.inside = true;
    }
  }
  wrap.style.setProperty('--ratio', String(W / H));
  const dpr = (pipWin || window).devicePixelRatio || 1;
  S = Math.max(1, Math.ceil(((wrap.clientWidth || W) * dpr) / W));
  canvas.width = W * S;
  canvas.height = H * S;
  canvas.style.aspectRatio = `${W} / ${H}`;
}

// ---------- personagens ----------
function getChar(a) {
  let ch = chars.get(a.id);
  if (!ch) {
    const used = new Set([...chars.values()].filter((c) => !c.npc).map((c) => c.deskIdx));
    let deskIdx = 0;
    while (used.has(deskIdx)) deskIdx++;
    ch = newChar(a.id);
    ch.deskIdx = deskIdx;
    chars.set(a.id, ch);
    if (world && deskIdx >= world.desks.length) layout();
    const d = world.desks[deskIdx];
    ch.x = d.seat.x; ch.y = d.seat.y;
  }
  ch.data = a;
  return ch;
}

function newChar(id) {
  const ch = {
    id, pal: paletteFor(id), path: [], inside: true, act: null,
    nextActAt: 0, freeAt: 0, speech: null, smoke: [], lastPuffSpawn: 0, phase: Math.random() * 10,
  };
  ch.bubble = document.createElement('div');
  ch.bubble.className = 'bubble';
  ch.tag = document.createElement('div');
  ch.tag.className = 'nametag';
  overlay.append(ch.bubble, ch.tag);
  return ch;
}

function placeNpc(ch) {
  ch.inside = false;
  ch.x = pick([[30, 190], [310, 470]].map(([a, b]) => a + rnd(b - a)));
  ch.y = world.P0 + rnd(100);
}

function spawnNpcs() {
  if (params.get('npcs') === '0') return;
  for (const n of NPCS) {
    const ch = newChar(n.id);
    ch.npc = true;
    ch.data = { id: n.id, name: n.name, npc: true, status: { state: 'npc', text: 'Morador da cidade' } };
    placeNpc(ch);
    chars.set(n.id, ch);
  }
}
const npcList = () => [...chars.values()].filter((c) => c.npc);

const desk = (ch) => world.desks[ch.deskIdx];
const atSeat = (ch) => !ch.npc && ch.x === desk(ch).seat.x && ch.y === desk(ch).seat.y;
const say = (ch, text, ms, now) => { ch.speech = { text, until: now + ms }; };

function goToSpot(ch, s) {
  const pts = [];
  let cur = { x: ch.x, y: ch.y };
  if (ch.inside) {
    const d = desk(ch);
    pts.push({ x: d.corridorX, y: ch.y }, { x: d.corridorX, y: world.stripY }, { x: world.doorX, y: world.stripY }, { x: world.doorX, y: world.SWY });
    cur = pts[pts.length - 1];
    ch.inside = false;
  }
  pts.push({ x: cur.x, y: world.SWY }, { x: s.x, y: world.SWY }, { x: s.x, y: s.y });
  ch.path = pts;
}

function goToDesk(ch) {
  const d = desk(ch);
  const pts = [];
  if (!ch.inside) pts.push({ x: ch.x, y: world.SWY }, { x: world.doorX, y: world.SWY });
  pts.push({ x: world.doorX, y: world.stripY }, { x: d.corridorX, y: world.stripY }, { x: d.corridorX, y: d.seat.y }, { x: d.seat.x, y: d.seat.y });
  ch.path = pts;
  ch.inside = true;
}

function move(ch, dt) {
  let budget = SPEED * dt;
  while (budget > 0 && ch.path.length) {
    const t = ch.path[0];
    const dx = t.x - ch.x, dy = t.y - ch.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist <= budget) { ch.x = t.x; ch.y = t.y; budget -= dist; ch.path.shift(); continue; }
    if (dx) ch.x += Math.sign(dx) * Math.min(budget, Math.abs(dx));
    else ch.y += Math.sign(dy) * Math.min(budget, Math.abs(dy));
    budget = 0;
  }
}

// ---------- atividades de lazer ----------
function free(ch, now) {
  // qualquer um à toa (fora de outra conversa e não cochilando) pode ser chamado pra conversar
  return !WORK.has(ch.data.status.state) && !ch.path.length && now >= ch.freeAt
    && (!ch.act || (ch.act.type !== 'chat' && !(ch.act.type === 'bench' && ch.data.status.state === 'away')));
}

function endAct(ch, now) {
  const a = ch.act;
  if (!a) return;
  if (a.spot) taken.delete(a.spot.key);
  ch.act = null;
  ch.nextActAt = now + 1500 + rnd(4000);
  if (a.conv) for (const m of a.conv.members) if (m !== ch && m.act && m.act.conv === a.conv) endAct(m, now);
}

function startSolo(ch, kind, now) {
  const options = world.spots[kind].filter((s) => !taken.has(s.key));
  if (!options.length) return false;
  const s = pick(options);
  taken.add(s.key);
  const away = ch.data.status.state === 'away';
  const dur = { smoke: 18000 + rnd(15000), cafe: 20000 + rnd(20000), bench: away ? 60000 + rnd(60000) : 20000 + rnd(30000) }[kind];
  ch.act = { type: kind, spot: s, dur, until: 0, nextLineAt: now + 4000 + rnd(5000) };
  goToSpot(ch, s);
  return true;
}

function startChat(ch, now) {
  const partners = [...chars.values()].filter((o) => o !== ch && o.data && free(o, now));
  if (!partners.length) return false;
  const p = pick(partners);
  const kinds = ['plaza', 'plaza', 'smoke', 'cafe', 'bench'];
  for (let tries = 0; tries < 6; tries++) {
    const kind = pick(kinds);
    const pair = pick(world.pairs[kind]);
    if (!pair || pair.some((s) => taken.has(s.key))) continue;
    endAct(p, now);
    pair.forEach((s) => taken.add(s.key));
    const conv = { lines: pick(CHATS), idx: 0, nextAt: 0, members: [ch, p], smoking: kind === 'smoke' };
    ch.act = { type: 'chat', spot: pair[0], conv };
    p.act = { type: 'chat', spot: pair[1], conv };
    goToSpot(ch, pair[0]);
    goToSpot(p, pair[1]);
    return true;
  }
  return false;
}

function startWander(ch) {
  const zones = [[20, 190], [310, 480]];
  const [a, b] = pick(zones);
  const s = { key: null, x: a + rnd(b - a), y: world.P0 + rnd(100), posture: 'stand' };
  ch.act = { type: 'wander', spot: null, dur: 2000 + rnd(4000), until: 0 };
  goToSpot(ch, s);
}

function pickActivity(ch, now) {
  const away = ch.data.status.state === 'away';
  const r = Math.random();
  if (r < 0.5 && startChat(ch, now)) return;
  if (r < 0.62 && startSolo(ch, 'smoke', now)) return;
  if (r < 0.76 && startSolo(ch, 'cafe', now)) return;
  if ((r < 0.9 || away) && startSolo(ch, 'bench', now)) return;
  startWander(ch);
}

function tickAct(ch, now) {
  const a = ch.act;
  if (a.type === 'chat') {
    const c = a.conv;
    if (c.members[0] !== ch) return;
    if (c.members.some((m) => m.path.length)) return; // esperando os dois chegarem
    if (!c.nextAt) c.nextAt = now + 600;
    if (now < c.nextAt) return;
    if (c.idx < c.lines.length) {
      say(c.members[c.idx % 2], c.lines[c.idx], 2700, now);
      c.idx++;
      c.nextAt = now + 3000;
    } else {
      endAct(ch, now);
    }
    return;
  }
  if (!a.until) a.until = now + a.dur;
  if (now > a.until) { endAct(ch, now); return; }
  if (a.nextLineAt && now > a.nextLineAt) {
    if (a.type === 'smoke') say(ch, pick(SMOKE_LINES), 2800, now);
    if (a.type === 'cafe') say(ch, pick(COFFEE_LINES), 2200, now);
    a.nextLineAt = now + 8000 + rnd(8000);
  }
}

function think(ch, now) {
  const working = WORK.has(ch.data.status.state);
  if (working !== ch.wasWorking) {
    if (working) { endAct(ch, now); ch.speech = null; }
    else ch.freeAt = now + (ch.wasWorking === undefined ? rnd(2500) : 4500);
    ch.justFinished = ch.wasWorking === true && !working;
    ch.wasWorking = working;
  }
  if (ch.path.length) return;
  if (working) { if (!atSeat(ch)) goToDesk(ch); return; }
  if (now < ch.freeAt) return;
  ch.justFinished = false;
  if (!ch.act) { if (now >= ch.nextActAt) pickActivity(ch, now); return; }
  tickAct(ch, now);
}

// ---------- desenho do cenário ----------
function drawGround(t) {
  const { O, ob, P0 } = world;
  rect(0, 0, W, H, '#5b8c1a');
  for (const g of world.tufts) rect(g.x, g.y, 1, 2, g.c);

  // calçadas e rua
  rect(0, ob, W, 20, '#b8b2aa');
  for (let x = 0; x < W; x += 12) rect(x, ob, 1, 20, '#a39d95');
  rect(0, ob + 19, W, 1, '#8a847c');
  rect(0, ob + 20, W, 26, '#3f4451');
  for (let x = 0; x < W; x += 24) rect(x, ob + 32, 12, 2, '#facc15');
  for (let i = 0; i < 6; i++) rect(world.doorX - 6 + i * 4, ob + 21, 2, 24, '#e5e7eb'); // faixa de pedestre
  rect(0, ob + 46, W, 12, '#b8b2aa');
  for (let x = 6; x < W; x += 12) rect(x, ob + 46, 1, 12, '#a39d95');

  // praça: caminho de pedra até a fonte
  const f = world.fountain;
  rect(f.x - 10, ob + 58, 20, f.y - ob - 58, '#d6d3d1');
  for (let r = 44; r > 0; r -= 2) {
    const w = Math.round(Math.sqrt(44 * 44 - r * r) * 1.35);
    rect(f.x - w, f.y - r * 0.7, w * 2, 2, '#d6d3d1');
    rect(f.x - w, f.y + r * 0.7 - 2, w * 2, 2, '#d6d3d1');
  }
  rect(f.x - 60, f.y - 2, 120, 4, '#d6d3d1');
  for (const fl of world.flowers) { rect(fl.x, fl.y, 2, 2, fl.c); rect(fl.x, fl.y + 2, 1, 2, '#3f6212'); }

  // escritório (cortado para ver por dentro)
  rect(O.x - 2, O.y - 16, O.w + 4, 16, '#7f1d1d');
  for (let x = O.x; x < O.x + O.w; x += 8) rect(x, O.y - 16, 1, 16, '#991b1b');
  rect(O.x + O.w / 2 - 34, O.y - 14, 68, 11, '#422006');
  text('CLAUDE HQ', O.x + O.w / 2, O.y - 5, '#fde68a', 8);
  rect(O.x, O.y, O.w, O.h, '#cbd5e1');
  rect(O.x + 4, O.y + 14, O.w - 8, O.h - 18, '#8b5a2b');
  for (let y = O.y + 14; y < O.y + O.h - 4; y += 5) rect(O.x + 4, y, O.w - 8, 1, '#7a4d24');
  rect(O.x + 4, O.y, O.w - 8, 14, '#e2e8f0');
  for (let x = O.x + 16; x < O.x + O.w - 30; x += 56) { rect(x, O.y + 3, 22, 9, '#334155'); rect(x + 1, O.y + 4, 20, 7, '#7dd3fc'); }
  rect(O.x + O.w - 30, O.y + 3, 18, 9, '#f8fafc'); rect(O.x + O.w - 28, O.y + 6, 10, 1, '#ef4444'); rect(O.x + O.w - 28, O.y + 8, 7, 1, '#3b82f6');
  rect(O.x + O.w / 2 - 10, O.y + O.h - 4, 20, 4, '#a16207'); // tapete da porta

  // fumódromo
  const fx = 296, fy = ob - 76;
  rect(fx, fy, 88, 76, '#8b8580');
  for (let y = fy; y < ob; y += 8) rect(fx, y, 88, 1, '#79736e');
  for (let x = fx; x < fx + 88; x += 8) rect(x, fy, 1, 76, '#79736e');
  for (let x = fx; x < fx + 88; x += 8) { rect(x, fy, 4, 3, '#facc15'); rect(x + 4, fy, 4, 3, '#1f2937'); }
  rect(fx + 30, fy + 5, 54, 9, '#1f2937');
  text('FUMÓDROMO', fx + 57, fy + 12, '#fef3c7', 6);

  // café
  const cx = 392, cy = ob - 112;
  rect(cx, cy + 66, 112, 46, '#c2410c');
  for (let y = cy + 66; y < ob; y += 6) for (let x = cx + ((y / 6) % 2) * 6; x < cx + 112; x += 12) rect(x, y, 6, 6, '#b8400c');
  rect(cx + 2, cy, 108, 60, '#fef3c7');
  rect(cx, cy - 6, 112, 8, '#7c2d12');
  text('CAFÉ', cx + 56, cy + 1, '#fde68a', 7);
  rect(cx + 10, cy + 12, 26, 18, '#1e3a5f'); rect(cx + 11, cy + 13, 24, 16, '#93c5fd');
  rect(cx + 76, cy + 12, 26, 18, '#1e3a5f'); rect(cx + 77, cy + 13, 24, 16, '#93c5fd');
  rect(cx + 48, cy + 30, 16, 30, '#78350f'); rect(cx + 60, cy + 44, 2, 2, '#fde68a');
  for (let x = cx; x < cx + 112; x += 8) { rect(x, cy + 34, 4, 7, '#dc2626'); rect(x + 4, cy + 34, 4, 7, '#f8fafc'); }
  rect(cx, cy + 41, 112, 1, '#7f1d1d');
  rect(cx, cy + 60, 112, 6, '#a8a29e');
}

function text(str, x, y, color, size) {
  ctx.font = `bold ${size}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function drawDesk(d, ch, t) {
  const { ox, oy } = d;
  const st = ch ? ch.data.status.state : null;
  const there = ch && atSeat(ch) && WORK.has(st);
  const color = there ? STATE[st].color : '#374151';
  rect(ox + 12, oy + 16, 40, 4, '#a16a3c');
  rect(ox + 12, oy + 20, 40, 10, '#7a4d2a');
  rect(ox + 14, oy + 30, 3, 3, '#5c3a20'); rect(ox + 47, oy + 30, 3, 3, '#5c3a20');
  rect(ox + 38, oy + 5, 13, 10, '#1f2937'); rect(ox + 43, oy + 15, 3, 2, '#111827');
  const blink = st === 'waiting' ? Math.floor(t / 300) % 2 : 1;
  rect(ox + 44, oy + 9, 2, 2, there && blink ? color : '#4b5563');
  if (there) { ctx.globalAlpha = 0.2; rect(ox + 34, oy + 3, 21, 15, color); ctx.globalAlpha = 1; }
  rect(ox + 15, oy + 12, 4, 4, '#e5e7eb'); rect(ox + 19, oy + 13, 1, 2, '#e5e7eb');
  if (there && st === 'delegating') {
    const n = Math.min(Math.max(1, ch.data.status.parallel || 1), 3);
    for (let i = 0; i < n; i++) drawBot(ox + 2 - (i % 2) * 2, oy + 2 + i * 9 + (Math.floor(t / 200 + i) % 2));
  }
}
function drawChair(d) { rect(d.seat.x - 2, d.oy + 1, 16, 17, '#4b4475'); rect(d.seat.x - 1, d.oy + 2, 14, 3, '#5b5390'); }
function drawBot(x, y) {
  rect(x, y, 6, 5, '#f472b6'); rect(x + 1, y + 1, 1, 1, '#1a1625'); rect(x + 4, y + 1, 1, 1, '#1a1625');
  rect(x + 2, y - 2, 1, 2, '#fde68a'); rect(x + 1, y + 5, 4, 2, '#be185d');
}
function drawFrontWall() {
  const { O } = world;
  const y = O.y + O.h - 4;
  rect(O.x, y, O.w / 2 - 10, 4, '#94a3b8');
  rect(O.x + O.w / 2 + 10, y, O.w / 2 - 10, 4, '#94a3b8');
  rect(O.x, O.y, 4, O.h, '#94a3b8'); rect(O.x + O.w - 4, O.y, 4, O.h, '#94a3b8');
}
function drawTree(x, y) {
  rect(x - 2, y - 8, 4, 8, '#78350f');
  rect(x - 9, y - 22, 18, 14, '#166534'); rect(x - 7, y - 25, 14, 3, '#166534'); rect(x - 11, y - 19, 22, 8, '#15803d');
  rect(x - 6, y - 22, 6, 4, '#22c55e'); rect(x - 9, y - 9, 18, 1, '#14532d');
}
function drawLamp(x, y) { rect(x, y - 20, 2, 20, '#1f2937'); rect(x - 2, y - 23, 6, 3, '#374151'); rect(x - 1, y - 21, 4, 1, '#fde68a'); }
function drawBench(b) {
  rect(b.x, b.y - 3, 28, 2, '#78350f');
  rect(b.x, b.y, 28, 3, '#a16207'); rect(b.x, b.y + 3, 28, 2, '#78350f');
  rect(b.x + 2, b.y + 5, 2, 3, '#44403c'); rect(b.x + 24, b.y + 5, 2, 3, '#44403c');
}
function drawTable(tb) {
  rect(tb.x - 7, tb.y - 4, 14, 6, '#78350f'); rect(tb.x - 6, tb.y - 5, 12, 3, '#a16207');
  rect(tb.x - 1, tb.y + 2, 2, 4, '#44403c'); rect(tb.x - 3, tb.y - 6, 2, 2, '#f8fafc'); rect(tb.x + 2, tb.y - 6, 2, 2, '#f8fafc');
}
function drawAshtray(x, y) { rect(x, y - 9, 2, 9, '#57534e'); rect(x - 2, y - 11, 6, 2, '#a8a29e'); rect(x - 1, y - 12, 1, 1, '#ef4444'); }
function drawFountain(f, t) {
  for (let r = 22; r > 0; r -= 1) { const w = Math.round(Math.sqrt(22 * 22 - r * r) * 1.4); rect(f.x - w, f.y - r * 0.55, w * 2, 1, '#94a3b8'); rect(f.x - w, f.y + r * 0.55, w * 2, 1, '#94a3b8'); }
  rect(f.x - 30, f.y - 1, 60, 3, '#94a3b8');
  for (let r = 18; r > 0; r -= 1) { const w = Math.round(Math.sqrt(18 * 18 - r * r) * 1.4); rect(f.x - w, f.y - r * 0.5, w * 2, 1, '#38bdf8'); rect(f.x - w, f.y + r * 0.5, w * 2, 1, '#38bdf8'); }
  rect(f.x - 24, f.y - 1, 48, 3, '#38bdf8');
  for (let i = 0; i < 6; i++) { const k = (Math.floor(t / 250) + i * 7) % 30; rect(f.x - 18 + k, f.y - 5 + ((i * 3) % 9), 2, 1, '#e0f2fe'); }
  rect(f.x - 2, f.y - 16, 4, 16, '#cbd5e1');
  const h = Math.floor(t / 120) % 4;
  rect(f.x - 1, f.y - 20 - h, 2, 4 + h, '#7dd3fc'); rect(f.x - 4, f.y - 14 + h, 1, 2, '#7dd3fc'); rect(f.x + 3, f.y - 13 + (3 - h), 1, 2, '#7dd3fc');
}
function drawCar(c) {
  rect(c.x, c.y, 24, 9, c.color); rect(c.x + 5, c.y - 4, 13, 5, c.color);
  rect(c.x + 6, c.y - 3, 5, 3, '#bae6fd'); rect(c.x + 12, c.y - 3, 5, 3, '#bae6fd');
  rect(c.x + 3, c.y + 8, 5, 3, '#111827'); rect(c.x + 16, c.y + 8, 5, 3, '#111827');
  rect(c.dir > 0 ? c.x + 23 : c.x, c.y + 2, 1, 2, '#fde68a');
}

function updateCar(now, dt) {
  const c = world.car;
  if (!c.active) {
    if (now < c.nextAt) return;
    c.dir = Math.random() < 0.5 ? 1 : -1;
    Object.assign(c, { active: true, x: c.dir > 0 ? -30 : W + 6, y: world.ob + (c.dir > 0 ? 23 : 33), color: pick(['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#e5e7eb']) });
    return;
  }
  c.x += c.dir * 60 * dt;
  if (c.x < -40 || c.x > W + 40) { c.active = false; c.nextAt = now + 6000 + rnd(14000); }
}

function isNight() {
  if (params.has('night')) return true;
  if (params.has('day')) return false;
  const h = new Date().getHours();
  return h >= 19 || h < 6;
}

// ---------- personagem: pose, cigarro e fumaça ----------
function poseOf(ch) {
  const a = ch.act;
  const arrived = !ch.path.length;
  if (!arrived) return { frame: 'walk', sit: false };
  if (ch.inside && atSeat(ch)) return { frame: 'desk', sit: false };
  const spot = a && a.spot;
  const sit = spot && ch.x === spot.x && ch.y === spot.y && spot.posture === 'sit';
  const smoking = a && (a.type === 'smoke' || (a.type === 'chat' && a.conv.smoking)) && spot && ch.x === spot.x && ch.y === spot.y;
  return { frame: 'leisure', sit, smoking };
}

function drawChar(ch, t) {
  const st = ch.data.status.state;
  const pose = poseOf(ch);
  const x = Math.round(ch.x), y = Math.round(ch.y);
  let frame = 'stand';
  if (pose.frame === 'walk') frame = Math.floor(t / 170 + ch.phase) % 2 ? 'walk1' : 'walk2';
  else if (pose.frame === 'desk') {
    if (st === 'typing' || st === 'delegating') frame = Math.floor(t / 160 + ch.phase) % 2 ? 'type1' : 'type2';
    else if (st === 'reading') frame = Math.floor(t / 900 + ch.phase) % 3 === 0 ? 'stand' : 'read';
    drawSprite(frame, ch.pal, x, y, 13);
    return;
  }
  const talking = ch.speech && ch.speech.until > t && ch.act && ch.act.type === 'chat';
  const puffing = pose.smoking && Math.floor(t / 1000 + ch.phase) % 5 === 0;
  if (pose.sit && ch.act && ch.act.type === 'bench' && st === 'away') frame = 'sleep';
  else if (puffing) frame = 'puff';
  else if (talking && Math.floor(t / 200) % 2) frame = 'talk';

  if (pose.sit) drawSprite(frame, ch.pal, x, y + 2, 12);
  else drawSprite(frame, ch.pal, x, y);

  if (pose.smoking) {
    const tip = puffing ? { x: x + 10, y: y + 5 } : { x: x + 11, y: y + 10 };
    rect(tip.x - 2, tip.y, 3, 1, '#f8fafc'); rect(tip.x + 1, tip.y, 1, 1, '#f97316');
    if (t - ch.lastPuffSpawn > 260) { ch.smoke.push({ x: tip.x + 1, y: tip.y - 1, born: t, drift: Math.random() - 0.5 }); ch.lastPuffSpawn = t; }
  }
}

function drawSmoke(ch, t) {
  ch.smoke = ch.smoke.filter((p) => t - p.born < 2400);
  for (const p of ch.smoke) {
    const age = (t - p.born) / 1000;
    ctx.globalAlpha = Math.max(0, 0.7 - age * 0.3);
    rect(Math.round(p.x + p.drift * age * 6 + Math.sin(age * 3 + p.born) * 1.5), Math.round(p.y - age * 7), age > 1 ? 2 : 1, age > 1 ? 2 : 1, '#e5e7eb');
  }
  ctx.globalAlpha = 1;
}

function bubbleFor(ch, t) {
  const s = ch.data.status;
  if (WORK.has(s.state)) {
    if (!(ch.inside && atSeat(ch))) return { text: '🏃 Voltando pro trabalho!', cls: 'work' };
    const dots = '.'.repeat(1 + (Math.floor(t / 400) % 3));
    let action = s.text;
    if (s.state === 'thinking') action = s.narration ? `💭 ${s.narration}` : `Pensando${dots}`;
    if (s.state === 'waiting') action = '❗ ' + s.text;
    // alterna entre o que está fazendo e o que está dizendo, quando há narração
    if (s.state !== 'thinking' && s.state !== 'waiting' && s.narration && Math.floor(t / 4000 + ch.phase) % 3 === 2) action = `💬 ${s.narration}`;
    return { text: action, goal: s.goal, cls: s.state };
  }
  if (ch.justFinished && t < ch.freeAt) return { text: '✅ Terminei! Esperando você', cls: 'done' };
  if (ch.speech && ch.speech.until > t) return { text: ch.speech.text, cls: 'talk' };
  if (ch.act && ch.act.type === 'bench' && s.state === 'away' && !ch.path.length) {
    return { text: 'z'.repeat(1 + (Math.floor(t / 600) % 3)) + 'Z', cls: 'sleeping' };
  }
  return null;
}

// ---------- loop ----------
let lastT = performance.now();
function render(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  if (!world) { raf(render); return; }
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.imageSmoothingEnabled = false;
  drawGround(t);

  const list = [...agents.map((a) => chars.get(a.id)).filter(Boolean), ...npcList()];
  for (const ch of list) { think(ch, t); move(ch, dt); }
  updateCar(t, dt);

  const byDesk = new Map(list.filter((c) => !c.npc).map((c) => [c.deskIdx, c]));
  const draws = [];
  world.desks.forEach((d, i) => {
    const ch = byDesk.get(i);
    draws.push({ k: d.oy + 17.5, fn: () => drawChair(d) });
    draws.push({ k: d.oy + 33, fn: () => drawDesk(d, ch, t) });
  });
  draws.push({ k: world.O.y + world.O.h, fn: drawFrontWall });
  for (const [x, y] of world.trees) draws.push({ k: y, fn: () => drawTree(x, y) });
  for (const [x, y] of world.lamps) draws.push({ k: y, fn: () => drawLamp(x, y) });
  for (const b of world.benches) draws.push({ k: b.y + 5, fn: () => drawBench(b) });
  for (const tb of world.tables) draws.push({ k: tb.y + 6, fn: () => drawTable(tb) });
  draws.push({ k: world.ob - 40, fn: () => drawAshtray(338, world.ob - 40) });
  draws.push({ k: world.fountain.y + 12, fn: () => drawFountain(world.fountain, t) });
  if (world.car.active) draws.push({ k: world.car.y + 11, fn: () => drawCar(world.car) });
  for (const ch of list) draws.push({ k: ch.y + 16, fn: () => drawChar(ch, t) });
  draws.sort((a, b) => a.k - b.k).forEach((d) => d.fn());
  for (const ch of list) drawSmoke(ch, t);

  if (isNight()) drawNight();
  placeOverlay(list, t);
  raf(render);
}

function drawNight() {
  rect(0, 0, W, H, 'rgba(15, 18, 50, 0.5)');
  ctx.globalCompositeOperation = 'lighter';
  const glow = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255, 200, 110, ${a})`);
    g.addColorStop(1, 'rgba(255, 200, 110, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (const [x, y] of world.lamps) glow(x + 1, y - 21, 26, 0.35);
  const { O } = world;
  ctx.fillStyle = 'rgba(255, 190, 110, 0.12)';
  ctx.fillRect(O.x + 4, O.y + 14, O.w - 8, O.h - 18);
  glow(448, world.ob - 70, 50, 0.18);
  ctx.globalCompositeOperation = 'source-over';
}

function placeOverlay(list, t) {
  const k = canvas.clientWidth / W;
  if (k !== placeOverlay.k) { placeOverlay.k = k; overlay.style.setProperty('--bubble-max', `${Math.round(DESK_W * 1.5 * k)}px`);
    overlay.style.setProperty('--fs', `${clamp(5.4 * k, 7.5, 11).toFixed(1)}px`);
    overlay.style.setProperty('--tag-fs', `${clamp(4.4 * k, 7, 9).toFixed(1)}px`);
  }
  for (const ch of list) {
    const b = bubbleFor(ch, t);
    const sitDy = poseOf(ch).sit ? 2 : 0;
    if (b) {
      ch.bubble.hidden = false;
      ch.bubble.className = `bubble ${b.cls}`;
      const html = b.goal ? `<b>🎯 ${esc(b.goal)}</b><span>${esc(b.text)}</span>` : `<span>${esc(b.text)}</span>`;
      if (ch.bubbleHtml !== html) { ch.bubble.innerHTML = html; ch.bubbleHtml = html; }
      const half = ch.bubble.offsetWidth / 2;
      ch.bubble.style.left = `${clamp((ch.x + 6) * k, half + 2, W * k - half - 2)}px`;
      ch.bubble.style.top = `${(ch.y - 2 + sitDy) * k}px`;
    } else ch.bubble.hidden = true;
    const st = STATE[ch.data.status.state] || STATE.idle;
    ch.tag.innerHTML = `<i style="background:${st.color}"></i>${esc(ch.data.name)}`;
    ch.tag.style.left = `${(ch.x + 6) * k}px`;
    ch.tag.style.top = `${(ch.y + 17) * k}px`;
    ch.tag.style.zIndex = Math.round(ch.y);
  }
}

// ---------- painel ----------
function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(n);
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s atrás`;
  if (s < 3600) return `${Math.round(s / 60)}min atrás`;
  if (s < 86400) return `${Math.round(s / 3600)}h atrás`;
  return `${Math.round(s / 86400)}d atrás`;
}

function activityText(a) {
  const ch = chars.get(a.id);
  if (WORK.has(a.status.state) || !ch) return a.status.text;
  const act = ch.act;
  const prefix = a.status.state === 'idle' ? 'Terminou, esperando você' : 'De folga';
  if (!act) return prefix;
  const where = {
    smoke: 'fumando no fumódromo 🚬',
    cafe: 'tomando café ☕',
    bench: a.status.state === 'away' ? 'cochilando no banco da praça 💤' : 'sentado na praça',
    wander: 'passeando pela praça',
    chat: `conversando com ${act.conv ? esc(act.conv.members.find((m) => m !== ch)?.data.name) : 'alguém'} 💬`,
  }[act.type];
  return `${prefix} · ${where}`;
}

function renderPanel() {
  const panel = document.getElementById('panel');
  const tot = { all: 0, output: 0, working: 0 };
  for (const a of agents) {
    tot.all += a.total;
    tot.output += a.usage.output + a.subUsage.output;
    if (WORK.has(a.status.state)) tot.working++;
  }
  document.getElementById('s-agents').textContent = agents.length;
  document.getElementById('s-working').textContent = tot.working;
  document.getElementById('s-total').textContent = fmt(tot.all);
  document.getElementById('s-output').textContent = fmt(tot.output);
  emptyEl.hidden = agents.length > 0;

  const sorted = [...agents].sort((a, b) => (WORK.has(b.status.state) - WORK.has(a.status.state)) || b.total - a.total);
  panel.innerHTML = sorted.map((a) => {
    const st = STATE[a.status.state] || STATE.idle;
    const u = {
      input: a.usage.input + a.subUsage.input,
      output: a.usage.output + a.subUsage.output,
      cacheWrite: a.usage.cacheWrite + a.subUsage.cacheWrite,
      cacheRead: a.usage.cacheRead + a.subUsage.cacheRead,
    };
    const share = tot.all ? Math.round((a.total / tot.all) * 100) : 0;
    const subTotal = a.subUsage.input + a.subUsage.output + a.subUsage.cacheWrite + a.subUsage.cacheRead;
    const bar = Object.entries(u).map(([k, v]) => `<span style="width:${a.total ? (v / a.total) * 100 : 0}%;background:${USAGE_COLORS[k]}"></span>`).join('');
    return `
      <div class="card ${a.status.state === 'away' ? 'dim' : ''}" style="border-left-color:${paletteFor(a.id).T}">
        <div class="top">
          <span class="name" title="${esc(a.cwd)}">${esc(a.name)}</span>
          <span class="chip" style="background:${st.color}">${st.label}</span>
        </div>
        <div class="meta">${esc(a.branch || '—')} · ${esc((a.model || '').replace('claude-', ''))} · ${ago(a.lastEventAt)}</div>
        ${a.status.goal ? `<div class="goal">🎯 ${esc(a.status.goal)}</div>` : ''}
        <div class="activity">${activityText(a)}</div>
        ${a.status.narration ? `<div class="narration">💬 ${esc(a.status.narration)}</div>` : ''}
        ${a.lastPrompt ? `<div class="prompt">“${esc(a.lastPrompt)}”</div>` : ''}
        ${jobHtml(a)}
        <div class="actions">
          <button data-act="chat" data-id="${esc(a.id)}">💬 Conversar</button>
          ${a.lastReply ? `<button data-act="reply" data-id="${esc(a.id)}" class="ghost">📄 Resposta completa</button>` : ''}
        </div>
        <div class="tokens">
          <div><span class="k">input</span><span class="v">${fmt(u.input)}</span></div>
          <div><span class="k">output</span><span class="v">${fmt(u.output)}</span></div>
          <div><span class="k">cache +</span><span class="v">${fmt(u.cacheWrite)}</span></div>
          <div><span class="k">cache lido</span><span class="v">${fmt(u.cacheRead)}</span></div>
        </div>
        <div class="bar">${bar}</div>
        <div class="totalrow"><span>Total: <b>${fmt(a.total)}</b> tokens</span><span>${share}% do total</span></div>
        ${a.subagents ? `<div class="meta">🤖 ${a.subagents} subagente(s): ${fmt(subTotal)} tokens</div>` : ''}
      </div>`;
  }).join('') + (agents.length ? `
      <div class="legend">
        ${Object.entries(USAGE_COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${{ input: 'input', output: 'output', cacheWrite: 'cache escrito', cacheRead: 'cache lido' }[k]}</span>`).join('')}
      </div>` : '');
}

// ---------- dados ----------
function update(list) {
  const before = chars.size;
  agents = list;
  const ids = new Set(list.map((a) => a.id));
  for (const [id, ch] of chars) {
    if (!ch.npc && !ids.has(id)) { endAct(ch, performance.now()); ch.bubble.remove(); ch.tag.remove(); chars.delete(id); }
  }
  if (!world) layout();
  list.forEach(getChar);
  const needRows = Math.max(2, Math.ceil(Math.max(...[...chars.values()].filter((c) => !c.npc).map((c) => c.deskIdx + 1), 1) / 4));
  if (needRows !== world.rows || before !== chars.size) layout();
  renderPanel();
  notifyChanges(list);
  renderTicker(list);
}

function connect() {
  const conn = document.getElementById('conn');
  const es = new EventSource('events');
  es.onopen = () => { conn.textContent = 'ao vivo'; conn.className = 'conn on'; };
  es.onerror = () => { conn.textContent = 'offline'; conn.className = 'conn off'; };
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    promptsEnabled = data.prompts !== false;
    update(data.agents);
  };
}

window.addEventListener('resize', layout);
layout();
spawnNpcs();
// conecta só depois que extras.js e chat.js carregarem
window.addEventListener('load', connect);
raf(render);
// mantém o texto do painel ("conversando com…") atualizado entre eventos do servidor
setInterval(renderPanel, 1500);
