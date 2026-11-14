#!/usr/bin/env node
'use strict';
// "claude" de mentira usado no modo demo (e nos testes): imita `claude -p --resume <id>`
// escrevendo no histórico falso da sessão e devolvendo stream-json, sem gastar tokens.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 10);

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
    else if (e.name === name) return p;
  }
  return null;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  input = input.trim();

  if (argOf('--model') === 'haiku') {
    const m = /<resposta>\s*([\s\S]*?)\s*<\/resposta>/.exec(input);
    const first = (m ? m[1] : input).replace(/[#*`]/g, '').split('\n').find((l) => l.trim().length > 20) || 'Tarefa concluída.';
    await sleep(800);
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `Resumo: ${first.trim().slice(0, 140)}` }));
    return;
  }

  const id = argOf('--resume');
  const file = id && process.env.PIXEL_DEMO_DIR && findFile(process.env.PIXEL_DEMO_DIR, `${id}.jsonl`);
  if (!file) { process.stderr.write(`No conversation found with session ID: ${id}\n`); process.exit(1); }
  const first = JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0]);
  const base = { sessionId: id, cwd: first.cwd, gitBranch: first.gitBranch };
  const write = (entry) => fs.appendFileSync(file, JSON.stringify({ ...base, timestamp: new Date().toISOString(), ...entry }) + '\n');
  const usage = () => ({ input_tokens: 20, output_tokens: 300 + Math.floor(Math.random() * 500), cache_read_input_tokens: 20000 });
  const emit = (evt) => process.stdout.write(JSON.stringify(evt) + '\n');

  emit({ type: 'system', subtype: 'init', session_id: id });
  write({ type: 'user', message: { role: 'user', content: input } });
  await sleep(1500);
  const t1 = `toolu_${rid()}`;
  write({ type: 'assistant', message: { id: `msg_${rid()}`, role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: usage(), content: [
    { type: 'text', text: 'Vou olhar o código antes de mexer.' },
    { type: 'tool_use', id: t1, name: 'Read', input: { file_path: 'src/index.ts' } }] } });
  await sleep(2500);
  write({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: t1, content: 'ok' }] } });
  const t2 = `toolu_${rid()}`;
  write({ type: 'assistant', message: { id: `msg_${rid()}`, role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: usage(), content: [
    { type: 'tool_use', id: t2, name: 'Edit', input: { file_path: 'src/index.ts' } }] } });
  await sleep(2500);
  write({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: t2, content: 'ok' }] } });
  await sleep(1000);

  const result = [
    `Pronto! Fiz o que você pediu: **${input.slice(0, 80)}**.`,
    '',
    '## O que mudou',
    '',
    '- Ajustei a validação em `src/index.ts`',
    '- Adicionei um teste para o caso de borda',
    '- Rodei a suíte inteira: **12 testes passando**',
    '',
    '```ts',
    'export function validar(token: string) {',
    '  return token.length > 0 && !expirado(token);',
    '}',
    '```',
    '',
    '| Arquivo | Linhas |',
    '|---|---|',
    '| src/index.ts | +8 −3 |',
    '| test/index.test.ts | +21 |',
    '',
    '> Próximo passo: quer que eu abra um PR?',
  ].join('\n');
  write({ type: 'assistant', message: { id: `msg_${rid()}`, role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: usage(), content: [{ type: 'text', text: result }] } });
  emit({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.0123, session_id: id });
}

main().catch((e) => { process.stderr.write(String(e.stack || e)); process.exit(1); });
