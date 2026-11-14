'use strict';
// Estado de uma sessão do Claude Code, montado a partir das linhas do .jsonl.

const path = require('path');

const LONG_RUNNING = new Set(['Bash', 'Task', 'Agent', 'WebFetch', 'WebSearch', 'BashOutput']);
const PERMISSION_GUESS_MS = 10_000;
const AWAY_MS = 30 * 60_000;
const MAX_TURN_CHARS = 200_000;

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
    case 'TodoWrite':
    case 'TaskUpdate': return { kind: 'typing', text: 'Atualizando lista de tarefas' };
    case 'TaskCreate': return { kind: 'typing', text: `Planejando: ${short(input.subject, 40)}` };
    case 'TaskList':
    case 'TaskGet': return { kind: 'reading', text: 'Conferindo a lista de tarefas' };
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
    this.lastText = '';      // última frase do assistente (narração)
    this.lastTextAt = 0;
    this.lastReply = '';     // última resposta completa (até 600 chars)
    this.turn = { prompt: '', parts: [], at: 0 }; // texto bruto do último turno (para o modal)
    this.goal = '';          // tarefa em andamento (TodoWrite / TaskUpdate)
    this.tasks = new Map();  // id da task -> {subject, activeForm}
    this.taskCreates = new Map(); // tool_use_id do TaskCreate -> input
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
          this.trackTasks(c);
        } else if (c.type === 'text' && c.text && c.text.trim()) {
          this.lastText = short(firstSentence(c.text), 110);
          this.lastTextAt = ts || Date.now();
          this.lastReply = short(c.text, 600);
          this.turn.parts.push(c.text);
          this.turn.at = ts || Date.now();
          while (this.turn.parts.join('').length > MAX_TURN_CHARS && this.turn.parts.length > 1) this.turn.parts.shift();
        }
      }
    } else if (entry.type === 'user') {
      let isPrompt = false;
      for (const c of content) {
        if (c && c.type === 'tool_result') {
          this.pending.delete(c.tool_use_id);
          const created = this.taskCreates.get(c.tool_use_id);
          if (created) {
            const m = /#(\d+)/.exec(resultText(c.content));
            if (m) this.tasks.set(m[1], created);
            this.taskCreates.delete(c.tool_use_id);
          }
        }
        else if (c && c.type === 'text' && c.text && !c.text.startsWith('<')) {
          isPrompt = true;
          this.lastPrompt = short(c.text, 120);
          this.turn = { prompt: c.text.slice(0, 4000), parts: [], at: ts || Date.now() };
        }
      }
      if (isPrompt) {
        this.pending.clear();
        this.lastText = '';
        this.lastTextAt = 0;
      }
      this.lastRole = 'user';
      this.lastStop = null;
    }
  }

  // Acompanha a lista de tarefas do Claude para saber "no que ele está trabalhando"
  trackTasks(c) {
    const input = c.input || {};
    if (c.name === 'TodoWrite' && Array.isArray(input.todos)) {
      const cur = input.todos.find((t) => t.status === 'in_progress');
      this.goal = cur ? short(cur.activeForm || cur.content, 70) : '';
    } else if (c.name === 'TaskCreate') {
      this.taskCreates.set(c.id, { subject: input.subject, activeForm: input.activeForm });
    } else if (c.name === 'TaskUpdate') {
      const t = this.tasks.get(String(input.taskId));
      const label = t ? short(t.activeForm || t.subject, 70) : (input.activeForm || input.subject || '');
      if (input.status === 'in_progress' && label) this.goal = short(label, 70);
      else if ((input.status === 'completed' || input.status === 'deleted') && label && this.goal === short(label, 70)) this.goal = '';
    }
  }

  reply() {
    return { prompt: this.turn.prompt, text: this.turn.parts.join('\n\n'), at: this.turn.at };
  }

  usage() {
    const own = emptyUsage();
    for (const u of this.usageById.values()) add(own, u);
    const sub = emptyUsage();
    for (const u of this.subUsageById.values()) add(sub, u);
    return { own, sub };
  }

  status(now = Date.now()) {
    const st = this.baseStatus(now);
    if (st.state !== 'away' && st.state !== 'idle') {
      if (this.goal) st.goal = this.goal;
      if (this.lastText && now - this.lastTextAt < 3 * 60_000) st.narration = this.lastText;
    }
    return st;
  }

  baseStatus(now) {
    const idleFor = now - this.lastEventAt;
    // sessão parada há muito tempo: mesmo com tool pendente (terminal fechado no meio), está de folga
    if (idleFor > AWAY_MS) return { state: 'away', text: 'De folga (Claude fechado)' };
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
      lastReply: this.lastReply,
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

function firstSentence(text) {
  const t = String(text).replace(/[#*`_>]/g, '').replace(/\s+/g, ' ').trim();
  const m = /^(.{12,}?[.!?])(\s|$)/.exec(t);
  return m ? m[1] : t;
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && c.text) || '').join(' ');
  return '';
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
