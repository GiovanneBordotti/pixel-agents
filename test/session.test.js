'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Session } = require('../lib/session');
const { Watcher } = require('../lib/watcher');

const T0 = Date.parse('2026-11-14T10:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();

test('deduplica tokens por message.id e soma por tipo', () => {
  const s = new Session('abc', 'x');
  const usage = { input_tokens: 10, output_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 1000 };
  // Claude Code grava várias linhas para a mesma mensagem (texto + tool_use)
  s.ingest({ type: 'assistant', timestamp: at(1), message: { id: 'm1', usage, content: [{ type: 'text', text: 'oi' }] } });
  s.ingest({ type: 'assistant', timestamp: at(1), message: { id: 'm1', usage, content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a/b.js' } }] } });
  s.ingest({ type: 'assistant', timestamp: at(2), message: { id: 'm2', usage: { input_tokens: 1, output_tokens: 2 }, content: [] } });
  const j = s.toJSON(T0 + 3000);
  assert.deepStrictEqual(j.usage, { input: 11, output: 102, cacheWrite: 50, cacheRead: 1000 });
  assert.strictEqual(j.total, 1163);
});

test('descreve a atividade atual a partir da tool pendente', () => {
  const s = new Session('abc', 'x');
  s.ingest({ type: 'user', cwd: '/home/dev/portal-noc', timestamp: at(0), message: { content: 'Corrige o login' } });
  assert.strictEqual(s.status(T0 + 500).state, 'thinking');
  s.ingest({ type: 'assistant', timestamp: at(1), message: { id: 'm1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', description: 'Rodar testes' } }] } });
  const st = s.status(T0 + 2000);
  assert.strictEqual(st.state, 'typing');
  assert.match(st.text, /Rodando: Rodar testes/);
  s.ingest({ type: 'user', timestamp: at(3), message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } });
  assert.strictEqual(s.status(T0 + 3500).state, 'thinking');
  s.ingest({ type: 'assistant', timestamp: at(4), message: { id: 'm2', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Pronto' }] } });
  assert.strictEqual(s.status(T0 + 5000).state, 'idle');
  assert.strictEqual(s.toJSON(T0 + 5000).name, 'portal-noc');
  assert.strictEqual(s.lastPrompt, 'Corrige o login');
});

test('tool rápida parada há muito tempo vira "aguardando permissão"', () => {
  const s = new Session('abc', 'x');
  s.ingest({ type: 'assistant', timestamp: at(0), message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'a.py' } }] } });
  assert.strictEqual(s.status(T0 + 15_000).state, 'waiting');
});

test('watcher lê sessões e subagentes incrementalmente', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-test-'));
  const proj = path.join(root, '-home-dev-app');
  fs.mkdirSync(path.join(proj, 'sess1', 'subagents'), { recursive: true });
  const now = new Date().toISOString();
  const main = path.join(proj, 'sess1.jsonl');
  fs.writeFileSync(main, JSON.stringify({ type: 'user', cwd: '/home/dev/app', timestamp: now, message: { content: 'oi' } }) + '\n');
  fs.writeFileSync(path.join(proj, 'sess1', 'subagents', 'agent-1.jsonl'),
    JSON.stringify({ type: 'assistant', timestamp: now, message: { id: 's1', usage: { output_tokens: 7 }, content: [] } }) + '\n');
  const w = new Watcher({ projectsDir: root });
  w.scan();
  fs.appendFileSync(main, JSON.stringify({ type: 'assistant', timestamp: now, message: { id: 'm1', usage: { output_tokens: 5 }, content: [] } }));
  w.scan(); // linha sem \n ainda não é processada
  fs.appendFileSync(main, '\n');
  w.scan();
  const [a] = w.snapshot();
  assert.strictEqual(a.name, 'app');
  assert.strictEqual(a.usage.output, 5);
  assert.strictEqual(a.subUsage.output, 7);
  assert.strictEqual(a.subagents, 1);
  assert.strictEqual(a.total, 12);
});

test('sessão parada há mais de 30 min fica "de folga", mesmo com tool pendente', () => {
  const s = new Session('abc', 'x');
  s.ingest({ type: 'assistant', timestamp: at(0), message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } });
  assert.strictEqual(s.status(T0 + 31 * 60_000).state, 'away');
});
