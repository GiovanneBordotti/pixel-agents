#!/usr/bin/env node
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Watcher } = require('./lib/watcher');
const { startDemo } = require('./lib/demo');

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

const watcher = new Watcher({ projectsDir, activeHours: ACTIVE_HOURS, maxAgents: MAX_AGENTS });
const clients = new Set();

function broadcast() {
  const data = `data: ${JSON.stringify({ agents: watcher.snapshot(), at: Date.now() })}\n\n`;
  for (const res of clients) res.write(data);
}

watcher.start(broadcast);
// re-envia a cada 2s para atualizar estados por tempo (ex.: "aguardando permissão")
setInterval(broadcast, 2000);

const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ agents: watcher.snapshot(), at: Date.now() })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/agents') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ agents: watcher.snapshot(), at: Date.now() }));
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
