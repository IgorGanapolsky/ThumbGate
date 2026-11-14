'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalRemote, projectFromRemote } = require('./project-identity');
const TRUNCATED = /(?:\.{3}|…)\s*$/;
const inside = (candidate, root) => candidate === root || candidate.startsWith(root + path.sep);
const signature = (file) => { try { const s = fs.lstatSync(file, { bigint: true }); return `${s.ino}:${s.size}:${s.mtimeNs}`; } catch { return null; } };

function literalCommandPaths(command) {
  if (typeof command !== 'string' || command.length > 16384 || TRUNCATED.test(command)) return [];
  if (/[\x00-\x1f`$<>|]|[(){}]/.test(command)) return [];
  const tokens = []; let token = ''; let quote = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) { if (char === quote) quote = null; else if (char === '\\') return []; else token += char; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '\\') return [];
    if (/\s/.test(char)) { if (token) tokens.push(token); token = ''; continue; }
    if (char === ';' || char === '&') { if (token) tokens.push(token); token = ''; if (char === '&' && command[++i] !== '&') return []; tokens.push(';'); continue; }
    token += char;
  }
  if (quote) return []; if (token) tokens.push(token);
  const result = []; let segment = [];
  const inspect = () => {
    if (segment[0] === 'cd' && segment.length === 2) result.push({ value: segment[1], kind: 'command_directory' });
    if (segment[0] === 'git' && segment[1] === '-C' && segment[2] && /^[a-z][a-z0-9-]*$/.test(segment[3] || '')) result.push({ value: segment[2], kind: 'command_directory' });
    // Only absolute literal operands of these inspection commands are candidates.
    if (['cat', 'head', 'tail', 'wc', 'ls'].includes(segment[0])) {
      const operands = []; let valid = true; let endOptions = false;
      for (let i = 1; i < segment.length; i++) {
        const value = segment[i];
        if (!endOptions && value === '--') { endOptions = true; continue; }
        if (!endOptions && value.startsWith('-')) {
          if (['head', 'tail'].includes(segment[0]) && ['-n', '-c'].includes(value)) { if (!/^[+-]?\d+$/.test(segment[++i] || '')) valid = false; }
          else if (!(segment[0] === 'cat' ? /^-[AbEenstTuv]+$/ : segment[0] === 'wc' ? /^-[clmwL]+$/ : segment[0] === 'ls' ? /^-[aAbBcCdDfFgGhHiklLmnpqQrRsStuUvVxX1]+$/ : /$a/).test(value)) valid = false;
          continue;
        }
        if (path.isAbsolute(value)) operands.push({ value, kind: 'command_file' });
      }
      if (valid) result.push(...operands);
    }
    segment = [];
  };
  for (const part of [...tokens, ';']) { if (part === ';') inspect(); else segment.push(part); }
  return result.filter((candidate) => path.isAbsolute(candidate.value));
}
function pathCandidates(record = {}) {
  if (Array.isArray(record.pathCandidates)) return record.pathCandidates;
  const result = [];
  const add = (value, kind) => { if (typeof value === 'string' && value) result.push({ value, kind }); };
  for (const source of [record, record.toolInput, record.toolInput?.tool_input, record.tool_input]) {
    if (!source || typeof source !== 'object') continue;
    for (const key of ['cwd', 'workingDirectory', 'workdir', 'repoPath', 'projectDir', 'hookWorkingDirectory']) add(source[key], 'directory');
    for (const key of ['filePath', 'file_path']) add(source[key], 'file');
    for (const key of ['filePaths', 'affectedFiles', 'changedFiles']) if (Array.isArray(source[key])) for (const value of source[key]) add(value, 'file');
  }
  for (const value of [record.scope?.projectId, record.registryProject]) if (typeof value === 'string' && path.isAbsolute(value)) add(value, 'directory');
  for (const command of [record.toolInput?.command, record.toolInput?.tool_input?.command, record.tool_input?.command]) result.push(...literalCommandPaths(command));
  return result;
}
function provenanceReason(record, options) {
  if (record.imported || record.importedFrom || record.syncedFrom || record.metadata?.importedFrom || record.provenance?.imported) return 'foreign_provenance';
  const origin = [record.source, record.sourceType, record.provenance?.origin, record.metadata?.sourceType].filter((value) => typeof value === 'string').join(' ');
  if (/\b(imported?|remote|cloud[-_ ]sync|hermes[-_ ]sync)\b/i.test(origin)) return 'foreign_provenance';
  const machines = [record.sourceMachineId, record.machineId, record.metadata?.machineId, record.provenance?.machineId].filter(Boolean);
  if (new Set(machines).size > 1) return 'foreign_machine';
  const machine = machines[0];
  if (machine && (!options.sourceMachineId || machine !== options.sourceMachineId)) return 'foreign_machine';
  return null;
}
function createPathEvidence(options = {}) {
  const enabled = options.trustedLocalSource === true;
  const roots = enabled ? (options.allowedRoots || []).flatMap((root) => { try { return [path.resolve(root), fs.realpathSync(root)]; } catch { return []; } }) : [];
  const limits = { candidates: 4096, ancestors: 32, pathsPerRow: 16, pathBytes: 4096, fileBytes: 256 * 1024, totalBytes: 16 * 1024 * 1024, ...(options.limits || {}) };
  const cache = new Map(); const diagnostics = {}; let bytes = 0; let probes = 0;
  const failure = (reason) => ({ descriptor: null, reason });
  const count = (reason) => { diagnostics[reason] = (diagnostics[reason] || 0) + 1; };
  function safe(file) { return roots.some((root) => inside(path.resolve(file), root)); }
  function metadata(file, files) {
    if (!safe(file)) throw new Error('unsafe_path');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !safe(fs.realpathSync(file))) throw new Error('unsafe_metadata');
    if (stat.size > limits.fileBytes || bytes + stat.size > limits.totalBytes) throw new Error('probe_budget_exceeded');
    const before = signature(file); const value = fs.readFileSync(file, 'utf8'); bytes += stat.size;
    if (signature(file) !== before) throw new Error('metadata_changed');
    files.push([file, before]); return value;
  }
  function configRemotes(text, remotes) {
    let section = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim(); if (!line || /^[#;]/.test(line)) continue;
      if (/^\[(?:include(?:if)?|url)\b/i.test(line) || /\\$/.test(line)) throw new Error('unsupported_git_metadata');
      if (line.startsWith('[')) {
        if (!/^\[[a-zA-Z][\w.-]*(?:\s+"[^"\\]*")?\]\s*(?:[#;].*)?$/.test(line)) throw new Error('unsupported_git_metadata');
        const match = line.match(/^\[remote\s+"([^"\r\n]+)"\]\s*(?:[#;].*)?$/i); if (/^\[remote\b/i.test(line) && !match) throw new Error('unsupported_git_metadata'); section = match ? match[1] : null; continue;
      }
      if (!section) continue;
      const match = line.match(/^url\s*=\s*(.*?)\s*$/i); if (!match) continue;
      let value = match[1];
      if (value.startsWith('"')) { if (!/^"[^"\\]*"$/.test(value)) throw new Error('unsupported_git_metadata'); value = value.slice(1, -1); }
      else value = value.replace(/\s+[#;].*$/, '');
      if (!canonicalRemote(value)) throw new Error('unsupported_git_metadata');
      if (!remotes.has(section)) remotes.set(section, []); remotes.get(section).push(value);
    }
  }
  function probe(value, kind) {
    if (/redacted|masked|\[filtered\]|[*?<>]/i.test(value)) return failure('redacted_or_expanding_path');
    if (!path.isAbsolute(value) || value.startsWith('//') || /[\x00-\x1f]/.test(value) || Buffer.byteLength(value) > limits.pathBytes || TRUNCATED.test(value)) return failure(TRUNCATED.test(value) ? 'truncated_path' : 'unsafe_path');
    if (!safe(value)) return failure('outside_approved_roots');
    const cacheKey = kind + '\0' + value; const cached = cache.get(cacheKey);
    if (cached && cached.files.every(([file, stamp]) => signature(file) === stamp)) return cached.result;
    if (!cache.has(cacheKey) && cache.size >= limits.candidates) return failure('probe_budget_exceeded');
    probes++; const files = []; let result;
    try {
      let directory = value;
      try { if (!fs.statSync(directory).isDirectory()) directory = path.dirname(directory); }
      catch { if (!kind.endsWith('file') && kind !== 'file') throw new Error('missing_path'); directory = path.dirname(value); if (!fs.statSync(directory).isDirectory()) throw new Error('missing_path'); }
      directory = fs.realpathSync(directory); if (!safe(directory)) throw new Error('unsafe_path');
      for (let depth = 0; depth < limits.ancestors && safe(directory); depth++) {
        const marker = path.join(directory, '.git');
        if (fs.existsSync(marker)) {
          const stat = fs.lstatSync(marker); if (stat.isSymbolicLink()) throw new Error('unsafe_metadata');
          let gitDir = marker;
          if (stat.isFile()) { const pointer = metadata(marker, files).trim().match(/^gitdir:\s*(.+)$/); if (!pointer) throw new Error('unsupported_git_metadata'); gitDir = path.resolve(directory, pointer[1]); }
          if (!safe(gitDir) || !safe(fs.realpathSync(gitDir))) throw new Error('unsafe_metadata');
          let common = gitDir; const commonFile = path.join(gitDir, 'commondir');
          files.push([commonFile, signature(commonFile)]);
          if (fs.existsSync(commonFile)) common = path.resolve(gitDir, metadata(commonFile, files).trim());
          if (!safe(common) || !safe(fs.realpathSync(common))) throw new Error('unsafe_metadata');
          const remotes = new Map(); configRemotes(metadata(path.join(common, 'config'), files), remotes);
          const worktreeConfig = path.join(gitDir, 'config.worktree'); files.push([worktreeConfig, signature(worktreeConfig)]); if (fs.existsSync(worktreeConfig)) configRemotes(metadata(worktreeConfig, files), remotes);
          const name = remotes.has('origin') ? 'origin' : [...remotes.keys()].sort()[0];
          if (!name) throw new Error('remote_missing');
          const urls = remotes.get(name); if (new Set(urls.map(canonicalRemote)).size !== 1) throw new Error('conflicting_path_remotes');
          result = { descriptor: { ...projectFromRemote(urls[0]), identitySource: 'path_remote_current' }, reason: null }; break;
        }
        const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
      }
      if (!result) result = failure('repository_missing');
    } catch (error) { result = failure(['ENOENT', 'ENOTDIR'].includes(error.code) ? 'missing_path' : error.message); }
    cache.set(cacheKey, { result, files }); return result;
  }
  return {
    resolve(record) {
      const candidates = pathCandidates(record); if (!candidates.length) return failure('no_path_evidence');
      if (!enabled || !roots.length) return failure('path_probe_disabled');
      const foreign = provenanceReason(record, options); if (foreign) { count(foreign); return failure(foreign); }
      if (candidates.length > limits.pathsPerRow) { count('probe_budget_exceeded'); return failure('probe_budget_exceeded'); }
      const directories = candidates.filter((candidate) => candidate.kind === 'directory' && path.isAbsolute(candidate.value));
      const results = candidates.map((candidate) => {
        let value = candidate.value;
        if (!path.isAbsolute(value) && candidate.kind === 'file' && directories.length === 1) { value = path.resolve(directories[0].value, value); if (!inside(value, path.resolve(directories[0].value))) return failure('unsafe_path'); }
        return probe(value, candidate.kind);
      });
      const failed = results.find((result) => result.reason && result.reason !== 'remote_missing' && result.reason !== 'repository_missing' && result.reason !== 'missing_path');
      if (failed) { count(failed.reason); return failed; }
      const descriptors = results.map((result) => result.descriptor).filter(Boolean);
      if (new Set(descriptors.map((descriptor) => descriptor.projectKey)).size > 1) { count('conflicting_paths'); return failure('conflicting_paths'); }
      if (descriptors.length) return { descriptor: descriptors[0], reason: null };
      const reason = results[0]?.reason || 'no_path_evidence'; count(reason); return failure(reason);
    },
    report: () => ({ probes, cachedCandidates: cache.size, metadataBytes: bytes, reasons: { ...diagnostics } }),
  };
}
// Only server/operator configuration may attest a local source. HTTP-selected roots
// and hosted tenants never acquire this policy from a path supplied by a client.
function localRuntimeEvidenceOptions({ feedbackDir, sourceRoot, hosted, homeDir = require('node:os').homedir() } = {}) {
  if (hosted || !feedbackDir || !sourceRoot || path.resolve(feedbackDir) !== path.resolve(sourceRoot)) return {};
  return { localPathEvidence: { trustedLocalSource: true, allowedRoots: [path.join(homeDir, 'workspace'), path.join(homeDir, '.herdr', 'worktrees')] } };
}
module.exports = { localRuntimeEvidenceOptions, pathCandidates, literalCommandPaths, provenanceReason, createPathEvidence };
