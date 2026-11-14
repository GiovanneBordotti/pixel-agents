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
];

const GOALS = {
  'Corrige o bug do login': ['Reproduzindo o bug do login', 'Corrigindo a validação do token', 'Rodando os testes de auth'],
  'Cria o endpoint de hosts': ['Lendo a API do Zabbix', 'Criando a rota /hosts', 'Escrevendo testes do endpoint'],
  'Adiciona um painel de CPU': ['Montando a query do Prometheus', 'Criando o painel de CPU', 'Ajustando os thresholds'],
  'Escreve testes pro parser': ['Mapeando os casos de borda', 'Escrevendo testes do parser', 'Corrigindo testes quebrados'],
  'Bora trabalhar!': ['Explorando o repositório', 'Entendendo a estrutura do projeto'],
};
const NARRATION = [
  'Vou dar uma olhada em como isso está estruturado.',
  'Achei o problema: o token expira antes da hora.',
  'Agora vou rodar os testes para confirmar.',
  'Preciso ver onde essa função é chamada.',
  'Vou ajustar o arquivo e conferir o resultado.',
  'Isso deve resolver, deixa eu validar.',
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

  const todo = (a) => {
    const id = `toolu_${rid()}`;
    const todos = a.goals.map((g, i) => ({ content: g, activeForm: g, status: i < a.goalIdx ? 'completed' : i === a.goalIdx ? 'in_progress' : 'pending' }));
    write(a, { type: 'assistant', message: { id: `msg_${rid()}`, role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: usage(), content: [{ type: 'tool_use', id, name: 'TodoWrite', input: { todos } }] } });
    write(a, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  };
  const prompt = (a, text) => {
    write(a, { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
    a.goals = GOALS[text] || GOALS['Bora trabalhar!'];
    a.goalIdx = 0;
    todo(a);
  };

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
      prompt(a, pick(['Corrige o bug do login', 'Cria o endpoint de hosts', 'Adiciona um painel de CPU', 'Escreve testes pro parser']));
    } else {
      if (Math.random() < 0.2 && a.goalIdx < a.goals.length - 1) { a.goalIdx++; todo(a); }
      const t = pick(ACTIONS)();
      a.pendingId = `toolu_${rid()}`;
      const content = [{ type: 'tool_use', id: a.pendingId, name: t.name, input: t.input }];
      if (Math.random() < 0.5) content.unshift({ type: 'text', text: pick(NARRATION) });
      write(a, { type: 'assistant', message: { id: `msg_${rid()}`, role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: usage(), content } });
    }
  };

  agents.forEach((a) => {
    prompt(a, 'Bora trabalhar!');
    const loop = () => { step(a); setTimeout(loop, 1500 + Math.random() * 4000); };
    setTimeout(loop, Math.random() * 2000);
  });

  // dois agentes "de folga": sessões antigas, ninguém com o Claude aberto
  [['tivit-automations', 'main', 2], ['observability-bot', 'dev', 5]].forEach(([name, branch, hoursAgo], i) => {
    const dir = path.join(projectsDir, `-home-dev-${name}`);
    fs.mkdirSync(dir, { recursive: true });
    const id = `${rid()}-old-${i}`;
    const ts = (s) => new Date(Date.now() - hoursAgo * 3600_000 + s * 1000).toISOString();
    const base = { sessionId: id, cwd: `/home/dev/${name}`, gitBranch: branch };
    const lines = [
      { ...base, type: 'user', timestamp: ts(0), message: { role: 'user', content: 'Revisa os alertas do Zabbix' } },
      { ...base, type: 'assistant', timestamp: ts(30), message: { id: `msg_${rid()}`, role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage: usage(), content: [{ type: 'text', text: 'Feito!' }] } },
    ];
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  });

  return projectsDir;
}

module.exports = { startDemo };
