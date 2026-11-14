'use strict';
// Modo demo: escreve sessões falsas no formato do Claude Code numa pasta temporária,
// para ver a app funcionando sem ter terminais abertos.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECTS = [
  { name: 'portal-noc', branch: 'main' },
  { name: 'zabbix-sync', branch: 'feat/hosts' },
  { name: 'grafana-dashboards', branch: 'main' },
  { name: 'cmdbuild-api', branch: 'fix/auth' },
];

const ACTIONS = [
  () => ({ name: 'Read', input: { file_path: pick(['src/index.ts', 'README.md', 'docker-compose.yml', 'lib/zabbix.py']) } }),
  () => ({ name: 'Edit', input: { file_path: pick(['src/api.ts', 'hosts.py', 'dashboard.json', 'auth.go']) } }),
  () => ({ name: 'Bash', input: { command: 'npm test', description: pick(['Rodar testes', 'Build do projeto', 'git status', 'Instalar dependências']) } }),
  () => ({ name: 'Grep', input: { pattern: pick(['TODO', 'hostid', 'datasource', 'token']) } }),
  () => ({ name: 'WebSearch', input: { query: pick(['zabbix api host.get', 'grafana provisioning', 'cmdbuild rest v3']) } }),
  () => ({ name: 'Task', input: { description: pick(['Revisar código', 'Explorar repositório']) } }),
  () => ({ name: 'TodoWrite', input: {} }),
];

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function rid() { return Math.random().toString(36).slice(2, 10); }

function startDemo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-demo-'));
  const projectsDir = path.join(root, 'projects');
  const agents = PROJECTS.map((p, i) => {
    const dir = path.join(projectsDir, `-home-dev-${p.name}`);
    fs.mkdirSync(dir, { recursive: true });
    const id = `${rid()}-demo-${i}`;
    return { ...p, id, file: path.join(dir, `${id}.jsonl`), cwd: `/home/dev/${p.name}`, pendingId: null, phase: 0 };
  });

  const write = (a, entry) => {
    const line = { sessionId: a.id, cwd: a.cwd, gitBranch: a.branch, timestamp: new Date().toISOString(), ...entry };
    fs.appendFileSync(a.file, JSON.stringify(line) + '\n');
  };
  const usage = () => ({
    input_tokens: 5 + Math.floor(Math.random() * 50),
    output_tokens: 80 + Math.floor(Math.random() * 900),
    cache_creation_input_tokens: Math.floor(Math.random() * 3000),
    cache_read_input_tokens: 8000 + Math.floor(Math.random() * 40000),
  });

  const step = (a) => {
    if (a.pendingId) {
      write(a, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: a.pendingId, content: 'ok' }] } });
      a.pendingId = null;
      return;
    }
    const r = Math.random();
    if (r < 0.12) {
      write(a, { type: 'assistant', message: { id: `msg_${rid()}`, role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: usage(), content: [{ type: 'text', text: 'Pronto! Implementei a mudança e os testes passaram.' }] } });
    } else if (r < 0.2) {
      write(a, { type: 'user', message: { role: 'user', content: [{ type: 'text', text: pick(['Corrige o bug do login', 'Cria o endpoint de hosts', 'Adiciona um painel de CPU', 'Escreve testes pro parser']) }] } });
    } else {
      const t = pick(ACTIONS)();
      a.pendingId = `toolu_${rid()}`;
      write(a, { type: 'assistant', message: { id: `msg_${rid()}`, role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: usage(), content: [{ type: 'tool_use', id: a.pendingId, name: t.name, input: t.input }] } });
    }
  };

  agents.forEach((a) => {
    write(a, { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Bora trabalhar!' }] } });
    const loop = () => { step(a); setTimeout(loop, 1500 + Math.random() * 4000); };
    setTimeout(loop, Math.random() * 2000);
  });

  return projectsDir;
}

module.exports = { startDemo };
