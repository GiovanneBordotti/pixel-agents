'use strict';
// Estado de uma sessão do Claude Code, montado a partir das linhas do .jsonl.

const path = require('path');

const LONG_RUNNING = new Set(['Bash', 'Task', 'Agent', 'WebFetch', 'WebSearch', 'BashOutput']);
const PERMISSION_GUESS_MS = 10_000;
const SLEEP_MS = 30 * 60_000;

function short(str, n = 60) {
  if (!str) return '';
  const s = String(str).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function base(p) {
  return p ? path.basename(String(p)) : '';
}

function describeTool(name, input = {}) {
  switch (name) {
    case 'Read': return { kind: 'reading', text: `Lendo ${base(input.file_path)}` };
    case 'Edit':
    case 'MultiEdit': return { kind: 'typing', text: `Editando ${base(input.file_path)}` };
    case 'Write': return { kind: 'typing', text: `Escrevendo ${base(input.file_path)}` };
    case 'NotebookEdit': return { kind: 'typing', text: `Editando notebook ${base(input.notebook_path)}` };
    case 'Bash': return { kind: 'typing', text: `Rodando: ${short(input.description || input.command, 50)}` };
    case 'BashOutput': return { kind: 'reading', text: 'Lendo saída de comando' };
    case 'Grep': return { kind: 'reading', text: `Buscando "${short(input.pattern, 30)}"` };
    case 'Glob': return { kind: 'reading', text: `Procurando ${short(input.pattern, 30)}` };
    case 'LS': return { kind: 'reading', text: `Listando ${base(input.path)}` };
    case 'WebFetch': return { kind: 'reading', text: `Abrindo ${short(input.url, 40)}` };
    case 'WebSearch': return { kind: 'reading', text: `Pesquisando "${short(input.query, 30)}"` };
    case 'Task':
    case 'Agent': return { kind: 'delegating', text: `Delegando: ${short(input.description || input.prompt, 40)}` };
    case 'TodoWrite': return { kind: 'typing', text: 'Atualizando lista de tarefas' };
    case 'AskUserQuestion': return { kind: 'waiting', text: 'Te fez uma pergunta' };
    case 'ExitPlanMode': return { kind: 'waiting', text: 'Plano pronto para aprovar' };
    default:
      if (name && name.startsWith('mcp__')) {
        const parts = name.split('__');
        return { kind: 'typing', text: `MCP ${parts[1]}: ${parts.slice(2).join('_')}` };
      }
      return { kind: 'typing', text: `Usando ${name}` };
  }
}

function emptyUsage() {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

class Session {
  constructor(id, file) {
    this.id = id;
    this.file = file;
    this.cwd = '';
    this.branch = '';
    this.model = '';
    this.lastPrompt = '';
    this.lastText = '';
    this.lastEventAt = 0;
    this.lastRole = null;      // 'user' | 'assistant'
    this.lastStop = null;      // stop_reason da última msg do assistente
    this.pending = new Map();  // tool_use_id -> {name, input, at}
    this.usageById = new Map(); // message.id -> usage (deduplicado)
    this.subUsageById = new Map(); // tokens de subagentes
    this.subagents = new Set();
    this.toolCounts = {};
  }

  ingest(entry, { sub = false, subId = null } = {}) {
    if (!entry || typeof entry !== 'object') return;
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : 0;
    if (!sub && entry.cwd) this.cwd = entry.cwd;
    if (!sub && entry.gitBranch) this.branch = entry.gitBranch;
    const msg = entry.message;
    if (!msg) return;

    if (sub || entry.isSidechain) {
      if (subId) this.subagents.add(subId);
      if (entry.type === 'assistant' && msg.usage) {
        this.subUsageById.set(msg.id || `${subId}:${ts}`, msg.usage);
      }
      if (ts) this.lastEventAt = Math.max(this.lastEventAt, ts);
      return;
    }

    if (ts) this.lastEventAt = Math.max(this.lastEventAt, ts);
    const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];

    if (entry.type === 'assistant') {
      this.lastRole = 'assistant';
      this.lastStop = msg.stop_reason || null;
      if (msg.model && msg.model !== '<synthetic>') this.model = msg.model;
      if (msg.usage) this.usageById.set(msg.id || `${ts}:${this.usageById.size}`, msg.usage);
      for (const c of content) {
        if (c.type === 'tool_use') {
          this.pending.set(c.id, { name: c.name, input: c.input || {}, at: ts || Date.now() });
          this.toolCounts[c.name] = (this.toolCounts[c.name] || 0) + 1;
        } else if (c.type === 'text' && c.text) {
          this.lastText = short(c.text, 120);
        }
      }
    } else if (entry.type === 'user') {
      let isPrompt = false;
      for (const c of content) {
        if (c && c.type === 'tool_result') this.pending.delete(c.tool_use_id);
        else if (c && c.type === 'text' && c.text && !c.text.startsWith('<')) {
          isPrompt = true;
          this.lastPrompt = short(c.text, 120);
        }
      }
      if (isPrompt) {
        this.pending.clear();
        this.lastText = '';
      }
      this.lastRole = 'user';
      this.lastStop = null;
    }
  }

  usage() {
    const own = emptyUsage();
    for (const u of this.usageById.values()) add(own, u);
    const sub = emptyUsage();
    for (const u of this.subUsageById.values()) add(sub, u);
    return { own, sub };
  }

  status(now = Date.now()) {
    const idleFor = now - this.lastEventAt;
    if (this.pending.size) {
      const tools = [...this.pending.values()];
      const last = tools[tools.length - 1];
      const d = describeTool(last.name, last.input);
      if (d.kind !== 'waiting' && !LONG_RUNNING.has(last.name) && now - last.at > PERMISSION_GUESS_MS) {
        return { state: 'waiting', text: `Aguardando permissão? (${d.text})`, tool: last.name };
      }
      if (d.kind === 'waiting') return { state: 'waiting', text: d.text, tool: last.name };
      return { state: d.kind, text: d.text, tool: last.name, parallel: tools.length };
    }
    if (idleFor > SLEEP_MS) return { state: 'sleeping', text: 'Dormindo… zZz' };
    if (this.lastRole === 'user') return { state: 'thinking', text: 'Pensando…' };
    if (this.lastRole === 'assistant' && this.lastStop !== 'tool_use') {
      return { state: 'idle', text: 'Terminei! Esperando você', detail: this.lastText };
    }
    return { state: 'thinking', text: 'Pensando…' };
  }

  toJSON(now = Date.now()) {
    const { own, sub } = this.usage();
    return {
      id: this.id,
      name: base(this.cwd) || this.id.slice(0, 8),
      cwd: this.cwd,
      branch: this.branch,
      model: this.model,
      lastPrompt: this.lastPrompt,
      lastEventAt: this.lastEventAt,
      status: this.status(now),
      usage: own,
      subUsage: sub,
      subagents: this.subagents.size,
      total: sum(own) + sum(sub),
      toolCounts: this.toolCounts,
    };
  }
}

function add(acc, u) {
  acc.input += u.input_tokens || 0;
  acc.output += u.output_tokens || 0;
  acc.cacheWrite += u.cache_creation_input_tokens || 0;
  acc.cacheRead += u.cache_read_input_tokens || 0;
}

function sum(u) {
  return u.input + u.output + u.cacheWrite + u.cacheRead;
}

module.exports = { Session, describeTool, sum };
