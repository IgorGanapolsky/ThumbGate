'use strict';

// Cost meter: what it costs to run ThumbGate's hosted service, measured from inside the container for free.
//
// Railway bills each service by the minute for the vCPU and memory it uses. This meter samples the container's own
// cgroup counters once a minute (falling back to this Node process when the cgroup files are not readable), keeps
// one row per UTC day for 35 days in <feedbackDir>/cost-meter.json, and counts emails the mailer sent. Nothing here
// calls a paid API, and no address, subject or customer identity is stored: only daily totals.
//
// The owner console turns these totals into dollars with the list rates in config/unit-costs.json.

const fs = require('node:fs');
const path = require('node:path');

const FILE = 'cost-meter.json';
const KEEP_DAYS = 35;
const MAX_FILE_BYTES = 256 * 1024;
const state = { feedbackDir: null, days: {}, loaded: false, last: null, timer: null };

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const finite = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);

function readFileSafe(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

function cleanDays(raw) {
  const out = {};
  for (const [key, row] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !row || typeof row !== 'object') continue;
    out[key] = { sampledSeconds: finite(row.sampledSeconds), cpuSeconds: finite(row.cpuSeconds), memoryGbSeconds: finite(row.memoryGbSeconds), emails: Math.floor(finite(row.emails)), source: typeof row.source === 'string' ? row.source.slice(0, 16) : null };
  }
  return out;
}

function prune(days, nowMs) {
  const oldest = dayKey(nowMs - KEEP_DAYS * 86400000);
  for (const key of Object.keys(days)) if (key < oldest) delete days[key];
  return days;
}

function load() {
  if (state.loaded || !state.feedbackDir) return;
  state.loaded = true;
  const saved = readFileSafe(path.join(state.feedbackDir, FILE));
  // Counts made before the file was read (for example an email sent during start-up) are added to what was saved.
  const saved_days = cleanDays(saved?.days);
  for (const [key, row] of Object.entries(state.days)) {
    const into = saved_days[key] || (saved_days[key] = { sampledSeconds: 0, cpuSeconds: 0, memoryGbSeconds: 0, emails: 0, source: row.source });
    into.sampledSeconds += row.sampledSeconds; into.cpuSeconds += row.cpuSeconds; into.memoryGbSeconds += row.memoryGbSeconds; into.emails += row.emails;
  }
  state.days = saved_days;
}

function flush(nowMs = Date.now()) {
  if (!state.feedbackDir) return false;
  load();
  prune(state.days, nowMs);
  const file = path.join(state.feedbackDir, FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(state.feedbackDir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: new Date(nowMs).toISOString(), days: state.days }));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    return false;
  }
}

function row(nowMs, source) {
  const key = dayKey(nowMs);
  return state.days[key] || (state.days[key] = { sampledSeconds: 0, cpuSeconds: 0, memoryGbSeconds: 0, emails: 0, source });
}

// Container counters when Railway's cgroup v2 files are readable, else this process. Returns null when nothing is readable.
function readCounters({ cgroupRoot = '/sys/fs/cgroup', proc = process } = {}) {
  try {
    const stat = fs.readFileSync(path.join(cgroupRoot, 'cpu.stat'), 'utf8');
    const usage = /usage_usec\s+(\d+)/.exec(stat);
    const memory = Number(fs.readFileSync(path.join(cgroupRoot, 'memory.current'), 'utf8').trim());
    if (usage && Number.isFinite(memory)) return { source: 'container', cpuSeconds: Number(usage[1]) / 1e6, memoryBytes: memory };
  } catch { /* not a cgroup v2 container */ }
  try {
    const cpu = proc.cpuUsage();
    return { source: 'process', cpuSeconds: (cpu.user + cpu.system) / 1e6, memoryBytes: proc.memoryUsage().rss };
  } catch { return null; }
}

// One sample: CPU used since the last sample, and memory held for the time between them.
function sample({ nowMs = Date.now(), counters = readCounters() } = {}) {
  if (!counters) return null;
  const last = state.last;
  state.last = { at: nowMs, ...counters };
  if (!last || last.source !== counters.source) return null;
  const seconds = (nowMs - last.at) / 1000;
  const cpu = counters.cpuSeconds - last.cpuSeconds;
  // A restart, a clock jump or a counter reset gives a gap or a negative step: skip it rather than guess.
  if (!(seconds > 0 && seconds <= 600) || !(cpu >= 0)) return null;
  load();
  const into = row(nowMs, counters.source);
  into.sampledSeconds += seconds;
  into.cpuSeconds += cpu;
  into.memoryGbSeconds += ((last.memoryBytes + counters.memoryBytes) / 2 / 1e9) * seconds;
  into.source = counters.source;
  return { seconds, cpuSeconds: cpu };
}

function recordEmailSend({ nowMs = Date.now(), count = 1 } = {}) {
  if (!Number.isInteger(count) || count < 1) return;
  load();
  row(nowMs, state.last?.source || null).emails += count;
}

function configure({ feedbackDir } = {}) {
  if (feedbackDir && feedbackDir !== state.feedbackDir) { state.feedbackDir = feedbackDir; state.loaded = false; }
  return state.feedbackDir;
}

function start({ feedbackDir, intervalMs = 60000 } = {}) {
  configure({ feedbackDir });
  if (state.timer) return state.timer;
  sample();
  state.timer = setInterval(() => { sample(); flush(); }, intervalMs);
  state.timer.unref?.();
  return state.timer;
}

function stop() { if (state.timer) clearInterval(state.timer); state.timer = null; }

function reset() { stop(); state.feedbackDir = null; state.days = {}; state.loaded = false; state.last = null; }

// Totals for the last `days` UTC days, today included, read from disk plus anything not yet written.
function readWindow({ feedbackDir = state.feedbackDir, days = 30, nowMs = Date.now() } = {}) {
  let rows = {};
  if (feedbackDir && feedbackDir === state.feedbackDir) { load(); rows = state.days; }
  else if (feedbackDir) rows = cleanDays(readFileSafe(path.join(feedbackDir, FILE))?.days);
  const oldest = dayKey(nowMs - (days - 1) * 86400000);
  const total = { days, daysWithSamples: 0, sampledSeconds: 0, cpuSeconds: 0, memoryGbSeconds: 0, emails: 0, sources: [] };
  const sources = new Set();
  for (const [key, entry] of Object.entries(rows)) {
    if (key < oldest || key > dayKey(nowMs)) continue;
    if (entry.sampledSeconds > 0) total.daysWithSamples += 1;
    total.sampledSeconds += entry.sampledSeconds;
    total.cpuSeconds += entry.cpuSeconds;
    total.memoryGbSeconds += entry.memoryGbSeconds;
    total.emails += entry.emails;
    if (entry.source) sources.add(entry.source);
  }
  total.sources = [...sources].sort();
  total.windowSeconds = days * 86400;
  total.coverage = Math.min(1, total.sampledSeconds / total.windowSeconds);
  return total;
}

module.exports = { configure, start, stop, reset, sample, flush, recordEmailSend, readWindow, readCounters, FILE };
