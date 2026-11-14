'use strict';
// Envia prompts para uma sessão existente do Claude Code (claude -p --resume <id>)
// e gera um resumo curto da resposta com o Haiku.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
const SUMMARY_DIR = path.join(os.tmpdir(), 'pixel-agents-resumos');
const JOB_TIMEOUT_MS = 30 * 60_000;
const SUMMARY_TIMEOUT_MS = 90_000;

function claudeCommand(args) {
  const bin = process.env.CLAUDE_BIN || 'claude';
  if (bin.endsWith('.js')) return { cmd: process.execPath, args: [bin, ...args], shell: false };
  // no Windows o "claude" instalado via npm é um .cmd, que precisa de shell
  return { cmd: bin, args, shell: process.platform === 'win32' };
}

function run(args, { cwd, input, timeoutMs, onLine }) {
  return new Promise((resolve) => {
    const c = claudeCommand(args);
    let child;
    try {
      child = spawn(c.cmd, c.args, { cwd, shell: c.shell, env: process.env, windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: e.message });
      return;
    }
    let stdout = '', stderr = '', buf = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (onLine) {
        buf += s;
        const lines = buf.split('\n');
        buf = lines.pop();
        lines.forEach((l) => l.trim() && onLine(l));
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (onLine && buf.trim()) onLine(buf);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

class Jobs {
  constructor({ onChange, summarize = true }) {
    this.onChange = onChange || (() => {});
    this.summarize = summarize;
    this.byAgent = new Map(); // id da sessão -> último job
    fs.mkdirSync(SUMMARY_DIR, { recursive: true });
  }

  get(id) {
    const j = this.byAgent.get(id);
    if (!j) return null;
    const { result, ...pub } = j; // a resposta completa vai por /reply
    return pub;
  }

  isRunning(id) {
    const j = this.byAgent.get(id);
    return !!j && (j.state === 'running' || j.state === 'summarizing');
  }

  async send(session, text, mode) {
    if (this.isRunning(session.id)) return;
    if (!MODES.includes(mode)) mode = 'acceptEdits';
    const job = { state: 'running', prompt: text.slice(0, 300), mode, startedAt: Date.now(), summary: '', error: '', result: '', cost: null };
    this.byAgent.set(session.id, job);
    const demo = !!process.env.PIXEL_DEMO_DIR; // no demo as pastas dos projetos são de mentira
    const cwd = demo ? os.tmpdir() : session.cwd;
    if (!demo && (!cwd || !fs.existsSync(cwd))) {
      job.state = 'error';
      job.error = `A pasta do projeto não existe mais neste computador: ${session.cwd || '(desconhecida)'}`;
      this.onChange();
      return;
    }
    this.onChange();

    const args = ['-p', '--resume', session.id, '--output-format', 'stream-json', '--verbose', '--permission-mode', mode];
    let resultEvt = null;
    const r = await run(args, {
      cwd,
      input: text,
      timeoutMs: JOB_TIMEOUT_MS,
      onLine: (line) => {
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'result') resultEvt = evt;
        } catch { /* linha que não é JSON */ }
      },
    });

    if (!resultEvt) {
      job.state = 'error';
      job.error = friendlyError(r);
      this.onChange();
      return;
    }
    job.result = resultEvt.result || '';
    job.cost = typeof resultEvt.total_cost_usd === 'number' ? resultEvt.total_cost_usd : null;
    job.finishedAt = Date.now();
    if (resultEvt.is_error) {
      job.state = 'error';
      job.error = job.result || 'O Claude Code terminou com erro.';
      this.onChange();
      return;
    }
    job.state = this.summarize ? 'summarizing' : 'done';
    job.summary = quickSummary(job.result);
    this.onChange();
    if (this.summarize) {
      const s = await this.summary(job.result);
      if (s) job.summary = s;
      job.state = 'done';
      this.onChange();
    }
  }

  async summary(text) {
    if (!text.trim()) return '';
    const prompt = 'Resuma a resposta abaixo em português do Brasil, em no máximo 2 frases curtas: diga o que foi feito '
      + 'e se o usuário precisa fazer ou decidir algo. Responda apenas com o resumo, sem introdução.\n\n<resposta>\n'
      + text.slice(0, 20000) + '\n</resposta>';
    const r = await run(['-p', '--model', 'haiku', '--output-format', 'json'], {
      cwd: SUMMARY_DIR, input: prompt, timeoutMs: SUMMARY_TIMEOUT_MS,
    });
    try { return String(JSON.parse(r.stdout).result || '').trim(); } catch { return ''; }
  }
}

// resumo instantâneo enquanto o Haiku não responde (ou se ele falhar)
function quickSummary(text) {
  const t = String(text).replace(/```[\s\S]*?```/g, ' ').replace(/[#*`_>|]/g, '').replace(/\s+/g, ' ').trim();
  const sentences = t.match(/[^.!?]+[.!?]+/g) || [t];
  return sentences.slice(0, 2).map((x) => x.trim()).join(' ').slice(0, 280);
}

function friendlyError(r) {
  const err = (r.stderr || r.stdout || '').trim();
  if (/ENOENT|not found|não é reconhecido|not recognized/i.test(err)) {
    return 'Não encontrei o comando "claude". Instale o Claude Code ou defina CLAUDE_BIN com o caminho dele.';
  }
  return err.split('\n').slice(-4).join('\n').slice(0, 500) || `O claude saiu com código ${r.code}.`;
}

module.exports = { Jobs, SUMMARY_DIR, MODES, quickSummary };
