'use strict';
/* Extras: notificações, som, modo aquário, janela "sempre por cima" e instalação como app.
   Carregado depois do app.js (usa WORK, wrap, layout, render, raf, pipWin, W, H, esc, fmt). */

// ---------- preferências ----------
const prefs = (() => {
  try { return JSON.parse(localStorage.getItem('pa-prefs')) || {}; } catch { return {}; }
})();
if (prefs.sound === undefined) prefs.sound = true;
const savePrefs = () => { try { localStorage.setItem('pa-prefs', JSON.stringify(prefs)); } catch { /* sem storage */ } };

// ---------- som (gerado na hora, sem arquivos) ----------
let audio = null;
function tone(freqs, gap, type) {
  if (!prefs.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t0 = audio.currentTime + 0.02;
    freqs.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      const t = t0 + i * gap;
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.22);
    });
  } catch { /* sem áudio */ }
}
const SOUNDS = {
  done: () => tone([659, 880, 1319], 0.09, 'square'),     // "plim" de missão cumprida
  waiting: () => tone([880, 660, 880, 660], 0.14, 'triangle'), // chamando você
};
// navegadores só liberam áudio depois de um clique
window.addEventListener('pointerdown', () => { if (prefs.sound && !audio) tone([1], 0, 'sine'); }, { once: true });

// ---------- avisos ----------
const prevState = new Map();
const lastAlert = new Map();
let firstSnapshot = true;

function notifyChanges(list) {
  for (const a of list) {
    const prev = prevState.get(a.id);
    const cur = a.status.state;
    prevState.set(a.id, cur);
    if (firstSnapshot || prev === undefined || prev === cur) continue;
    if (cur === 'waiting') alertUser('waiting', `❗ ${a.name} precisa de você`, a.status.text, a.id);
    else if (cur === 'idle' && WORK.has(prev)) alertUser('done', `✅ ${a.name} terminou`, a.lastReply || 'Esperando sua próxima mensagem', a.id);
  }
  firstSnapshot = false;
  const waiting = list.filter((a) => a.status.state === 'waiting').length;
  const title = waiting ? `(${waiting}) ❗ Pixel Agents` : 'Pixel Agents';
  document.title = title;
  if (pipWin) pipWin.document.title = title;
}

function alertUser(kind, title, body, id) {
  const key = `${id}:${kind}`;
  const now = Date.now();
  if (now - (lastAlert.get(key) || 0) < 15000) return; // evita repetir o mesmo aviso
  lastAlert.set(key, now);
  SOUNDS[kind]();
  toast(kind, title, body);
  const away = document.hidden || !document.hasFocus();
  if (prefs.notify && 'Notification' in window && Notification.permission === 'granted' && away && !pipWin) {
    try {
      const n = new Notification(title, { body: String(body).slice(0, 160), tag: key, icon: 'icons/icon-192.png' });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* alguns navegadores só permitem via service worker */ }
  }
}

function toast(kind, title, body) {
  let box = wrap.querySelector('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    wrap.append(box); // fica dentro da cidade, então vai junto para a janela fixada
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<b>${esc(title)}</b><span>${esc(String(body).slice(0, 120))}</span>`;
  box.prepend(el);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => el.classList.add('out'), 6000);
  setTimeout(() => el.remove(), 6600);
}

// ---------- placar compacto (aquário / janela fixada) ----------
function renderTicker(list) {
  let t = wrap.querySelector('#ticker');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ticker';
    wrap.append(t);
  }
  const total = list.reduce((s, a) => s + a.total, 0);
  const working = list.filter((a) => WORK.has(a.status.state)).length;
  const waiting = list.filter((a) => a.status.state === 'waiting').length;
  t.innerHTML = `Σ ${fmt(total)} tokens · ${working} trabalhando${waiting ? ` · <b>${waiting} ❗</b>` : ''}`;
}

// ---------- botões ----------
const btn = (id) => document.getElementById(id);

function refreshButtons() {
  const notifOn = prefs.notify && 'Notification' in window && Notification.permission === 'granted';
  btn('b-notify').textContent = notifOn ? '🔔' : '🔕';
  btn('b-notify').title = notifOn ? 'Notificações ligadas' : 'Ligar notificações do sistema';
  btn('b-sound').textContent = prefs.sound ? '🔊' : '🔇';
  btn('b-sound').title = prefs.sound ? 'Som ligado' : 'Som desligado';
  btn('b-aqua').classList.toggle('on', document.body.classList.contains('aquarium'));
  btn('b-pip').hidden = !('documentPictureInPicture' in window);
  btn('b-pip').classList.toggle('on', !!pipWin);
}

btn('b-notify').addEventListener('click', async () => {
  if (!('Notification' in window)) { toast('info', 'Sem suporte', 'Este navegador não tem notificações.'); return; }
  if (prefs.notify && Notification.permission === 'granted') prefs.notify = false;
  else {
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    prefs.notify = p === 'granted';
    if (!prefs.notify) toast('info', 'Notificações bloqueadas', 'Libere nas configurações do site, no cadeado da barra de endereço.');
    else toast('done', 'Notificações ligadas', 'Aviso quando um agente terminar ou precisar de você.');
  }
  savePrefs(); refreshButtons();
});

btn('b-sound').addEventListener('click', () => {
  prefs.sound = !prefs.sound;
  savePrefs(); refreshButtons();
  if (prefs.sound) SOUNDS.done();
});

function setAquarium(on) {
  document.body.classList.toggle('aquarium', on);
  prefs.aquarium = on;
  savePrefs(); refreshButtons(); layout();
}
btn('b-aqua').addEventListener('click', () => setAquarium(!document.body.classList.contains('aquarium')));
if (params.has('aquario') || prefs.aquarium) document.body.classList.add('aquarium');

// Janela que fica sempre por cima das outras (Chrome/Edge 116+)
btn('b-pip').addEventListener('click', async () => {
  if (pipWin) { pipWin.close(); return; }
  const width = 520;
  const w = await window.documentPictureInPicture.requestWindow({ width, height: Math.round((width * H) / W) });
  for (const ss of document.styleSheets) {
    try {
      const style = w.document.createElement('style');
      style.textContent = [...ss.cssRules].map((r) => r.cssText).join('\n');
      w.document.head.append(style);
    } catch {
      const link = w.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = ss.href;
      w.document.head.append(link);
    }
  }
  w.document.body.classList.add('pip');
  w.document.title = document.title;
  const home = wrap.parentElement;
  const next = wrap.nextSibling;
  w.document.body.append(wrap);
  pipWin = w;
  w.addEventListener('resize', layout);
  w.addEventListener('pagehide', () => {
    home.insertBefore(wrap, next);
    pipWin = null;
    layout();
    refreshButtons();
    window.requestAnimationFrame(render); // o loop estava na janela fixada
  });
  layout();
  refreshButtons();
});

// Instalar como app
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  btn('b-install').hidden = false;
});
btn('b-install').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null;
  btn('b-install').hidden = true;
});
window.addEventListener('appinstalled', () => toast('done', 'App instalado!', 'Procure por "Pixel Agents" no menu Iniciar.'));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

refreshButtons();
layout();
