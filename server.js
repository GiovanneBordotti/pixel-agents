#!/usr/bin/env node
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Watcher } = require('./lib/watcher');
const { startDemo } = require('./lib/demo');
const { Jobs, SUMMARY_DIR } = require('./lib/jobs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const PORT = Number(opt('port', process.env.PORT || 4567));
const HOST = opt('host', process.env.HOST || '127.0.0.1');
const ACTIVE_HOURS = Number(opt('hours', process.env.PIXEL_AGENTS_HOURS || 168));
const MAX_AGENTS = Number(opt('max', process.env.PIXEL_AGENTS_MAX || 12));
const claudeDir = opt('claude-dir', process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const projectsDir = flag('demo') ? startDemo() : path.join(claudeDir, 'projects');
if (flag('demo') && !process.env.CLAUDE_BIN) {
  // no demo, os prompts vão para um "claude" de mentira que escreve no histórico falso
  process.env.CLAUDE_BIN = path.join(__dirname, 'lib', 'fake-claude.js');
  process.env.PIXEL_DEMO_DIR = projectsDir;
}
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
const PROMPTS_ENABLED = !flag('no-prompts') && (LOOPBACK || flag('allow-remote-prompts'));

const watcher = new Watcher({ projectsDir, activeHours: ACTIVE_HOURS, maxAgents: MAX_AGENTS, ignoreCwd: SUMMARY_DIR });
const jobs = new Jobs({ onChange: () => broadcast(), summarize: !flag('no-summary') });
const clients = new Set();

function payload() {
  const agents = watcher.snapshot().map((a) => ({ ...a, job: jobs.get(a.id) }));
  return JSON.stringify({ agents, at: Date.now(), prompts: PROMPTS_ENABLED });
}

function broadcast() {
  const data = `data: ${payload()}\n\n`;
  for (const res of clients) res.write(data);
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (d) => {
      body += d;
      if (body.length > limit) { reject(new Error('Mensagem grande demais.')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Só aceita comandos vindos da própria página (bloqueia sites tentando mandar prompts para o seu localhost)
function sameOrigin(req) {
  if (req.headers['x-pixel-agents'] !== '1') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function handleApi(req, res, url) {
  const m = /^\/api\/agents\/([\w.-]+)\/(prompt|reply)$/.exec(url.pathname);
  if (!m) return false;
  const session = watcher.get(m[1]);
  if (!session) { json(res, 404, { error: 'Agente não encontrado.' }); return true; }

  if (m[2] === 'reply' && req.method === 'GET') {
    const r = session.reply();
    const job = jobs.byAgent.get(session.id);
    if (!r.text && job && job.result) Object.assign(r, { text: job.result, prompt: job.prompt });
    json(res, 200, { name: path.basename(session.cwd || session.id), ...r });
    return true;
  }

  if (m[2] === 'prompt' && req.method === 'POST') {
    if (!PROMPTS_ENABLED) { json(res, 403, { error: 'Envio de prompts desligado neste servidor.' }); return true; }
    if (!sameOrigin(req)) { json(res, 403, { error: 'Origem não permitida.' }); return true; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { json(res, 400, { error: e.message || 'JSON inválido.' }); return true; }
    const text = String(body.text || '').trim();
    if (!text) { json(res, 400, { error: 'Escreva alguma coisa.' }); return true; }
    if (jobs.isRunning(session.id)) { json(res, 409, { error: 'Este agente ainda está respondendo o prompt anterior.' }); return true; }
    jobs.send(session, text, body.mode).catch((e) => console.error('[prompt]', e.message));
    json(res, 202, { ok: true });
    return true;
  }
  json(res, 405, { error: 'Método não permitido.' });
  return true;
}

watcher.start(broadcast);
// re-envia a cada 2s para atualizar estados por tempo (ex.: "aguardando permissão")
setInterval(broadcast, 2000);

const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/agents/')) {
    try { if (await handleApi(req, res, url)) return; } catch (e) { json(res, 500, { error: e.message }); return; }
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${payload()}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/agents') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(payload());
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  👾 Pixel Agents rodando em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  📂 Lendo sessões de: ${projectsDir}${flag('demo') ? ' (modo demo)' : ''}`);
  console.log(`  ⏱  Mostrando até ${MAX_AGENTS} agentes com atividade nas últimas ${ACTIVE_HOURS}h\n`);
  if (flag('open')) openBrowser(`http://localhost:${PORT}`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`  A porta ${PORT} já está em uso (o Pixel Agents já está rodando?).`);
    if (flag('open')) openBrowser(`http://localhost:${PORT}`);
    setTimeout(() => process.exit(0), 1500);
  } else throw e;
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* sem navegador */ }
}
