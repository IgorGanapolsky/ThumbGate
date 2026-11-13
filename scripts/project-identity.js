'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KEY_RE = /^(?:(?:repo|local|legacy)_[a-f0-9]{64}|unassigned)$/;
const UNASSIGNED = Object.freeze({ projectKey: 'unassigned', projectName: 'Unassigned', identitySource: 'unassigned' });
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
function resolveLocalProject(cwd = process.cwd(), options = {}) {
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
function legacyAlias(record = {}) {
  const value = record.scope?.projectId || record.metadata?.project || record.metadata?.repo || record.projectId;
  if (typeof value !== 'string' || !value.trim() || /^(unknown|global|default|none|null|unassigned|n\/a)$/i.test(value.trim())) return null;
  return value;
}
function projectForRecord(record = {}, options = {}) {
  if (validProjectKey(record.projectKey)) return { projectKey: record.projectKey, projectName: safeProjectName(record.projectName, record.projectKey === 'unassigned' ? 'Unassigned' : 'Project'), identitySource: record.identitySource || 'recorded' };
  const remote = record.remoteUrl || record.remote || record.metadata?.remoteUrl || record.scope?.remoteUrl;
  if (canonicalRemote(remote)) return projectFromRemote(remote, record.projectName);
  if (record.sourceFeedbackId && options.feedbackById?.has(record.sourceFeedbackId)) {
    return projectForRecord(options.feedbackById.get(record.sourceFeedbackId), { aliases: options.aliases });
  }
  const alias = legacyAlias(record);
  if (alias) {
    const mapped = options.aliases?.get(alias);
    if (mapped) return { ...mapped };
    return { projectKey: `legacy_${hash(alias)}`, projectName: safeProjectName(alias, 'Legacy project') + ' (legacy)', identitySource: 'legacy' };
  }
  return { ...UNASSIGNED };
}
function buildAliases(records) {
  const aliases = new Map();
  const conflicts = new Set();
  for (const record of records) {
    const alias = legacyAlias(record);
    if (!alias || !validProjectKey(record.projectKey) || !/^(repo|local)_/.test(record.projectKey)) continue;
    const descriptor = projectForRecord(record);
    if (aliases.has(alias) && aliases.get(alias).projectKey !== descriptor.projectKey) conflicts.add(alias);
    else aliases.set(alias, descriptor);
  }
  for (const alias of conflicts) aliases.delete(alias);
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
module.exports = { KEY_RE, UNASSIGNED, hash, validProjectKey, safeProjectName, canonicalRemote, projectFromRemote, resolveLocalProject, projectForRecord, buildAliases, matchesProject, gateAppliesToProject, isGeneratedGate, parseProjectSelection, projectForCapture };
