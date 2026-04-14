#!/usr/bin/env node
'use strict';

/**
 * thumbgate explore — interactive TUI explorer for lessons, gates, stats, and rules.
 *
 * Inspired by Cloudflare's Local Explorer concept: a zero-dependency, keyboard-driven
 * interface for discovering what your ThumbGate instance has learned and enforces.
 *
 * Keys:
 *   1-4 / Tab      switch tabs
 *   ↑ / k          move up
 *   ↓ / j          move down
 *   /              start search filter
 *   Enter          view detail
 *   Esc / q        go back / quit
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------
const A = {
  clear:     '\x1b[2J\x1b[H',
  b:         '\x1b[1m',       // bold
  d:         '\x1b[2m',       // dim
  r:         '\x1b[0m',       // reset
  inv:       '\x1b[7m',       // inverse (highlight)
  ul:        '\x1b[4m',       // underline
  cy:        '\x1b[36m',      // cyan
  gn:        '\x1b[32m',      // green
  rd:        '\x1b[31m',      // red
  yl:        '\x1b[33m',      // yellow
  mg:        '\x1b[35m',      // magenta
  gy:        '\x1b[90m',      // gray
  wh:        '\x1b[97m',      // bright white
  bgCy:      '\x1b[46m\x1b[30m',  // cyan bg + black text
  hideCursor:'\x1b[?25l',
  showCursor:'\x1b[?25h',
};

function cols() { return process.stdout.columns || 80; }
function rows() { return process.stdout.rows || 24; }
function hr(ch = '─') { return ch.repeat(cols()); }
function pad(str, w) { const s = String(str || ''); return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length); }
function trunc(str, max) { const s = String(str || ''); return s.length > max ? s.slice(0, max - 1) + '…' : s; }
function relDate(ts) {
  if (!ts) return '';
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  return d === 0 ? 'today' : d === 1 ? '1d ago' : `${d}d ago`;
}
function write(s) { process.stdout.write(s); }

// ---------------------------------------------------------------------------
// Data loaders
// ---------------------------------------------------------------------------

function loadLessons(feedbackDir) {
  const p = path.join(feedbackDir, 'memory-log.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean).reverse();  // newest first
}

function loadGates(pkgRoot) {
  const gatesDir = path.join(pkgRoot, 'config', 'gates');
  const gates = [];
  if (!fs.existsSync(gatesDir)) return gates;
  for (const f of fs.readdirSync(gatesDir).sort()) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(gatesDir, f), 'utf8'));
      const items = Array.isArray(raw) ? raw : (raw.gates || raw.rules || [raw]);
      items.forEach(g => gates.push({ ...g, _file: f }));
    } catch { /* skip malformed */ }
  }
  // Custom gates
  const customPath = path.join(pkgRoot, 'config', 'gates', 'custom.json');
  if (fs.existsSync(customPath)) {
    try {
      const custom = JSON.parse(fs.readFileSync(customPath, 'utf8'));
      (Array.isArray(custom) ? custom : custom.gates || []).forEach(g =>
        gates.push({ ...g, _file: 'custom.json', _custom: true })
      );
    } catch { /* ignore */ }
  }
  return gates;
}

function loadStats(feedbackDir) {
  const p = path.join(feedbackDir, 'feedback-summary.json');
  if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} }
  return null;
}

function loadRules(feedbackDir) {
  const p = path.join(feedbackDir, 'prevention-rules.md');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n')
    .filter(l => l.trim())
    .map((text, i) => ({ id: i, text }));
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

const TABS = ['Lessons', 'Gates', 'Stats', 'Rules'];

function renderHeader(state) {
  const version = (() => { try { return require('../package.json').version; } catch { return '?'; } })();
  const title = `${A.b}${A.cy}thumbgate explore${A.r}  v${version}`;
  const hint = `${A.gy}q quit  / search  ↑↓ navigate  Enter detail${A.r}`;
  const tabLine = TABS.map((t, i) => {
    const active = i === state.tab;
    const key = `${i + 1}`;
    return active
      ? `${A.b}${A.bgCy} ${key}:${t} ${A.r}`
      : `${A.gy} ${key}:${t} ${A.r}`;
  }).join(' ');

  write(A.clear);
  write(`${title}  ${A.gy}│${A.r}  ${hint}\n`);
  write(`${A.cy}${hr()}\n${A.r}`);
  write(`${tabLine}\n`);
  write(`${A.gy}${hr()}\n${A.r}`);
}

function renderSearchBar(state) {
  if (state.mode === 'search') {
    write(`${A.yl}/${A.r} ${state.query}${A.inv} ${A.r}\n`);
    write(`${A.gy}${hr()}\n${A.r}`);
  } else if (state.query) {
    write(`${A.gy}filter: ${A.yl}${state.query}${A.r}  (press / to edit, Esc to clear)\n`);
    write(`${A.gy}${hr()}\n${A.r}`);
  }
}

function renderLessons(state) {
  const items = state.filtered;
  const listH = rows() - 8 - (state.query ? 2 : 0);
  const start = Math.max(0, state.cursor - Math.floor(listH / 2));
  const visible = items.slice(start, start + listH);

  if (items.length === 0) {
    write(`\n  ${A.gy}No lessons found.${state.query ? ` Matching "${state.query}".` : ' Run: npx thumbgate capture'}${A.r}\n`);
    return;
  }

  visible.forEach((m, i) => {
    const idx = start + i;
    const selected = idx === state.cursor;
    const signal = (m.tags || []).includes('negative') ? `${A.rd}●${A.r}` : `${A.gn}●${A.r}`;
    const age = `${A.gy}${pad(relDate(m.timestamp), 8)}${A.r}`;
    const titleText = trunc(m.title || m.context || '(untitled)', cols() - 20);
    const row = `  ${signal} ${pad(titleText, cols() - 20)} ${age}`;
    write(selected ? `${A.inv}${row}${A.r}\n` : `${row}\n`);
  });

  const total = items.length;
  write(`\n  ${A.gy}${total} lesson${total !== 1 ? 's' : ''}${state.query ? ` matching "${state.query}"` : ''}${A.r}\n`);
}

function renderGates(state) {
  const items = state.filtered;
  const listH = rows() - 8 - (state.query ? 2 : 0);
  const start = Math.max(0, state.cursor - Math.floor(listH / 2));
  const visible = items.slice(start, start + listH);

  if (items.length === 0) {
    write(`\n  ${A.gy}No gates configured.${A.r}\n`);
    return;
  }

  visible.forEach((g, i) => {
    const idx = start + i;
    const selected = idx === state.cursor;
    const custom = g._custom ? `${A.mg}[custom]${A.r} ` : '';
    const src = `${A.gy}${g._file || ''}${A.r}`;
    const name = g.pattern || g.name || g.id || '(unnamed)';
    const row = `  ${custom}${trunc(name, cols() - 24)} ${src}`;
    write(selected ? `${A.inv}${row}${A.r}\n` : `${row}\n`);
  });

  write(`\n  ${A.gy}${items.length} gate rule${items.length !== 1 ? 's' : ''}${A.r}\n`);
}

function renderStats(state) {
  const stats = state.data.stats;
  if (!stats) {
    write(`\n  ${A.gy}No stats available. Run some feedback captures first.${A.r}\n`);
    write(`  ${A.d}npx thumbgate capture --feedback=down --context="..." --what-went-wrong="..."${A.r}\n`);
    return;
  }
  write('\n');
  const kv = (label, val, color = A.wh) => {
    write(`  ${A.gy}${pad(label, 24)}${A.r}${color}${val}${A.r}\n`);
  };
  kv('Total captures',     stats.total      ?? 0, A.b + A.wh);
  kv('Thumbs up (👍)',      stats.positives  ?? 0, A.gn);
  kv('Thumbs down (👎)',    stats.negatives  ?? 0, A.rd);
  kv('Lessons stored',     state.data.lessons.length, A.cy);
  kv('Gates active',       state.data.gates.length,   A.yl);

  if (stats.topTags && stats.topTags.length > 0) {
    write(`\n  ${A.b}Top tags:${A.r}\n`);
    stats.topTags.slice(0, 8).forEach(([tag, count]) => {
      const bar = '█'.repeat(Math.min(count, 20));
      write(`  ${A.gy}${pad(tag, 20)}${A.r}${A.cy}${bar}${A.r} ${count}\n`);
    });
  }

  if (stats.recentActivity && stats.recentActivity.length > 0) {
    write(`\n  ${A.b}Recent activity:${A.r}\n`);
    stats.recentActivity.slice(0, 5).forEach(a => {
      const icon = a.signal === 'negative' ? `${A.rd}👎${A.r}` : `${A.gn}👍${A.r}`;
      write(`  ${icon} ${A.gy}${relDate(a.timestamp)}${A.r}  ${trunc(a.context || '', cols() - 20)}\n`);
    });
  }
}

function renderRules(state) {
  const items = state.filtered;
  const listH = rows() - 8 - (state.query ? 2 : 0);
  const start = Math.max(0, state.cursor - Math.floor(listH / 2));
  const visible = items.slice(start, start + listH);

  if (items.length === 0) {
    write(`\n  ${A.gy}No prevention rules yet.${A.r}\n`);
    write(`  ${A.d}Run: npx thumbgate feedback:rules${A.r}\n`);
    return;
  }

  visible.forEach((rule, i) => {
    const idx = start + i;
    const selected = idx === state.cursor;
    const isHead = rule.text.match(/^#{1,3}\s/);
    const color = isHead ? A.b + A.cy : A.r;
    const row = `  ${color}${trunc(rule.text, cols() - 4)}${A.r}`;
    write(selected ? `${A.inv}${row}${A.r}\n` : `${row}\n`);
  });

  write(`\n  ${A.gy}${items.length} rule line${items.length !== 1 ? 's' : ''}${A.r}\n`);
}

function renderDetail(state) {
  const item = state.filtered[state.cursor];
  if (!item) return;

  write(`${A.b}${A.cy}Detail View${A.r}  ${A.gy}Esc to go back${A.r}\n`);
  write(`${A.cy}${hr()}\n${A.r}`);

  if (state.tab === 0) {
    // Lesson detail
    const signal = (item.tags || []).includes('negative') ? `${A.rd}negative${A.r}` : `${A.gn}positive${A.r}`;
    const fields = [
      ['Signal',         signal],
      ['Timestamp',      item.timestamp ? new Date(item.timestamp).toLocaleString() : ''],
      ['Tags',           (item.tags || []).join(', ')],
      ['Title',          item.title || item.context || ''],
      ['What went wrong',item.lesson?.whatWentWrong || item.whatWentWrong || ''],
      ['What worked',    item.lesson?.whatWorked    || item.whatWorked    || ''],
      ['How to avoid',   item.lesson?.howToAvoid    || item.howToAvoid    || ''],
      ['Summary',        item.lesson?.summary       || item.summary       || ''],
      ['Content',        item.content || ''],
    ];
    write('\n');
    fields.forEach(([label, val]) => {
      if (!val) return;
      write(`  ${A.b}${pad(label + ':', 18)}${A.r}`);
      const lines = String(val).split('\n');
      lines.forEach((l, i) => {
        write((i === 0 ? '' : ' '.repeat(20)) + trunc(l, cols() - 22) + '\n');
      });
    });
  } else if (state.tab === 1) {
    // Gate detail
    write('\n');
    Object.entries(item).filter(([k]) => !k.startsWith('_')).forEach(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
      write(`  ${A.b}${pad(k + ':', 18)}${A.r}${trunc(val, cols() - 22)}\n`);
    });
  } else if (state.tab === 3) {
    write('\n');
    write(`  ${item.text}\n`);
  }
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

function buildState(data) {
  return {
    tab: 0,
    cursor: 0,
    mode: 'list',   // list | search | detail
    query: '',
    data,
    filtered: data.lessons,
  };
}

function getItems(state) {
  const map = [state.data.lessons, state.data.gates, [], state.data.rules];
  return map[state.tab] || [];
}

function applyFilter(state) {
  const items = getItems(state);
  if (!state.query) return items;
  const q = state.query.toLowerCase();
  return items.filter(item => {
    const text = JSON.stringify(item).toLowerCase();
    return text.includes(q);
  });
}

function render(state) {
  renderHeader(state);
  renderSearchBar(state);

  if (state.mode === 'detail') {
    renderDetail(state);
    return;
  }

  if (state.tab === 0) renderLessons(state);
  else if (state.tab === 1) renderGates(state);
  else if (state.tab === 2) renderStats(state);
  else if (state.tab === 3) renderRules(state);
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function handleKey(state, key, data) {
  if (state.mode === 'search') {
    if (key === 'escape' || key === '\r') {
      state.mode = 'list';
      state.filtered = applyFilter(state);
      state.cursor = 0;
    } else if (key === 'backspace') {
      state.query = state.query.slice(0, -1);
      state.filtered = applyFilter(state);
      state.cursor = 0;
    } else if (data && data.length === 1 && data >= ' ') {
      state.query += data;
      state.filtered = applyFilter(state);
      state.cursor = 0;
    }
    return;
  }

  if (state.mode === 'detail') {
    if (key === 'escape' || key === 'q') {
      state.mode = 'list';
    }
    return;
  }

  // list mode
  switch (key) {
    case 'q':
      cleanup();
      process.exit(0);
      break;
    case 'escape':
      if (state.query) { state.query = ''; state.filtered = applyFilter(state); state.cursor = 0; }
      break;
    case '/':
      state.mode = 'search';
      break;
    case 'return':
      if (state.tab !== 2 && state.filtered.length > 0) {
        state.mode = 'detail';
      }
      break;
    case 'up':
    case 'k':
      state.cursor = clamp(state.cursor - 1, 0, Math.max(0, state.filtered.length - 1));
      break;
    case 'down':
    case 'j':
      state.cursor = clamp(state.cursor + 1, 0, Math.max(0, state.filtered.length - 1));
      break;
    case 'tab':
      state.tab = (state.tab + 1) % TABS.length;
      state.cursor = 0;
      state.query = '';
      state.mode = 'list';
      state.filtered = applyFilter(state);
      break;
    default:
      if (data >= '1' && data <= '4') {
        state.tab = parseInt(data) - 1;
        state.cursor = 0;
        state.query = '';
        state.mode = 'list';
        state.filtered = applyFilter(state);
      }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function cleanup() {
  write(A.showCursor);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  readline.clearLine(process.stdout, 0);
}

function run(options = {}) {
  if (!process.stdout.isTTY) {
    console.error('thumbgate explore requires a TTY terminal.');
    process.exit(1);
  }

  const PKG_ROOT = path.join(__dirname, '..');
  let feedbackDir = options.feedbackDir;
  if (!feedbackDir) {
    try {
      const { getFeedbackPaths } = require('./feedback-loop');
      feedbackDir = getFeedbackPaths().FEEDBACK_DIR;
    } catch {
      feedbackDir = path.join(PKG_ROOT, '.claude', 'memory', 'feedback');
    }
  }

  const data = {
    lessons: loadLessons(feedbackDir),
    gates:   loadGates(PKG_ROOT),
    stats:   loadStats(feedbackDir),
    rules:   loadRules(feedbackDir),
  };

  const state = buildState(data);
  state.filtered = getItems(state);

  // Setup terminal
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  write(A.hideCursor);

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });

  // Handle resize
  process.stdout.on('resize', () => render(state));

  // Keypress handler
  process.stdin.on('data', (ch) => {
    let key = ch;
    if (ch === '\x1b[A') key = 'up';
    else if (ch === '\x1b[B') key = 'down';
    else if (ch === '\x1b[C') key = 'right';
    else if (ch === '\x1b[D') key = 'left';
    else if (ch === '\r' || ch === '\n') key = 'return';
    else if (ch === '\x1b') key = 'escape';
    else if (ch === '\x7f') key = 'backspace';
    else if (ch === '\t') key = 'tab';
    else if (ch === '\x03') { cleanup(); process.exit(0); }

    handleKey(state, key, ch);
    render(state);
  });

  render(state);
}

module.exports = { run };

if (require.main === module) {
  run();
}
