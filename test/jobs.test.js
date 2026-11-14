'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('envia prompt para a sessão (claude -p --resume) e gera resumo', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-jobs-'));
  const dir = path.join(root, '-home-dev-app');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sess-1.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'user', sessionId: 'sess-1', cwd: '/home/dev/app', timestamp: new Date().toISOString(), message: { content: 'oi' } }) + '\n');
  process.env.CLAUDE_BIN = path.join(__dirname, '..', 'lib', 'fake-claude.js');
  process.env.PIXEL_DEMO_DIR = root;
  const { Jobs } = require('../lib/jobs');
  const states = [];
  const jobs = new Jobs({ onChange: () => states.push(jobs.get('sess-1').state) });
  await jobs.send({ id: 'sess-1', cwd: '/home/dev/app' }, 'Corrige o bug do login', 'acceptEdits');
  const j = jobs.byAgent.get('sess-1');
  assert.strictEqual(j.state, 'done', j.error);
  assert.match(j.result, /## O que mudou/);
  assert.match(j.summary, /^Resumo:/);
  assert.deepStrictEqual(states, ['running', 'summarizing', 'done']);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(lines[1].message.content, 'Corrige o bug do login');
});

test('erro amigável quando o claude não existe', async () => {
  process.env.CLAUDE_BIN = 'claude-que-nao-existe-xyz';
  delete process.env.PIXEL_DEMO_DIR;
  const { Jobs } = require('../lib/jobs');
  const jobs = new Jobs({});
  await jobs.send({ id: 'x', cwd: os.tmpdir() }, 'oi', 'default');
  const j = jobs.byAgent.get('x');
  assert.strictEqual(j.state, 'error');
  assert.match(j.error, /claude/);
});

test('resumo rápido pega as primeiras frases sem markdown', () => {
  const { quickSummary } = require('../lib/jobs');
  assert.strictEqual(quickSummary('## Feito\n\nAjustei o **login**. Rodei os testes. Abri o PR.'), 'Feito Ajustei o login. Rodei os testes.');
});
