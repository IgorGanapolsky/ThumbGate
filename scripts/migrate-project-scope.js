#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { projectForRecord, resolveProjectEvidence, isGeneratedGate } = require('./project-identity');
const { SIGNAL_FILES, signalPaths, accountDirectories, accountAttribution, attributionForFile } = require('./project-catalog');

function digest(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n)); } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function fingerprint(file) {
  const stat = fs.statSync(file, { bigint: true });
  return { ino: String(stat.ino), size: String(stat.size), mtime: String(stat.mtimeNs), checksum: digest(file) };
}
function sameFingerprint(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function *lines(file) {
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  const decoder = new (require('node:string_decoder').StringDecoder)('utf8');
  let pending = '';
  try {
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      pending += decoder.write(buffer.subarray(0, n));
      let end;
      while ((end = pending.indexOf('\n')) !== -1) { yield pending.slice(0, end + 1); pending = pending.slice(end + 1); }
    }
    pending += decoder.end();
    if (pending) yield pending;
  } finally { fs.closeSync(fd); }
}
function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
function copyDatabaseForInspection(file) {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'thumbgate-migration-'));
  fs.chmodSync(directory, 0o700);
  const files = [file, file + '-wal', file + '-shm'].filter((candidate) => fs.existsSync(candidate));
  const before = files.map((candidate) => fingerprint(candidate));
  try {
    for (const source of files) {
      const target = path.join(directory, path.basename(source));
      fs.copyFileSync(source, target);
      fs.chmodSync(target, 0o600);
    }
    const current = [file, file + '-wal', file + '-shm'].filter((candidate) => fs.existsSync(candidate));
    if (JSON.stringify(current) !== JSON.stringify(files) || files.some((candidate, i) => !sameFingerprint(before[i], fingerprint(candidate)))) throw new Error('Database changed during inspection');
    return { file: path.join(directory, path.basename(file)), cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
  } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
}
function migrateAccount(root, options, counts) {
  const attribution = accountAttribution(root, options);
  const manifestPath = path.join(root, 'project-scope-migration.json');
  let manifest = { version: 1, files: {}, databases: {} };
  if (fs.existsSync(manifestPath)) manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const save = () => atomicJson(manifestPath, manifest);
  const replace = (file, render) => {
    counts.files++;
    const relative = path.relative(root, file);
    const previous = manifest.files[relative];
    const original = fingerprint(file);
    if (previous) {
      if (previous.replacementChecksum === original.checksum) { counts.skipped++; return; }
      if (!sameFingerprint(previous.original, original)) throw new Error('Migration source changed; refusing replacement');
    }
    if (!options.apply) { render(null); return; }
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    const backup = previous?.backup || `${file}.project-scope-${crypto.randomUUID()}.bak`;
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { render(fd); fs.fsyncSync(fd); } catch (error) { fs.closeSync(fd); fs.unlinkSync(temporary); throw error; }
    fs.closeSync(fd);
    try {
      options.beforeReplace?.(file);
      if (!sameFingerprint(original, fingerprint(file))) throw new Error('Concurrent source modification; migration stopped');
      if (!previous) {
        fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
        const backupFd = fs.openSync(backup, 'r'); try { fs.fsyncSync(backupFd); } finally { fs.closeSync(backupFd); }
      }
      manifest.files[relative] = { original, backup, replacementChecksum: digest(temporary), complete: false };
      save();
      if (!sameFingerprint(original, fingerprint(file))) throw new Error('Concurrent source modification; migration stopped');
      fs.renameSync(temporary, file);
      const directory = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      manifest.files[relative].complete = true;
      save();
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  };
  for (const filename of SIGNAL_FILES) {
    for (const file of signalPaths(root, filename)) {
      replace(file, (fd) => {
        for (const line of lines(file)) {
          let output = line;
          try {
            const row = JSON.parse(line);
            if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Not a record');
            counts.rows++;
            const result = resolveProjectEvidence(row, attributionForFile(attribution, file));
            const project = result.descriptor;
            counts.evidence[result.evidence] = (counts.evidence[result.evidence] || 0) + 1;
            if (result.reason) counts.reasons[result.reason] = (counts.reasons[result.reason] || 0) + 1;
            if (result.anchorEvidence) counts.anchorEvidence[result.anchorEvidence] = (counts.anchorEvidence[result.anchorEvidence] || 0) + 1;
            if (project.projectKey === 'unassigned') { counts.unassigned++; counts.unassignedReasons[result.reason] = (counts.unassignedReasons[result.reason] || 0) + 1; }
            else { counts.attributed++; if (project.projectKey.startsWith('legacy_')) counts.legacyAttributed++; else if (project.projectKey.startsWith('repo_')) counts.canonicalAttributed++; else counts.localAttributed++; }
            const newline = line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : '';
            output = JSON.stringify({ ...row, ...project }) + newline;
          } catch { if (line.trim()) counts.malformed++; }
          if (fd !== null) fs.writeSync(fd, output);
        }
      });
    }
  }
  for (const dir of accountDirectories(root)) {
    for (const name of ['auto-promoted-gates.json', 'custom-gates.json', 'dashboard-review-state.json']) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Symlink migration file refused');
      replace(file, (fd) => {
        const original = JSON.parse(fs.readFileSync(file, 'utf8'));
        let updated;
        if (name === 'dashboard-review-state.json') updated = original.version === 2 ? original : { version: 2, byProject: { all: original } };
        else {
          const items = (Array.isArray(original) ? original : original.gates || []).map((item) => {
            if (item.scope === 'global' && !isGeneratedGate(item)) return item;
            const generated = name === 'auto-promoted-gates.json' || isGeneratedGate(item);
            if (!generated && !item.projectKey) return { ...item, scope: 'global' };
            const descriptor = projectForRecord(item, attributionForFile(attribution, file));
            return { ...item, ...descriptor, scope: 'project', ...(descriptor.projectKey === 'unassigned' ? { active: false } : {}) };
          });
          updated = Array.isArray(original) ? items : { ...original, gates: items };
        }
        if (fd !== null) fs.writeSync(fd, JSON.stringify(updated, null, 2) + '\n');
      });
    }
    const file = path.join(dir, 'lessons.sqlite');
    if (!fs.existsSync(file)) continue;
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Symlink database refused');
    const Database = require('better-sqlite3');
    const inspection = options.apply ? null : copyDatabaseForInspection(file);
    let db;
    try { db = new Database(inspection?.file || file, { readonly: !options.apply, fileMustExist: true }); } catch (error) { inspection?.cleanup(); throw error; }
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lessons'").get()) { counts.uninitializedDatabases++; continue; }
      const rows = db.prepare('SELECT * FROM lessons').all();
      counts.dbRows += rows.length;
      if (options.apply) {
        options.beforeDatabase?.();
        db.transaction(() => {
          require('./lesson-db').upgradeProjectColumns(db);
          options.afterDatabaseSchema?.(db);
          const update = db.prepare('UPDATE lessons SET projectKey = ?, projectName = ? WHERE id = ?');
          for (const row of rows) {
            // A newly added default is not historical evidence.
            const recorded = row.projectKey === 'unassigned' ? { ...row, projectKey: undefined } : row;
            const project = projectForRecord(recorded, attributionForFile(attribution, file));
            update.run(project.projectKey, project.projectName, row.id);
            options.afterDatabaseRow?.(db, row);
          }
        }).immediate();
        manifest.databases[path.relative(root, file)] = { complete: true, rows: rows.length };
        save();
      }
    } finally { db.close(); inspection?.cleanup(); }
  }
  const report = attribution.pathEvidence.report();
  for (const key of ['probes', 'cachedCandidates', 'metadataBytes']) counts.pathProbe[key] += report[key];
}
function migrateProjectScope(root, options = {}) {
  const counts = { files: 0, rows: 0, attributed: 0, unassigned: 0, malformed: 0, dbRows: 0, skipped: 0, uninitializedDatabases: 0, canonicalAttributed: 0, legacyAttributed: 0, localAttributed: 0, evidence: {}, reasons: {}, unassignedReasons: {}, anchorEvidence: {}, pathProbe: { probes: 0, cachedCandidates: 0, metadataBytes: 0 } };
  if (!root || !fs.existsSync(root)) return counts;
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Symlink account root refused');
  if (options.apply && !options.offline) throw new Error('Apply requires offline: true after stopping all writers');
  const lockPath = path.join(root, '.project-scope-migration.lock');
  let lock;
  if (options.apply) { lock = fs.openSync(lockPath, 'wx', 0o600); fs.writeFileSync(lock, String(process.pid)); }
  try {
  migrateAccount(path.resolve(root), options, counts);
  const tenants = path.join(root, 'tenants');
  if (fs.existsSync(tenants)) {
    if (fs.lstatSync(tenants).isSymbolicLink()) throw new Error('Symlink tenant directory refused');
    for (const tenant of fs.readdirSync(tenants, { withFileTypes: true })) {
      if (tenant.isSymbolicLink()) throw new Error('Symlink tenant refused');
      if (tenant.isDirectory()) migrateAccount(path.join(tenants, tenant.name), { ...options, localPathEvidence: undefined }, counts);
    }
  }
  return counts;
  } finally { if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(lockPath); } }
}
module.exports = { migrateProjectScope, fingerprint };
if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--feedback-dir');
  if (rootIndex === -1 || !args[rootIndex + 1]) { console.error('Usage: migrate-project-scope --feedback-dir <account-root> [--apply --offline]'); process.exitCode = 1; }
  else {
    try { console.log(JSON.stringify(migrateProjectScope(args[rootIndex + 1], { apply: args.includes('--apply'), offline: args.includes('--offline') }))); }
    catch { console.error('Project migration failed. Source files and backup manifest are preserved.'); process.exitCode = 1; }
  }
}
