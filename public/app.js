'use strict';
/* Pixel Agents — escritório pixel art onde cada terminal do Claude Code é um personagem. */

const COLS_MAX = 4;
const CELL_W = 80;
const CELL_H = 72;
const WALL = 30;
const SPEED = 32; // px lógicos por segundo

const STATE = {
  typing:     { label: 'digitando',  color: '#4ade80' },
  reading:    { label: 'lendo',      color: '#60a5fa' },
  thinking:   { label: 'pensando',   color: '#c084fc' },
  delegating: { label: 'delegando',  color: '#f472b6' },
  waiting:    { label: 'aguardando', color: '#facc15' },
  idle:       { label: 'livre',      color: '#94a3b8' },
  sleeping:   { label: 'dormindo',   color: '#475569' },
};

const USAGE_COLORS = { input: '#60a5fa', output: '#4ade80', cacheWrite: '#f472b6', cacheRead: '#a78bfa' };

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
const patch = (rows, changes) => rows.map((r, i) => (changes[i] !== undefined ? changes[i] : r));
const FRAMES = {
  stand: BASE,
  walk1: patch(BASE, { 13: '..PPP...PP..', 14: '..PPP...PP..', 15: '..BBB...BB..' }),
  walk2: patch(BASE, { 13: '..PP...PPP..', 14: '..PP...PPP..', 15: '..BB...BBB..' }),
  type1: patch(BASE, { 8: 'STTTTTTTTTS.', 9: '.TTTTTTTTTS.', 10: '..TTTTTTTTS.' }),
  type2: patch(BASE, { 8: '.STTTTTTTTTS', 9: '.STTTTTTTTT.', 10: '.STTTTTTTT..' }),
  read:  patch(BASE, { 3: '..SSSSSSSS..', 4: '..SSESSESS..' }),
  sleep: patch(BASE, { 3: '..SKKSSKKS..', 5: '...SSSSSS...' }),
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
  const hue = h % 360;
  return {
    H: HAIRS[(h >> 8) % HAIRS.length],
    S: SKINS[(h >> 16) % SKINS.length],
    T: `hsl(${hue} 65% 55%)`,
    P: '#2f3e66',
    B: '#1f1b2e',
    E: '#1a1625',
    K: '#1a1625',
    M: '#a0522d',
  };
}

function drawSprite(ctx, frame, pal, x, y, maxRows = 16) {
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

// ---------- mundo ----------
const canvas = document.getElementById('office');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const wrap = document.getElementById('office-wrap');
let W = 320, H = 200, scale = 2;
let agents = [];            // dados do servidor
const chars = new Map();    // id -> personagem animado

function layout() {
  const n = Math.max(agents.length, 1);
  const avail = wrap.clientWidth - 4;
  // em telas estreitas usa menos colunas para manter o pixel art legível (escala >= 2)
  const fitCols = Math.max(1, Math.floor(avail / (CELL_W * 2)));
  const cols = Math.min(COLS_MAX, n, fitCols);
  const rows = Math.ceil(n / cols);
  W = cols * CELL_W;
  H = WALL + rows * CELL_H + 6;
  scale = Math.max(1, Math.floor(avail / W));
  overlay.style.setProperty('--bubble-max', `${CELL_W * scale - 10}px`);
  canvas.width = W * scale;
  canvas.height = H * scale;
  canvas.style.width = `${W * scale}px`;
  canvas.style.height = `${H * scale}px`;
  wrap.style.height = `${H * scale + 4}px`;
  agents.forEach((a, i) => {
    const ch = chars.get(a.id);
    const col = i % cols, row = Math.floor(i / cols);
    const ox = col * CELL_W + Math.floor((W - cols * CELL_W) / 2);
    const oy = WALL + row * CELL_H;
    Object.assign(ch, {
      ox, oy,
      seat: { x: ox + 34, y: oy + 12 },
      side: { x: ox + 8 },
      aisleY: oy + 48,
    });
    if (ch.x === undefined) { ch.x = ch.seat.x; ch.y = ch.seat.y; }
  });
}

function getChar(a) {
  let ch = chars.get(a.id);
  if (!ch) {
    ch = { id: a.id, pal: paletteFor(a.id), path: [], wanderAt: 0, phase: Math.random() * 10 };
    ch.bubble = document.createElement('div');
    ch.bubble.className = 'bubble';
    ch.plate = document.createElement('div');
    ch.plate.className = 'nameplate';
    overlay.append(ch.bubble, ch.plate);
    chars.set(a.id, ch);
  }
  ch.data = a;
  return ch;
}

const atSeat = (ch) => ch.x === ch.seat.x && ch.y === ch.seat.y;
const inAisle = (ch) => ch.y === ch.aisleY;

function plan(ch, now) {
  const idle = ch.data.status.state === 'idle';
  if (idle) {
    if (ch.path.length) return;
    if (!inAisle(ch)) {
      ch.path = [{ x: ch.side.x, y: ch.y }, { x: ch.side.x, y: ch.aisleY }, { x: ch.ox + 20 + rnd(40), y: ch.aisleY }];
    } else if (now > ch.wanderAt) {
      ch.path = [{ x: clamp(ch.ox - 6 + rnd(70), 2, W - 14), y: ch.aisleY }];
      ch.wanderAt = now + 2000 + rnd(4000);
    }
  } else if (!atSeat(ch)) {
    const last = ch.path[ch.path.length - 1];
    if (!last || last.x !== ch.seat.x || last.y !== ch.seat.y) {
      ch.path = ch.y === ch.seat.y
        ? [{ x: ch.seat.x, y: ch.seat.y }]
        : [{ x: ch.side.x, y: ch.y }, { x: ch.side.x, y: ch.seat.y }, { x: ch.seat.x, y: ch.seat.y }];
    }
  }
}

function move(ch, dt) {
  let budget = SPEED * dt;
  while (budget > 0 && ch.path.length) {
    const t = ch.path[0];
    const dx = t.x - ch.x, dy = t.y - ch.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist <= budget) {
      ch.x = t.x; ch.y = t.y; budget -= dist; ch.path.shift();
    } else {
      if (dx) ch.x += Math.sign(dx) * Math.min(budget, Math.abs(dx));
      else ch.y += Math.sign(dy) * Math.min(budget, Math.abs(dy));
      budget = 0;
    }
  }
  ch.walking = ch.path.length > 0;
}

const rnd = (n) => Math.floor(Math.random() * n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- desenho ----------
function drawRoom(t) {
  // piso
  for (let y = WALL; y < H; y += 8) {
    for (let x = 0; x < W; x += 8) {
      ctx.fillStyle = ((x + y) / 8) % 2 ? '#2a2440' : '#26203a';
      ctx.fillRect(x, y, 8, 8);
    }
  }
  // parede
  ctx.fillStyle = '#3b3361'; ctx.fillRect(0, 0, W, WALL);
  ctx.fillStyle = '#2e2750'; ctx.fillRect(0, WALL - 4, W, 4);
  // janelas
  for (let x = 16; x < W - 30; x += 70) {
    ctx.fillStyle = '#1b1830'; ctx.fillRect(x, 5, 30, 17);
    ctx.fillStyle = '#4f6db8'; ctx.fillRect(x + 2, 7, 12, 13); ctx.fillRect(x + 16, 7, 12, 13);
    ctx.fillStyle = '#fef9c3';
    const star = (Math.floor(t / 700) + x) % 5;
    ctx.fillRect(x + 4 + star, 9, 1, 1); ctx.fillRect(x + 20, 11 + (star % 3), 1, 1);
  }
  // planta
  const px = W - 16;
  ctx.fillStyle = '#7c4a2a'; ctx.fillRect(px, WALL - 10, 8, 8);
  ctx.fillStyle = '#22c55e'; ctx.fillRect(px - 2, WALL - 18, 4, 8); ctx.fillRect(px + 3, WALL - 22, 3, 12); ctx.fillRect(px + 7, WALL - 17, 4, 7);
}

function drawChair(ch) {
  ctx.fillStyle = '#4b4475';
  ctx.fillRect(ch.seat.x - 2, ch.oy + 8, 16, 18);
  ctx.fillStyle = '#5b5390';
  ctx.fillRect(ch.seat.x - 1, ch.oy + 9, 14, 3);
}

function drawDesk(ch, t) {
  const { ox, oy } = ch;
  const st = ch.data.status.state;
  const color = STATE[st]?.color || '#94a3b8';
  // tampo + frente
  ctx.fillStyle = '#a16a3c'; ctx.fillRect(ox + 18, oy + 24, 50, 4);
  ctx.fillStyle = '#7a4d2a'; ctx.fillRect(ox + 18, oy + 28, 50, 12);
  ctx.fillStyle = '#5c3a20'; ctx.fillRect(ox + 20, oy + 40, 3, 4); ctx.fillRect(ox + 63, oy + 40, 3, 4);
  // monitor (visto de trás) à direita
  ctx.fillStyle = '#1f2937'; ctx.fillRect(ox + 52, oy + 12, 14, 11);
  ctx.fillStyle = '#111827'; ctx.fillRect(ox + 57, oy + 23, 4, 2);
  const on = st !== 'sleeping' && st !== 'idle';
  const blink = st === 'waiting' ? Math.floor(t / 300) % 2 : 1;
  ctx.fillStyle = on && blink ? color : '#374151';
  ctx.fillRect(ox + 58, oy + 16, 2, 2);
  if (on) { ctx.globalAlpha = 0.18; ctx.fillStyle = color; ctx.fillRect(ox + 48, oy + 10, 22, 16); ctx.globalAlpha = 1; }
  // caneca
  ctx.fillStyle = '#e5e7eb'; ctx.fillRect(ox + 22, oy + 20, 4, 4);
  ctx.fillStyle = '#e5e7eb'; ctx.fillRect(ox + 26, oy + 21, 1, 2);
  // subagentes (robozinhos)
  if (st === 'delegating') {
    const n = Math.min(Math.max(1, ch.data.status.parallel || 1), 3);
    for (let i = 0; i < n; i++) {
      drawBot(ox + 4 - (i % 2) * 2, oy + 12 + i * 9 + (Math.floor(t / 200 + i) % 2));
    }
  }
}

function drawBot(x, y) {
  ctx.fillStyle = '#f472b6'; ctx.fillRect(x, y, 6, 5);
  ctx.fillStyle = '#1a1625'; ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillRect(x + 4, y + 1, 1, 1);
  ctx.fillStyle = '#fde68a'; ctx.fillRect(x + 2, y - 2, 1, 2);
  ctx.fillStyle = '#be185d'; ctx.fillRect(x + 1, y + 5, 4, 2);
}

function frameFor(ch, t) {
  const st = ch.data.status.state;
  if (ch.walking) return Math.floor(t / 180 + ch.phase) % 2 ? 'walk1' : 'walk2';
  if (!atSeat(ch)) return 'stand';
  if (st === 'typing' || st === 'delegating') return Math.floor(t / 160 + ch.phase) % 2 ? 'type1' : 'type2';
  if (st === 'reading') return Math.floor(t / 900 + ch.phase) % 3 === 0 ? 'stand' : 'read';
  if (st === 'sleeping') return 'sleep';
  return 'stand';
}

function bubbleText(ch, t) {
  const s = ch.data.status;
  if (s.state === 'thinking') return 'Pensando' + '.'.repeat(1 + (Math.floor(t / 400) % 3));
  if (s.state === 'sleeping') return 'z'.repeat(1 + (Math.floor(t / 600) % 3)) + 'Z';
  if (s.state === 'waiting') return '❗ ' + s.text;
  return s.text;
}

let lastT = performance.now();
function render(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  drawRoom(t);

  const list = agents.map((a) => chars.get(a.id)).filter(Boolean);
  const draws = [];
  for (const ch of list) {
    plan(ch, t);
    move(ch, dt);
    const seated = atSeat(ch);
    const sleepBob = ch.data.status.state === 'sleeping' ? 1 : 0;
    draws.push({ key: ch.oy + 27.5, fn: () => drawChair(ch) });
    draws.push({ key: ch.y + 16, fn: () => drawSprite(ctx, frameFor(ch, t), ch.pal, Math.round(ch.x), Math.round(ch.y) + sleepBob, seated ? 13 : 16) });
    draws.push({ key: ch.oy + 40, fn: () => drawDesk(ch, t) });
  }
  draws.sort((a, b) => a.key - b.key).forEach((d) => d.fn());

  const offX = canvas.offsetLeft;
  for (const ch of list) {
    const s = ch.data.status.state;
    ch.bubble.className = `bubble ${s}`;
    ch.bubble.textContent = bubbleText(ch, t);
    const half = ch.bubble.offsetWidth / 2;
    const bx = clamp(offX + (ch.x + 6) * scale, offX + half + 2, offX + W * scale - half - 2);
    ch.bubble.style.left = `${bx}px`;
    ch.bubble.style.top = `${(ch.y - 3) * scale}px`;
    ch.plate.textContent = ch.data.name;
    ch.plate.style.left = `${offX + (ch.ox + 43) * scale}px`;
    ch.plate.style.top = `${(ch.oy + 31) * scale}px`;
    ch.plate.style.fontSize = `${Math.max(9, 3.2 * scale)}px`;
  }
  requestAnimationFrame(render);
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
  return `${Math.round(s / 3600)}h atrás`;
}

function renderPanel() {
  const panel = document.getElementById('panel');
  const tot = { all: 0, output: 0, working: 0 };
  for (const a of agents) {
    tot.all += a.total;
    tot.output += a.usage.output + a.subUsage.output;
    if (!['idle', 'sleeping'].includes(a.status.state)) tot.working++;
  }
  document.getElementById('s-agents').textContent = agents.length;
  document.getElementById('s-working').textContent = tot.working;
  document.getElementById('s-total').textContent = fmt(tot.all);
  document.getElementById('s-output').textContent = fmt(tot.output);
  document.getElementById('empty').hidden = agents.length > 0;

  const sorted = [...agents].sort((a, b) => b.total - a.total);
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
      <div class="card" style="border-left-color:${paletteFor(a.id).T}">
        <div class="top">
          <span class="name" title="${esc(a.cwd)}">${esc(a.name)}</span>
          <span class="chip" style="background:${st.color}">${st.label}</span>
        </div>
        <div class="meta">${esc(a.branch || '—')} · ${esc((a.model || '').replace('claude-', ''))} · ${ago(a.lastEventAt)}</div>
        <div class="activity">${esc(a.status.text)}</div>
        ${a.lastPrompt ? `<div class="prompt">“${esc(a.lastPrompt)}”</div>` : ''}
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
  const prevIds = agents.map((a) => a.id).join();
  agents = list;
  const ids = new Set(list.map((a) => a.id));
  for (const [id, ch] of chars) {
    if (!ids.has(id)) { ch.bubble.remove(); ch.plate.remove(); chars.delete(id); }
  }
  list.forEach(getChar);
  if (prevIds !== list.map((a) => a.id).join()) layout();
  renderPanel();
}

function connect() {
  const conn = document.getElementById('conn');
  const es = new EventSource('events');
  es.onopen = () => { conn.textContent = 'ao vivo'; conn.className = 'conn on'; };
  es.onerror = () => { conn.textContent = 'offline'; conn.className = 'conn off'; };
  es.onmessage = (e) => update(JSON.parse(e.data).agents);
}

window.addEventListener('resize', layout);
layout();
connect();
requestAnimationFrame(render);
