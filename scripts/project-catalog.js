'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertScopedDataPath, tenantDataScope } = require('./feedback-scope');
const { buildAliases, resolveProjectEvidence, projectForRecord, matchesProject, gateAppliesToProject, isGeneratedGate } = require('./project-identity');

const SIGNAL_FILES = ['feedback-log.jsonl', 'memory-log.jsonl', 'audit-trail.jsonl', 'gate-events-log.jsonl', 'telemetry-pings.jsonl', 'telemetry-log.jsonl', 'agent-registry.jsonl', 'observed-agents.jsonl', 'diagnostic-log.jsonl', 'decision-journal.jsonl', 'tool-kpi.jsonl', 'task-outcome-receipts.jsonl'];
function accountDirectories(root) {
  const absolute = assertScopedDataPath(path.resolve(root));
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
  return accountDirectories(root).map((dir) => assertScopedDataPath(path.join(dir, filename))).filter((file) => {
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
    const resolved = record.descriptor ? record : resolveProjectEvidence(record, { aliases });
    const descriptor = resolved.descriptor;
    if (descriptor.projectKey === 'unassigned') {
      if (/^(conflicting_|ambiguous_)/.test(resolved.reason || '')) index.set(record.id, { ambiguous: true, projectKey: 'unassigned' });
      continue;
    }
    const prior = index.get(record.id);
    index.set(record.id, prior && (prior.ambiguous || prior.projectKey !== descriptor.projectKey) ? { ambiguous: true, projectKey: 'unassigned' } : (prior || { ...descriptor, evidence: resolved.evidence || descriptor.identitySource }));
  }
  return index;
}
function compactEvidence(row, filename) {
  const { pathCandidates } = require('./project-evidence');
  return {
    id: row.id, projectKey: row.projectKey, projectName: row.projectName, identitySource: row.identitySource,
    remoteUrl: row.remoteUrl, remote: row.remote, scope: row.scope ? { projectId: row.scope.projectId, sessionId: row.scope.sessionId, remoteUrl: row.scope.remoteUrl, remote: row.scope.remote } : undefined,
    metadata: row.metadata ? { project: row.metadata.project, repo: row.metadata.repo, remoteUrl: row.metadata.remoteUrl, remote: row.metadata.remote, machineId: row.metadata.machineId, importedFrom: row.metadata.importedFrom, sourceType: row.metadata.sourceType } : undefined,
    projectId: row.projectId, registryProject: filename === 'agent-registry.jsonl' ? row.project : undefined,
    sourceFeedbackId: row.sourceFeedbackId, sourceLessonId: row.sourceLessonId, agentId: row.agentId,
    sessionId: row.sessionId, timestamp: row.timestamp, seenAt: row.seenAt, registeredAt: row.registeredAt, lastSeenAt: row.lastSeenAt,
    source: row.source, sourceType: row.sourceType, machineId: row.machineId, sourceMachineId: row.sourceMachineId,
    imported: row.imported, importedFrom: row.importedFrom, syncedFrom: row.syncedFrom, provenance: row.provenance ? { imported: row.provenance.imported, origin: row.provenance.origin, machineId: row.provenance.machineId } : undefined,
    recordType: filename, pathCandidates: pathCandidates({ ...row, registryProject: filename === 'agent-registry.jsonl' ? row.project : undefined }).slice(0, 17),
  };
}
function sessionToken(record, options = {}) {
  const id = record.sessionId || record.scope?.sessionId;
  if (typeof id !== 'string' || !id || /^(unknown|default|none|null|session|\d+)$/i.test(id)) return null;
  const machines = [record.sourceMachineId, record.machineId, record.metadata?.machineId, record.provenance?.machineId].filter(Boolean);
  if (new Set(machines).size > 1) return null;
  const machine = machines[0];
  if (require('./project-evidence').provenanceReason(record, { sourceMachineId: machine })) return null;
  if (!machine && options.trustedLocalSource !== true) return null;
  if (machine && options.sourceMachineId && machine !== options.sourceMachineId) return null;
  return `${machine || 'trusted_local'}\0${record.source || record.sourceType || record.recordType || ''}\0${id}`;
}
function accountAttribution(root, options = {}) {
  const records = []; const directories = new Map();
  for (const filename of SIGNAL_FILES) for (const file of signalPaths(root, filename)) {
    const local = directories.get(path.dirname(file)) || []; directories.set(path.dirname(file), local);
    for (const row of iterateRows(file)) {
      const record = compactEvidence(row, filename);
      // Identity indexes never retain duplicated context/tool payloads from large logs.
      if (!record.id && !record.agentId && !record.projectKey && !record.remoteUrl && !record.remote && !record.scope?.projectId && !record.registryProject && !record.sessionId && !record.sourceFeedbackId && !record.sourceLessonId && !record.pathCandidates.length) continue;
      records.push(record); local.push(record);
    }
  }
  const aliases = buildAliases(records);
  const pathEvidence = require('./project-evidence').createPathEvidence(options.localPathEvidence);
  const state = { aliases, pathEvidence, localPathEvidence: options.localPathEvidence, feedbackById: new Map(), lessonById: new Map(), feedbackByDirectory: new Map(), lessonByDirectory: new Map(), registryByDirectory: new Map(), sessionsByDirectory: new Map() };
  const resolveRows = (rows, filename, context) => rows.filter((row) => row.recordType === filename).map((row) => ({ id: row.id, ...resolveProjectEvidence(row, context) }));
  for (const [directory, local] of directories) state.registryByDirectory.set(directory, uniqueSourceIndex(resolveRows(local, 'agent-registry.jsonl', { aliases, pathEvidence })));
  for (const [directory, local] of directories) {
    const context = { aliases, pathEvidence, registryById: state.registryByDirectory.get(directory) };
    state.feedbackByDirectory.set(directory, uniqueSourceIndex(resolveRows(local, 'feedback-log.jsonl', context)));
  }
  state.feedbackById = mergeSourceIndexes(state.feedbackByDirectory);
  for (const [directory, local] of directories) {
    const context = attributionForFile(state, path.join(directory, 'memory-log.jsonl'));
    state.lessonByDirectory.set(directory, uniqueSourceIndex(resolveRows(local, 'memory-log.jsonl', context)));
  }
  state.lessonById = mergeSourceIndexes(state.lessonByDirectory);
  for (const [directory, local] of directories) {
    const sessions = new Map();
    for (const row of local) {
      const token = sessionToken(row, options.localPathEvidence); const stamp = Date.parse(row.timestamp || row.seenAt || row.registeredAt || row.lastSeenAt);
      if (!token || !Number.isFinite(stamp)) continue;
      const resolved = resolveProjectEvidence(row, attributionForFile(state, path.join(directory, row.recordType)));
      if (resolved.descriptor.projectKey === 'unassigned') continue;
      const prior = sessions.get(token);
      sessions.set(token, prior ? { ...prior, ambiguous: prior.ambiguous || prior.projectKey !== resolved.descriptor.projectKey, first: Math.min(prior.first, stamp), last: Math.max(prior.last, stamp) } : { ...resolved.descriptor, evidence: resolved.evidence, first: stamp, last: stamp });
    }
    state.sessionsByDirectory.set(directory, sessions);
  }
  // Fixed session anchors may support typed descendants, but descendants never
  // feed back into session anchors or scope aliases.
  for (const [directory, local] of directories) state.feedbackByDirectory.set(directory, uniqueSourceIndex(resolveRows(local, 'feedback-log.jsonl', attributionForFile(state, path.join(directory, 'feedback-log.jsonl')))));
  state.feedbackById = mergeSourceIndexes(state.feedbackByDirectory);
  for (const [directory, local] of directories) state.lessonByDirectory.set(directory, uniqueSourceIndex(resolveRows(local, 'memory-log.jsonl', attributionForFile(state, path.join(directory, 'memory-log.jsonl')))));
  state.lessonById = mergeSourceIndexes(state.lessonByDirectory);
  return state;
}
function mergeSourceIndexes(byDirectory) {
  const merged = new Map();
  for (const index of byDirectory.values()) for (const [id, descriptor] of index) {
    const prior = merged.get(id);
    merged.set(id, descriptor.ambiguous || (prior && (prior.ambiguous || prior.projectKey !== descriptor.projectKey)) ? { ambiguous: true, projectKey: 'unassigned' } : descriptor);
  }
  return merged;
}
function attributionForFile(attribution, file) {
  const directory = path.dirname(file);
  const overlay = (global, local) => local?.size ? new Map([...(global || []), ...local]) : global;
  const sessions = attribution.sessionsByDirectory?.get(directory);
  return { ...attribution, recordType: path.basename(file),
    feedbackById: overlay(attribution.feedbackById, attribution.feedbackByDirectory?.get(directory)),
    lessonById: overlay(attribution.lessonById, attribution.lessonByDirectory?.get(directory)),
    registryById: attribution.registryByDirectory?.get(directory),
    sessionLookup(record) {
      const candidate = sessions?.get(sessionToken({ ...record, recordType: path.basename(file) }, attribution.localPathEvidence));
      if (!candidate) return null;
      const stamp = Date.parse(record.timestamp || record.seenAt || record.registeredAt || record.lastSeenAt);
      if (!Number.isFinite(stamp) || candidate.last - candidate.first > 86400000 || stamp < candidate.first || stamp > candidate.last) return null;
      return candidate;
    },
  };
}
function readProjectRows(root, filename, options = {}) {
  const attribution = options.attribution || accountAttribution(root, options);
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
  const attribution = options.attribution || accountAttribution(root, options);
  const defaultFile = path.join(__dirname, '..', 'config', 'gates', 'default.json');
  // The primary policy file is the operator's configured safety policy: always global, never re-attributed to a project.
  const primaryFile = tenantDataScope() ? defaultFile : (process.env.THUMBGATE_GATES_CONFIG || defaultFile);
  const files = [primaryFile, ...accountDirectories(root).flatMap((dir) => ['auto-promoted-gates.json', 'custom-gates.json'].map((name) => path.join(dir, name)))];
  const gates = new Map();
  for (const file of files) {
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) continue;
    let config; try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    for (const item of Array.isArray(config) ? config : config.gates || []) {
      let gate = { ...item };
      const generated = file !== primaryFile && (path.basename(file) === 'auto-promoted-gates.json' || isGeneratedGate(gate));
      if (generated && (!gate.projectKey || gate.projectKey === 'unassigned')) {
        gate = { ...gate, ...projectForRecord(gate, attributionForFile(attribution, file)), scope: 'project' };
        if (gate.projectKey === 'unassigned') gate.active = false;
      } else gate.scope = gate.scope || (gate.projectKey ? 'project' : 'global');
      if (options.projectKey != null && !gateAppliesToProject(gate, options.projectKey)) continue;
      gates.set(`${gate.projectKey || 'global'}\0${gate.id}`, gate);
    }
  }
  return [...gates.values()];
}
function buildProjectCatalog(root, options = {}) {
  const projects = new Map();
  const attribution = options.attribution || accountAttribution(root, options);
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
  const gates = readProjectGates(root, { ...options, attribution });
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
