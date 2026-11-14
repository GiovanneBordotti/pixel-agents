'use strict';
// Varre ~/.claude/projects e lê os .jsonl de forma incremental (como um tail -f).

const fs = require('fs');
const path = require('path');
const { Session } = require('./session');

class Watcher {
  constructor({ projectsDir, activeHours = 24, intervalMs = 1000 }) {
    this.projectsDir = projectsDir;
    this.activeMs = activeHours * 3600_000;
    this.intervalMs = intervalMs;
    this.files = new Map();    // caminho -> {offset, rest, sessionId, sub, subId}
    this.sessions = new Map(); // sessionId -> Session
    this.timer = null;
  }

  start(onChange) {
    const tick = () => {
      let changed = false;
      try { changed = this.scan(); } catch (e) { console.error('[watcher]', e.message); }
      if (changed && onChange) onChange();
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
  }

  stop() { clearInterval(this.timer); }

  listJsonl(dir, depth = 0, out = []) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) this.listJsonl(p, depth + 1, out);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
    return out;
  }

  identify(file) {
    // <proj>/<sessionId>.jsonl  ou  <proj>/<sessionId>/subagents/agent-x.jsonl
    const parts = path.relative(this.projectsDir, file).split(path.sep);
    const i = parts.indexOf('subagents');
    if (i > 0) {
      return { sessionId: parts[i - 1], sub: true, subId: path.basename(file, '.jsonl') };
    }
    return { sessionId: path.basename(file, '.jsonl'), sub: false, subId: null };
  }

  scan() {
    const now = Date.now();
    let changed = false;
    for (const file of this.listJsonl(this.projectsDir)) {
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (now - st.mtimeMs > this.activeMs && !this.files.has(file)) continue;
      let f = this.files.get(file);
      if (!f) {
        f = { offset: 0, rest: '', ...this.identify(file) };
        this.files.set(file, f);
      }
      if (st.size < f.offset) { f.offset = 0; f.rest = ''; } // arquivo truncado
      if (st.size === f.offset) continue;
      changed = this.readChunk(file, f, st.size) || changed;
    }
    // remove sessões antigas
    for (const [id, s] of this.sessions) {
      if (now - s.lastEventAt > this.activeMs) { this.sessions.delete(id); changed = true; }
    }
    return changed;
  }

  readChunk(file, f, size) {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - f.offset);
    fs.readSync(fd, buf, 0, buf.length, f.offset);
    fs.closeSync(fd);
    f.offset = size;
    const lines = (f.rest + buf.toString('utf8')).split('\n');
    f.rest = lines.pop();
    let s = this.sessions.get(f.sessionId);
    if (!s) {
      s = new Session(f.sessionId, file);
      this.sessions.set(f.sessionId, s);
    }
    for (const line of lines) {
      if (!line.trim()) continue;
      try { s.ingest(JSON.parse(line), { sub: f.sub, subId: f.subId }); } catch { /* linha inválida */ }
    }
    return lines.length > 0;
  }

  snapshot() {
    const now = Date.now();
    return [...this.sessions.values()]
      .filter((s) => s.lastEventAt && (s.cwd || s.usageById.size))
      .map((s) => s.toJSON(now))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}

module.exports = { Watcher };
