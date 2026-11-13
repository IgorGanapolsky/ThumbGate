'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildAliases, projectForRecord, matchesProject, gateAppliesToProject, isGeneratedGate } = require('./project-identity');

const SIGNAL_FILES = ['feedback-log.jsonl', 'memory-log.jsonl', 'audit-trail.jsonl', 'gate-events-log.jsonl', 'telemetry-pings.jsonl', 'telemetry-log.jsonl', 'agent-registry.jsonl', 'observed-agents.jsonl', 'diagnostic-log.jsonl', 'decision-journal.jsonl', 'tool-kpi.jsonl', 'task-outcome-receipts.jsonl'];
function accountDirectories(root) {
  const absolute = path.resolve(root);
  if (!fs.existsSync(absolute)) return [];
  const canonical = fs.realpathSync(absolute);
  const directories = [canonical];
  const projects = path.join(canonical, 'projects');
  if (fs.existsSync(projects)) {
    if (fs.lstatSync(projects).isSymbolicLink()) throw new Error('Symlink signal directory refused');
    for (const item of fs.readdirSync(projects, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('Symlink project directory refused');
      if (item.isDirectory()) directories.push(path.join(projects, item.name));
    }
  }
  return [...new Set(directories)];
}
function signalPaths(root, filename) {
  return accountDirectories(root).map((dir) => path.join(dir, filename)).filter((file) => {
    if (!fs.existsSync(file)) return false;
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Symlink signal file refused');
    return fs.statSync(file).isFile();
  });
}
function *iterateRows(file) {
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  const decoder = new (require('node:string_decoder').StringDecoder)('utf8');
  let pending = '';
  const parse = (line) => { try { const row = JSON.parse(line); return row && typeof row === 'object' && !Array.isArray(row) ? row : null; } catch { return null; } };
  try {
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      pending += decoder.write(buffer.subarray(0, n));
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const row = parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
        if (row) yield row;
      }
      if (pending.length > 8 * 1024 * 1024) throw new Error('Signal row exceeds supported size');
    }
    const row = parse(pending + decoder.end());
    if (row) yield row;
  } finally { fs.closeSync(fd); }
}
function readRows(file) { return [...iterateRows(file)]; }
function uniqueSourceIndex(records, aliases) {
  const index = new Map();
  for (const record of records) {
    if (!record.id) continue;
    const descriptor = projectForRecord(record, { aliases });
    const prior = index.get(record.id);
    index.set(record.id, prior && prior.projectKey !== descriptor.projectKey ? { projectKey: 'unassigned', projectName: 'Unassigned', identitySource: 'ambiguous-source' } : (prior || descriptor));
  }
  return index;
}
function accountAttribution(root) {
  const feedback = [];
  const evidence = [];
  const byDirectory = new Map();
  for (const filename of ['feedback-log.jsonl', 'memory-log.jsonl']) {
    for (const file of signalPaths(root, filename)) {
      const local = byDirectory.get(path.dirname(file)) || [];
      byDirectory.set(path.dirname(file), local);
      for (const row of iterateRows(file)) {
        const record = { id: row.id, projectKey: row.projectKey, projectName: row.projectName, identitySource: row.identitySource, remoteUrl: row.remoteUrl || row.remote || row.metadata?.remoteUrl, scope: row.scope, metadata: { project: row.metadata?.project, repo: row.metadata?.repo }, projectId: row.projectId };
        if (filename === 'feedback-log.jsonl') { feedback.push(record); local.push(record); }
        if (record.projectKey && (record.scope?.projectId || record.metadata.project || record.metadata.repo)) evidence.push(record);
      }
    }
  }
  const aliases = buildAliases(evidence);
  return { aliases, feedbackById: uniqueSourceIndex(feedback, aliases), feedbackByDirectory: new Map([...byDirectory].map(([dir, records]) => [dir, uniqueSourceIndex(records, aliases)])) };
}
function attributionForFile(attribution, file) {
  const local = attribution.feedbackByDirectory?.get(path.dirname(file));
  if (!local?.size) return attribution;
  return { ...attribution, feedbackById: new Map([...attribution.feedbackById, ...local]) };
}
function readProjectRows(root, filename, options = {}) {
  const attribution = options.attribution || accountAttribution(root);
  const seen = new Set();
  const rows = [];
  for (const file of signalPaths(root, filename)) {
    for (const record of iterateRows(file)) {
      const row = { ...record, ...projectForRecord(record, attributionForFile(attribution, file)) };
      if (!matchesProject(row, options.projectKey)) continue;
      const id = row.id || row.feedbackId;
      const key = id ? `${row.projectKey}\0${id}` : null;
      if (options.dedupe !== false && key && seen.has(key)) continue;
      if (key) seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}
function readProjectGates(root, options = {}) {
  const attribution = accountAttribution(root);
  const source = ['feedback-log.jsonl', 'memory-log.jsonl'].flatMap((name) => readProjectRows(root, name, { attribution }));
  const byId = uniqueSourceIndex(source, attribution.aliases);
  const files = [path.join(__dirname, '..', 'config', 'gates', 'default.json'), ...accountDirectories(root).flatMap((dir) => ['auto-promoted-gates.json', 'custom-gates.json'].map((name) => path.join(dir, name)))];
  const gates = new Map();
  for (const file of files) {
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) continue;
    let config;
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    for (const item of Array.isArray(config) ? config : config.gates || []) {
      let gate = { ...item };
      const generated = path.basename(file) === 'auto-promoted-gates.json' || isGeneratedGate(gate);
      if (generated && !gate.projectKey) {
        const sourceId = gate.sourceLessonId || gate.sourceFeedbackId;
        const local = [];
        for (const name of ['feedback-log.jsonl', 'memory-log.jsonl']) {
          const sourceFile = path.join(path.dirname(file), name);
          if (fs.existsSync(sourceFile)) for (const row of iterateRows(sourceFile)) local.push({ ...row, ...projectForRecord(row, attributionForFile(attribution, sourceFile)) });
        }
        const localIndex = uniqueSourceIndex(local, attribution.aliases);
        const seed = localIndex.has(sourceId) ? localIndex.get(sourceId) : byId.get(sourceId);
        gate = { ...gate, ...projectForRecord(seed || gate, attribution), scope: 'project' };
        if (gate.projectKey === 'unassigned') gate.active = false;
      } else gate.scope = gate.scope || (gate.projectKey ? 'project' : 'global');
      if (options.projectKey != null && !gateAppliesToProject(gate, options.projectKey)) continue;
      gates.set(`${gate.projectKey || 'global'}\0${gate.id}`, gate);
    }
  }
  return [...gates.values()];
}
function buildProjectCatalog(root) {
  const projects = new Map();
  const attribution = accountAttribution(root);
  const ensure = (row) => {
    const descriptor = projectForRecord(row, attribution);
    if (!projects.has(descriptor.projectKey)) projects.set(descriptor.projectKey, { ...descriptor, counts: { feedback: 0, lessons: 0, gates: 0, blocks: 0, warns: 0, toolCalls: 0, agents: 0 }, lastActivity: null });
    return projects.get(descriptor.projectKey);
  };
  for (const filename of SIGNAL_FILES) {
    const agents = new Set();
    for (const row of readProjectRows(root, filename, { attribution })) {
      const project = ensure(row);
      const stamp = row.timestamp || row.lastSeenAt || row.registeredAt;
      if (stamp && Number.isFinite(Date.parse(stamp)) && (!project.lastActivity || Date.parse(stamp) > Date.parse(project.lastActivity))) project.lastActivity = stamp;
      if (filename === 'feedback-log.jsonl') project.counts.feedback++;
      if (filename === 'memory-log.jsonl') project.counts.lessons++;
      if (filename === 'audit-trail.jsonl') {
        if (['deny', 'block'].includes(row.decision || row.action)) project.counts.blocks++;
        if ((row.decision || row.action) === 'warn') project.counts.warns++;
        project.counts.toolCalls++;
      }
      if (filename === 'agent-registry.jsonl') {
        const key = `${row.projectKey}\0${row.agentId || row.id}`;
        if (!agents.has(key)) { project.counts.agents++; agents.add(key); }
      }
    }
  }
  const gates = readProjectGates(root);
  for (const gate of gates) {
    if (gate.scope !== 'project') continue;
    const project = ensure(gate);
    if (gateAppliesToProject(gate, gate.projectKey)) project.counts.gates++;
    for (const stamp of [gate.timestamp, gate.promotedAt, gate.updatedAt]) {
      if (stamp && Number.isFinite(Date.parse(stamp)) && (!project.lastActivity || Date.parse(stamp) > Date.parse(project.lastActivity))) project.lastActivity = stamp;
    }
  }
  return { projects: [...projects.values()].sort((a, b) => a.projectName.localeCompare(b.projectName)), globalGateCount: gates.filter((gate) => gate.scope === 'global' && gate.active !== false && gate.enabled !== false).length };
}
module.exports = { attributionForFile, uniqueSourceIndex, iterateRows, SIGNAL_FILES, accountDirectories, signalPaths, readRows, accountAttribution, readProjectRows, readProjectGates, buildProjectCatalog };
