'use strict';
/* Conversar com os agentes pela app: envia o prompt para a sessão do Claude Code,
   mostra o resumo quando ele termina e a resposta completa (markdown) num modal. */

// ---------- markdown simples e seguro (escapa tudo antes de formatar) ----------
function inlineMd(text) {
  return text.split(/(`[^`]+`)/g).map((part) => {
    if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
    let s = esc(part);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|\s)_([^_]+)_(?=\s|$|[.,!?])/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s;
  }).join('');
}

function md(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  const out = [];
  const isList = (l) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inlineMd(c.trim()));
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      const lang = l.trim().slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`);
    } else if (/^#{1,6}\s/.test(l)) {
      const n = l.match(/^#+/)[0].length;
      out.push(`<h${n}>${inlineMd(l.slice(n).trim())}</h${n}>`);
      i++;
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) {
      out.push('<hr>');
      i++;
    } else if (/^\s*\|/.test(l) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (/^\s*>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${md(buf.join('\n'))}</blockquote>`);
    } else if (isList(l)) {
      const ordered = /^\s*\d/.test(l);
      const items = [];
      while (i < lines.length && (isList(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (isList(lines[i])) items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      const li = items.map((t) => {
        const m = /^\[([ xX])\]\s+(.*)$/.exec(t);
        return m ? `<li class="task">${m[1] === ' ' ? '☐' : '☑'} ${inlineMd(m[2])}</li>` : `<li>${inlineMd(t)}</li>`;
      }).join('');
      out.push(ordered ? `<ol>${li}</ol>` : `<ul>${li}</ul>`);
    } else if (!l.trim()) {
      i++;
    } else {
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|>|\|)/.test(lines[i]) && !isList(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${buf.map(inlineMd).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}

// ---------- modais ----------
function openModal(html, cls = '') {
  closeModal();
  const root = document.createElement('div');
  root.id = 'modal';
  root.innerHTML = `<div class="modal-box ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  root.addEventListener('mousedown', (e) => { if (e.target === root) closeModal(); });
  document.body.append(root);
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  if (pipWin) window.focus();
  return root;
}
function closeModal() { const m = document.getElementById('modal'); if (m) m.remove(); }
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

const MODE_LABELS = {
  acceptEdits: 'Pode editar arquivos (comandos no terminal são negados)',
  default: 'Só ler e responder (edições e comandos são negados)',
  plan: 'Só planejar, sem mexer em nada',
  bypassPermissions: 'Liberado geral: edita e roda comandos (cuidado)',
};

function openComposer(id) {
  const a = agents.find((x) => x.id === id);
  if (!a) return;
  if (!promptsEnabled) { toast('info', 'Envio desligado', 'Este servidor está com o envio de prompts desligado.'); return; }
  const busy = a.job && (a.job.state === 'running' || a.job.state === 'summarizing');
  const working = WORK.has(a.status.state) && !busy;
  const mode = prefs.mode || 'acceptEdits';
  const root = openModal(`
    <header><h2>💬 ${esc(a.name)}</h2><button class="x" data-close title="Fechar">✕</button></header>
    <div class="meta">${esc(a.cwd)}${a.branch ? ` · ${esc(a.branch)}` : ''}</div>
    ${working ? '<div class="warn">⚠️ Ele está trabalhando agora pelo terminal. Mandar outro prompt ao mesmo tempo pode embaralhar a sessão.</div>' : ''}
    ${busy ? '<div class="warn">⏳ Ainda está respondendo o prompt anterior.</div>' : ''}
    ${a.lastPrompt ? `<div class="last">Último pedido: “${esc(a.lastPrompt)}”</div>` : ''}
    <textarea id="c-text" rows="5" placeholder="O que você quer que ele faça? (Ctrl+Enter envia)"></textarea>
    <label class="mode">Permissões:
      <select id="c-mode">${Object.entries(MODE_LABELS).map(([k, v]) => `<option value="${k}" ${k === mode ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </label>
    <footer>
      ${a.lastReply ? '<button id="c-reply" class="ghost">📄 Última resposta</button>' : ''}
      <span class="err" id="c-err"></span>
      <button id="c-send" ${busy ? 'disabled' : ''}>Enviar ➤</button>
    </footer>`, 'composer');
  const ta = root.querySelector('#c-text');
  ta.focus();
  const send = async () => {
    const text = ta.value.trim();
    if (!text) return;
    const btnSend = root.querySelector('#c-send');
    btnSend.disabled = true;
    prefs.mode = root.querySelector('#c-mode').value;
    savePrefs();
    try {
      const r = await fetch(`api/agents/${encodeURIComponent(id)}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pixel-Agents': '1' },
        body: JSON.stringify({ text, mode: prefs.mode }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Erro ${r.status}`);
      closeModal();
      toast('info', `📨 Enviado para ${a.name}`, text);
    } catch (e) {
      root.querySelector('#c-err').textContent = e.message;
      btnSend.disabled = false;
    }
  };
  root.querySelector('#c-send').addEventListener('click', send);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });
  const rb = root.querySelector('#c-reply');
  if (rb) rb.addEventListener('click', () => openReply(id));
}

async function openReply(id) {
  const a = agents.find((x) => x.id === id);
  const root = openModal(`<header><h2>📄 ${esc(a ? a.name : '')}</h2><button class="x" data-close title="Fechar">✕</button></header><div class="md">Carregando…</div>`, 'reply');
  try {
    const r = await fetch(`api/agents/${encodeURIComponent(id)}/reply`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Erro ${r.status}`);
    const summary = a && a.job && a.job.summary && a.job.state === 'done' ? a.job.summary : '';
    root.querySelector('.modal-box').innerHTML = `
      <header><h2>📄 ${esc(data.name)}</h2><button class="x" data-close title="Fechar">✕</button></header>
      ${data.prompt ? `<div class="asked"><b>Você pediu:</b> ${esc(data.prompt.length > 400 ? data.prompt.slice(0, 400) + '…' : data.prompt)}</div>` : ''}
      ${summary ? `<div class="summary">📝 ${esc(summary)}</div>` : ''}
      <div class="md">${data.text ? md(data.text) : '<p class="muted">Ainda não há resposta neste turno.</p>'}</div>
      <footer>
        <span class="muted">${data.at ? new Date(data.at).toLocaleString('pt-BR') : ''}</span>
        <button class="ghost" id="r-copy">Copiar markdown</button>
        <button id="r-chat">💬 Responder</button>
      </footer>`;
    root.querySelector('[data-close]').addEventListener('click', closeModal);
    root.querySelector('#r-copy').addEventListener('click', async (e) => {
      try { await navigator.clipboard.writeText(data.text); e.target.textContent = 'Copiado ✓'; } catch { e.target.textContent = 'Não deu para copiar'; }
    });
    root.querySelector('#r-chat').addEventListener('click', () => openComposer(id));
  } catch (e) {
    root.querySelector('.md').textContent = e.message;
  }
}

// ---------- texto do job no card ----------
function jobHtml(a) {
  const j = a.job;
  if (!j) return '';
  const p = `<span class="muted">“${esc(j.prompt.length > 80 ? j.prompt.slice(0, 80) + '…' : j.prompt)}”</span>`;
  if (j.state === 'running') return `<div class="job running">⏳ Respondendo seu prompt da app ${p}</div>`;
  if (j.state === 'summarizing') return `<div class="job running">📝 Resumindo a resposta… ${p}</div>`;
  if (j.state === 'error') return `<div class="job error">⚠️ ${esc(j.error)}</div>`;
  return `<div class="job done">📝 ${esc(j.summary || 'Respondeu.')}${j.cost != null ? ` <span class="muted">(US$ ${j.cost.toFixed(3)})</span>` : ''}</div>`;
}

// ---------- cliques ----------
document.getElementById('panel').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'chat') openComposer(b.dataset.id);
  if (b.dataset.act === 'reply') openReply(b.dataset.id);
});

// clicar num personagem abre a conversa com ele
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W;
  const y = ((e.clientY - r.top) / r.height) * H;
  const hit = [...chars.values()].filter((c) => !c.npc && c.data && x >= c.x - 2 && x <= c.x + 14 && y >= c.y - 2 && y <= c.y + 18)
    .sort((a, b) => b.y - a.y)[0];
  if (hit) openComposer(hit.id);
});
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W;
  const y = ((e.clientY - r.top) / r.height) * H;
  const over = [...chars.values()].some((c) => !c.npc && c.data && x >= c.x - 2 && x <= c.x + 14 && y >= c.y - 2 && y <= c.y + 18);
  canvas.style.cursor = over ? 'pointer' : 'default';
});

// avisos clicáveis abrem a resposta
wrap.addEventListener('click', (e) => {
  const t = e.target.closest('.toast[data-id]');
  if (t) openReply(t.dataset.id);
});
