'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KEY_RE = /^(?:(?:repo|local|legacy)_[a-f0-9]{64}|unassigned)$/;
const UNASSIGNED = Object.freeze({ projectKey: 'unassigned', projectName: 'Unassigned (before project tracking)', identitySource: 'unassigned' });
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const validProjectKey = (value) => typeof value === 'string' && KEY_RE.test(value);
function invalid(message) { const error = new Error(message); error.statusCode = 400; return error; }
function safeProjectName(value, fallback = 'Project') {
  const name = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name || /[@\\]|:\/\/|(?:^|\s)\//.test(name)) return fallback;
  return name.slice(0, 120);
}
function canonicalRemote(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let raw = value.trim();
  if (!raw.includes('://') && /^(?:[^@/:]+@)?[^/:]+:.+/.test(raw)) {
    raw = 'ssh://' + raw.replace(/^((?:[^@/:]+@)?[^/:]+):/, '$1/');
  }
  try {
    const url = new URL(raw);
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) || !url.hostname) return null;
    const host = url.hostname.toLowerCase();
    const port = url.port && !((url.protocol === 'ssh:' && url.port === '22') || (url.protocol === 'git:' && url.port === '9418')) ? ':' + url.port : '';
    let repo = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    if (!repo || repo.split('/').some((part) => !part || part === '..' || part === '.')) return null;
    if (host === 'github.com') repo = repo.toLowerCase();
    return `${host}${port}/${repo}`;
  } catch { return null; }
}
function projectFromRemote(remote, name) {
  const canonical = canonicalRemote(remote);
  if (!canonical) throw invalid('Invalid project remote');
  return { projectKey: `repo_${hash(canonical)}`, projectName: safeProjectName(name, canonical.split('/').slice(1).join('/')), identitySource: 'remote' };
}
function machineIdentity(options = {}) {
  if (options.machineId) return String(options.machineId);
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try { const id = fs.readFileSync(file, 'utf8').trim(); if (id) return id; } catch { /* OS dependent */ }
  }
  if (process.platform === 'darwin') {
    try { const match = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 1500 }).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/); if (match) return match[1]; } catch { /* fallback below */ }
  }
  const file = options.machineIdPath || path.join(os.homedir(), '.thumbgate', 'machine-id');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* first local resolution */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, crypto.randomUUID(), { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return fs.readFileSync(file, 'utf8').trim();
}
function git(cwd, args) {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}
const localProjectCache = new Map();
// Fingerprint of the git config that decides identity (remotes, worktree link). A changed remote changes the stamp, so a stale entry is never served.
function gitConfigStamp(cwd) {
  let dir = path.resolve(cwd);
  for (let depth = 0; depth < 64; depth += 1) {
    const dotGit = path.join(dir, '.git');
    try {
      const stat = fs.statSync(dotGit);
      let gitDir = dotGit;
      const parts = [];
      if (stat.isFile()) {
        const match = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m);
        if (!match) return null;
        gitDir = path.resolve(dir, match[1].trim());
        parts.push(`${dotGit}:${stat.mtimeMs}`);
      }
      let common = gitDir;
      try { common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()); } catch { /* not a linked worktree */ }
      const config = fs.statSync(path.join(common, 'config'));
      parts.push(`${gitDir}`, `${common}:${config.mtimeMs}:${config.size}`);
      return parts.join('|');
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
// Each resolution spawns up to four git processes; tool calls and audit events resolve on every event, so memoize per cwd.
function resolveLocalProject(cwd = process.cwd(), options = {}) {
  const stamp = gitConfigStamp(cwd);
  if (!stamp) return resolveLocalProjectUncached(cwd, options);
  const key = `${path.resolve(cwd)}\0${options.machineId || ''}\0${options.machineIdPath || ''}`;
  const hit = localProjectCache.get(key);
  if (hit && hit.stamp === stamp) return { ...hit.value };
  const value = resolveLocalProjectUncached(cwd, options);
  localProjectCache.set(key, { stamp, value });
  return { ...value };
}
function resolveLocalProjectUncached(cwd = process.cwd(), options = {}) {
  let root = git(cwd, ['rev-parse', '--show-toplevel']) || path.resolve(cwd);
  try { root = fs.realpathSync(root); } catch { return { ...UNASSIGNED }; }
  const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const remotes = git(root, ['remote']).split('\n').filter(Boolean).sort();
  const remote = git(root, ['remote', 'get-url', remotes.includes('origin') ? 'origin' : remotes[0] || 'origin']);
  if (canonicalRemote(remote)) return projectFromRemote(remote);
  // Common git metadata gives remote-less worktrees the identity of their repository.
  if (common && path.basename(common) === '.git') root = path.dirname(common);
  return { projectKey: `local_${hash(`${machineIdentity(options)}\0${root}`)}`, projectName: safeProjectName(path.basename(root), 'Local project'), identitySource: 'local' };
}
function legacyAlias(record = {}, options = {}) {
  const registry = options.recordType === 'agent-registry.jsonl' || record.recordType === 'agent-registry.jsonl';
  const value = record.scope?.projectId || record.metadata?.project || record.metadata?.repo || record.projectId || (registry ? record.registryProject || record.project : null);
  if (typeof value !== 'string' || !value.trim() || /^(unknown|global|default|none|null|unassigned|n\/a)$/i.test(value.trim())) return null;
  return value;
}
function recordedRemotes(record = {}) {
  return [record.remoteUrl, record.remote, record.metadata?.remoteUrl, record.metadata?.remote, record.scope?.remoteUrl, record.scope?.remote].filter((value) => canonicalRemote(value));
}
function legacyDescriptor(alias) { return { projectKey: `legacy_${hash(alias)}`, projectName: safeProjectName(alias, 'Legacy project') + ' (legacy)', identitySource: 'legacy' }; }
function resolveProjectEvidence(record = {}, options = {}) {
  const outcome = (descriptor, evidence, reason = null, anchorEvidence = null) => ({ descriptor, evidence, reason, anchorEvidence });
  const missing = (reason) => outcome({ ...UNASSIGNED }, 'unassigned', reason);
  if (validProjectKey(record.projectKey) && record.projectKey !== 'unassigned') return outcome({ projectKey: record.projectKey, projectName: safeProjectName(record.projectName, 'Project'), identitySource: record.identitySource || 'recorded' }, 'recorded_key');
  const remotes = recordedRemotes(record);
  if (new Set(remotes.map(canonicalRemote)).size > 1) return missing('conflicting_recorded_remotes');
  if (remotes.length) return outcome(projectFromRemote(remotes[0], record.projectName), 'recorded_remote');
  const recordType = options.recordType || record.recordType;
  const alias = legacyAlias(record, options);
  const mapped = alias && options.aliases?.get(alias);
  if (mapped?.ambiguous) return outcome(legacyDescriptor(alias), 'legacy_scope', 'ambiguous_alias');
  const pathResult = options.pathEvidence?.resolve(recordType === 'agent-registry.jsonl' ? { ...record, registryProject: record.registryProject || record.project } : record);
  if (['conflicting_paths', 'conflicting_path_remotes'].includes(pathResult?.reason)) return missing(pathResult.reason);
  const references = [];
  if (record.sourceFeedbackId) references.push([options.feedbackById?.get(record.sourceFeedbackId), 'feedback_reference']);
  if (record.sourceLessonId) references.push([options.lessonById?.get(record.sourceLessonId), 'lesson_reference']);
  const agentId = record.agentId || (recordType === 'observed-agents.jsonl' ? record.id : null);
  if (agentId) references.push([options.registryById?.get(agentId), 'agent_registry_reference']);
  const usable = references.filter(([candidate]) => candidate && candidate.projectKey !== 'unassigned');
  if (references.some(([candidate]) => candidate?.ambiguous)) return missing('ambiguous_source_id');
  const canonical = [...usable.map(([candidate]) => candidate), mapped].filter((candidate) => candidate && /^(repo|local)_/.test(candidate.projectKey));
  if (new Set(canonical.map((candidate) => candidate.projectKey)).size > 1) return missing('conflicting_references');
  if (pathResult?.descriptor) {
    if (canonical.some((candidate) => candidate.projectKey !== pathResult.descriptor.projectKey)) return missing('conflicting_path_reference');
    return outcome(pathResult.descriptor, 'path_remote_current');
  }
  if (new Set(usable.map(([candidate]) => candidate.projectKey)).size > 1) return missing('conflicting_references');
  if (mapped) return outcome({ ...mapped }, 'scope_mapping');
  if (usable.length) { const [candidate, evidence] = usable[0]; return outcome({ projectKey: candidate.projectKey, projectName: candidate.projectName, identitySource: evidence }, evidence, null, candidate.evidence || candidate.identitySource); }
  const session = options.sessionLookup?.(record);
  if (alias && session?.projectKey === legacyDescriptor(alias).projectKey) return outcome(legacyDescriptor(alias), recordType === 'agent-registry.jsonl' ? 'registry_legacy_project' : 'legacy_scope');
  if (session?.ambiguous) return missing('conflicting_session');
  if (session?.projectKey && session.projectKey !== 'unassigned') return outcome({ projectKey: session.projectKey, projectName: session.projectName, identitySource: 'session_anchor' }, 'session_anchor', null, session.evidence);
  if (alias) return outcome(legacyDescriptor(alias), recordType === 'agent-registry.jsonl' ? 'registry_legacy_project' : 'legacy_scope');
  return missing(pathResult?.reason && pathResult.reason !== 'no_path_evidence' ? pathResult.reason : 'no_admissible_evidence');
}
function projectForRecord(record = {}, options = {}) { return resolveProjectEvidence(record, options).descriptor; }
function buildAliases(records) {
  const aliases = new Map();
  for (const record of records) {
    const alias = legacyAlias(record);
    const descriptor = resolveProjectEvidence(record).descriptor;
    if (!alias || !/^(repo|local)_/.test(descriptor.projectKey)) continue;
    const previous = aliases.get(alias);
    if (previous && (previous.ambiguous || previous.projectKey !== descriptor.projectKey)) aliases.set(alias, { ambiguous: true });
    else aliases.set(alias, descriptor);
  }
  return aliases;
}
function matchesProject(record, projectKey, options = {}) { return projectKey == null || projectForRecord(record, options).projectKey === projectKey; }
function isGeneratedGate(gate = {}) { return Boolean(gate.autoPromoted || gate.generated || gate.sourceLessonId || gate.sourceFeedbackId || gate.source === 'auto-promote' || /^auto[-_]/.test(gate.id || '')); }
function gateAppliesToProject(gate, projectKey) {
  if (gate.active === false || gate.enabled === false) return false;
  if (gate.scope === 'global') return true;
  if (gate.scope === 'project' || validProjectKey(gate.projectKey)) return validProjectKey(gate.projectKey) && gate.projectKey !== 'unassigned' && gate.projectKey === (projectKey || 'unassigned');
  return !isGeneratedGate(gate);
}
function parseProjectSelection(searchParams, headers = {}, body = {}) {
  const values = searchParams?.getAll('project') || [];
  if (values.length > 1) throw invalid('Repeated project selection');
  const supplied = [...values, headers['x-thumbgate-project'], body.projectKey].filter((value) => value !== undefined && value !== null);
  const normalized = supplied.map((value) => {
    if (value === 'all') return null;
    if (!validProjectKey(value)) throw invalid('Invalid project key');
    return value;
  });
  if (normalized.some((value) => value !== normalized[0])) throw invalid('Conflicting project selections');
  return normalized.length ? normalized[0] : null;
}
function projectForCapture(input = {}, options = {}) {
  if (input.projectKey != null && !validProjectKey(input.projectKey)) throw invalid('Invalid project key');
  const remote = input.remoteUrl ? projectFromRemote(input.remoteUrl, input.projectName) : null;
  if (remote && input.projectKey && remote.projectKey !== input.projectKey) throw invalid('Project key does not match remote');
  if (options.hosted) return remote || (input.projectKey ? projectForRecord(input) : { ...UNASSIGNED });
  const descriptor = resolveLocalProject(input.cwd || options.cwd || process.cwd(), options);
  if ((input.projectKey && input.projectKey !== descriptor.projectKey) || (remote && remote.projectKey !== descriptor.projectKey)) throw invalid('Project key does not match execution directory');
  return descriptor;
}
module.exports = { KEY_RE, UNASSIGNED, hash, validProjectKey, safeProjectName, canonicalRemote, projectFromRemote, resolveLocalProject, legacyAlias, recordedRemotes, resolveProjectEvidence, projectForRecord, buildAliases, matchesProject, gateAppliesToProject, isGeneratedGate, parseProjectSelection, projectForCapture };
