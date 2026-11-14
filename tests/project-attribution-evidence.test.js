'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const identity = require('../scripts/project-identity');
const catalog = require('../scripts/project-catalog');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const account = path.join(root, 'account'); const repos = path.join(root, 'repos');
  fs.mkdirSync(account); fs.mkdirSync(repos);
  return { root, account, repos, options: { localPathEvidence: { trustedLocalSource: true, allowedRoots: [repos] } } };
}
function write(root, name, rows) { fs.writeFileSync(path.join(root, name), rows.map(JSON.stringify).join('\n') + '\n'); }
function repo(root, name, remote) { const dir = path.join(root, name); fs.mkdirSync(dir); childProcess.execFileSync('git', ['-C', dir, 'init'], { stdio: 'ignore' }); childProcess.execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote], { stdio: 'ignore' }); return dir; }
test('typed registry references recover recorded legacy identity without guessing a repository', (t) => {
  const f = fixture(t);
  write(f.account, 'agent-registry.jsonl', [{ id: 'agent_1_aaaaaaaa', project: 'recorded-project', registeredAt: '2020-01-01' }]);
  write(f.account, 'audit-trail.jsonl', [{ id: 'event', agentId: 'agent_1_aaaaaaaa', timestamp: '2026-01-01' }]);
  write(f.account, 'observed-agents.jsonl', [{ id: 'agent_1_aaaaaaaa', seenAt: '2026-01-01' }]);
  write(f.account, 'feedback-log.jsonl', [{ id: 'feedback', agentId: 'agent_1_aaaaaaaa' }]);
  write(f.account, 'memory-log.jsonl', [{ id: 'memory', sourceFeedbackId: 'feedback' }]);
  const key = 'legacy_' + identity.hash('recorded-project');
  for (const file of ['agent-registry.jsonl', 'audit-trail.jsonl', 'observed-agents.jsonl', 'feedback-log.jsonl', 'memory-log.jsonl']) assert.equal(catalog.readProjectRows(f.account, file)[0].projectKey, key, file);
  write(f.account, 'agent-registry.jsonl', [{ id: 'agent_1_aaaaaaaa', project: 'first' }, { id: 'agent_1_aaaaaaaa', project: 'second' }]);
  assert.equal(catalog.readProjectRows(f.account, 'observed-agents.jsonl')[0].projectKey, 'unassigned');
});
test('generated gates use separate lesson and feedback source namespaces', (t) => {
  const f = fixture(t); const a = identity.projectFromRemote('https://github.com/a/repo'); const b = identity.projectFromRemote('https://github.com/b/repo');
  write(f.account, 'feedback-log.jsonl', [{ id: 'shared', ...a }]); write(f.account, 'memory-log.jsonl', [{ id: 'shared', ...b }]);
  fs.writeFileSync(path.join(f.account, 'custom-gates.json'), JSON.stringify({ gates: [{ id: 'lesson-rule', generated: true, sourceLessonId: 'shared' }, { id: 'feedback-rule', generated: true, sourceFeedbackId: 'shared' }] }));
  const gates = catalog.readProjectGates(f.account);
  assert.equal(gates.find((g) => g.id === 'lesson-rule').projectKey, b.projectKey);
  assert.equal(gates.find((g) => g.id === 'feedback-rule').projectKey, a.projectKey);
});
test('all recorded remotes are compared and ambiguous aliases retain explicit legacy identity', () => {
  const a = identity.projectFromRemote('https://github.com/a/repo'); const b = identity.projectFromRemote('https://github.com/b/repo');
  assert.equal(identity.projectForRecord({ remoteUrl: 'https://github.com/a/repo', metadata: { remoteUrl: 'https://github.com/b/repo' } }).projectKey, 'unassigned');
  const aliases = identity.buildAliases([{ ...a, scope: { projectId: 'same' } }, { ...b, scope: { projectId: 'same' } }]);
  const result = identity.resolveProjectEvidence({ scope: { projectId: 'same' } }, { aliases });
  assert.equal(result.descriptor.projectKey, 'legacy_' + identity.hash('same')); assert.equal(result.reason, 'ambiguous_alias');
  assert.equal(identity.projectForRecord({ projectKey: 'legacy_' + identity.hash('stable'), remoteUrl: 'https://github.com/a/repo' }).projectKey, 'legacy_' + identity.hash('stable'));
  assert.equal(identity.projectForRecord({ projectKey: 'unassigned', remoteUrl: 'https://github.com/a/repo' }).projectKey, a.projectKey);
});
test('trusted local structured and literal command paths resolve through fixed Git metadata without processes', (t) => {
  const f = fixture(t); const remote = 'https://github.com/account/evidence'; const repository = repo(f.repos, 'arbitrary-folder', remote); fs.mkdirSync(path.join(repository, 'nested'));
  write(f.account, 'feedback-log.jsonl', [
    { id: 'cwd', cwd: path.join(repository, 'nested') },
    { id: 'file', toolInput: { tool_input: { file_path: path.join(repository, 'missing.js') } } },
    { id: 'command', toolInput: { command: 'git -C "' + repository + '" status' } },
    { id: 'scope', scope: { projectId: repository } },
  ]);
  t.mock.method(childProcess, 'execFileSync', () => { throw new Error('Probe must not execute processes'); });
  t.mock.method(childProcess, 'spawnSync', () => { throw new Error('Probe must not execute processes'); });
  const rows = catalog.readProjectRows(f.account, 'feedback-log.jsonl', f.options);
  assert(rows.every((row) => row.projectKey === identity.projectFromRemote(remote).projectKey));
  assert(rows.every((row) => row.identitySource === 'path_remote_current'));
  assert(catalog.readProjectRows(f.account, 'feedback-log.jsonl').every((row) => !row.projectKey.startsWith('repo_')));
});
test('truncated, foreign, unsafe and conflicting path evidence cannot be assigned', (t) => {
  const f = fixture(t); const a = repo(f.repos, 'a', 'https://github.com/account/a'); const b = repo(f.repos, 'b', 'https://github.com/account/b');
  write(f.account, 'feedback-log.jsonl', [
    { id: 'truncated', toolInput: { file_path: a + '/...' } },
    { id: 'foreign', cwd: a, importedFrom: 'remote-machine' },
    { id: 'conflict', cwd: a, toolInput: { file_path: b + '/missing.js' } },
    { id: 'command-code', toolInput: { command: 'echo "' + a + '"' } },
  ]);
  assert(catalog.readProjectRows(f.account, 'feedback-log.jsonl', f.options).every((row) => row.projectKey === 'unassigned'));
});
test('dry-run reports evidence and reasons without altering the frozen source', (t) => {
  const f = fixture(t); write(f.account, 'agent-registry.jsonl', [{ id: 'agent', project: 'known' }]); write(f.account, 'observed-agents.jsonl', [{ id: 'agent' }, { id: 'unknown' }]);
  const files = fs.readdirSync(f.account); const before = files.map((name) => fs.readFileSync(path.join(f.account, name)));
  const counts = require('../scripts/migrate-project-scope').migrateProjectScope(f.account);
  assert.equal(counts.rows, 3); assert.equal(counts.attributed, 2); assert.equal(counts.unassigned, 1);
  assert.equal(counts.evidence.registry_legacy_project, 1); assert.equal(counts.evidence.agent_registry_reference, 1); assert.equal(counts.evidence.unassigned, 1);
  assert.deepEqual(fs.readdirSync(f.account), files); files.forEach((name, index) => assert.deepEqual(fs.readFileSync(path.join(f.account, name)), before[index]));
});
test('verified row targets override registry labels and conflict with canonical registration', (t) => {
  const f = fixture(t); const a = identity.projectFromRemote('https://github.com/account/a'); const b = repo(f.repos, 'b', 'https://github.com/account/b');
  write(f.account, 'agent-registry.jsonl', [{ id: 'agent', project: 'a-label' }]);
  write(f.account, 'audit-trail.jsonl', [{ id: 'call', agentId: 'agent', toolInput: { repoPath: b } }]);
  assert.equal(catalog.readProjectRows(f.account, 'audit-trail.jsonl', f.options)[0].projectKey, identity.projectFromRemote('https://github.com/account/b').projectKey);
  write(f.account, 'agent-registry.jsonl', [{ id: 'agent', ...a }]);
  assert.equal(catalog.readProjectRows(f.account, 'audit-trail.jsonl', f.options)[0].projectKey, 'unassigned');
  write(f.account, 'audit-trail.jsonl', [{ id: 'call', ...a, agentId: 'agent', toolInput: { repoPath: b } }]);
  assert.equal(catalog.readProjectRows(f.account, 'audit-trail.jsonl', f.options)[0].projectKey, a.projectKey);
});
test('command search patterns, option values and redacted leaves never become paths', (t) => {
  const f = fixture(t); const a = repo(f.repos, 'a', 'https://github.com/account/a');
  const { literalCommandPaths } = require('../scripts/project-evidence');
  for (const command of [`rg '${a}' /tmp/log`, `grep '${a}' /tmp/log`, `sed '${a}' /tmp/log`, `find /tmp -name '${a}'`, `ls -I '${a}/missing'`, `git commit -m -C '${a}'`, `git -- -C '${a}'`, `git -C '${a}' -C '/tmp' status`]) assert.deepEqual(literalCommandPaths(command), [], command.split(' ')[0]);
  assert.equal(literalCommandPaths(`cat -n '${a}/file'`)[0].value, a + '/file');
  write(f.account, 'feedback-log.jsonl', [{ id: 'redacted', toolInput: { file_path: a + '/[REDACTED]' } }, { id: 'truncated', toolInput: { file_path: a + '/' + 'x'.repeat(200) + '...' } }]);
  assert(catalog.readProjectRows(f.account, 'feedback-log.jsonl', f.options).every((row) => row.projectKey === 'unassigned'));
});
test('conflicting duplicate source IDs remain ambiguous regardless of record order', (t) => {
  const f = fixture(t); const a = identity.projectFromRemote('https://github.com/account/a');
  const good = { id: 'same', ...a }; const conflicting = { id: 'same', remoteUrl: 'https://github.com/account/a', metadata: { remoteUrl: 'https://github.com/account/b' } };
  write(f.account, 'memory-log.jsonl', [{ id: 'lesson', sourceFeedbackId: 'same' }]);
  for (const rows of [[good, conflicting], [conflicting, good]]) { write(f.account, 'feedback-log.jsonl', rows); assert.equal(catalog.readProjectRows(f.account, 'memory-log.jsonl')[0].projectKey, 'unassigned'); }
});
test('sessions require consistent machine provenance, namespace and bounded anchor times', (t) => {
  const f = fixture(t); const a = identity.projectFromRemote('https://github.com/account/a'); const b = identity.projectFromRemote('https://github.com/account/b');
  const common = { sessionId: 'exact-session', source: 'hook' }; const stamp = (hour) => `2026-01-01T0${hour}:00:00Z`;
  write(f.account, 'feedback-log.jsonl', [
    { id: 'start', ...common, ...a, timestamp: stamp(1), metadata: { machineId: 'one' } },
    { id: 'end', ...common, ...a, timestamp: stamp(3), metadata: { machineId: 'one' } },
    { id: 'inside', ...common, timestamp: stamp(2), metadata: { machineId: 'one' } },
    { id: 'foreign', ...common, timestamp: stamp(2), provenance: { machineId: 'two' } },
    { id: 'imported', ...common, timestamp: stamp(2), metadata: { machineId: 'one', importedFrom: 'other' } },
    { id: 'missing-machine', ...common, timestamp: stamp(2) },
    { id: 'outside', ...common, timestamp: stamp(4), metadata: { machineId: 'one' } },
  ]);
  let rows = catalog.readProjectRows(f.account, 'feedback-log.jsonl');
  assert.equal(rows.find((row) => row.id === 'inside').projectKey, a.projectKey);
  for (const id of ['foreign', 'imported', 'missing-machine', 'outside']) assert.equal(rows.find((row) => row.id === id).projectKey, 'unassigned', id);
  fs.appendFileSync(path.join(f.account, 'feedback-log.jsonl'), JSON.stringify({ id: 'conflict', ...common, ...b, timestamp: stamp(2), metadata: { machineId: 'one' } }) + '\n');
  rows = catalog.readProjectRows(f.account, 'feedback-log.jsonl'); assert.equal(rows.find((row) => row.id === 'inside').projectKey, 'unassigned');
});
test('worktrees and independent clones resolve fixed metadata with bounded cache invalidation', (t) => {
  const f = fixture(t); const remote = 'https://github.com/account/worktree'; const a = repo(f.repos, 'a', remote); const clone = repo(f.repos, 'clone', remote);
  childProcess.execFileSync('git', ['-C', a, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture'], { stdio: 'ignore' });
  const worktree = path.join(f.repos, 'worktree'); childProcess.execFileSync('git', ['-C', a, 'worktree', 'add', '-b', 'fixture', worktree], { stdio: 'ignore' });
  const probe = require('../scripts/project-evidence').createPathEvidence(f.options.localPathEvidence);
  const first = probe.resolve({ cwd: a }).descriptor;
  assert.equal(probe.resolve({ cwd: worktree }).descriptor.projectKey, first.projectKey); assert.equal(probe.resolve({ cwd: clone }).descriptor.projectKey, first.projectKey);
  const count = probe.report().probes; probe.resolve({ cwd: a }); assert.equal(probe.report().probes, count);
  fs.writeFileSync(path.join(a, '.git', 'config'), '[remote "origin"]\nurl = https://github.com/account/changed\n');
  assert.notEqual(probe.resolve({ cwd: a }).descriptor.projectKey, first.projectKey);
  const originalRead = fs.readFileSync; t.mock.method(fs, 'readFileSync', function(file, ...args) { assert(['config', 'commondir', '.git', 'config.worktree'].includes(path.basename(String(file)))); return originalRead.call(this, file, ...args); });
  assert(probe.resolve({ cwd: clone }).descriptor);
});
test('metadata includes, symlink escapes, foreign machines and budgets fail without source reads', (t) => {
  const f = fixture(t); const a = repo(f.repos, 'a', 'https://github.com/account/a'); const evidence = require('../scripts/project-evidence');
  let probe = evidence.createPathEvidence(f.options.localPathEvidence);
  assert.equal(probe.resolve({ cwd: a, metadata: { machineId: 'foreign' } }).reason, 'foreign_machine');
  assert.equal(probe.report().probes, 0);
  const disabled = evidence.createPathEvidence(); assert.equal(disabled.resolve({ cwd: a }).reason, 'path_probe_disabled'); assert.equal(disabled.report().probes, 0);
  fs.appendFileSync(path.join(a, '.git', 'config'), '[include]\npath = /must-not-read\n');
  assert.equal(probe.resolve({ cwd: a }).reason, 'unsupported_git_metadata');
  fs.writeFileSync(path.join(a, '.git', 'config'), '[remote "origin"]\nurl=https://github.com/account/a\n');
  probe = evidence.createPathEvidence({ ...f.options.localPathEvidence, limits: { fileBytes: 1 } }); assert.equal(probe.resolve({ cwd: a }).reason, 'probe_budget_exceeded');
  probe = evidence.createPathEvidence({ ...f.options.localPathEvidence, limits: { pathsPerRow: 1 } }); assert.equal(probe.resolve({ cwd: a, filePaths: [a + '/missing'] }).reason, 'probe_budget_exceeded');
  fs.symlinkSync(f.account, path.join(f.repos, 'escape')); probe = evidence.createPathEvidence(f.options.localPathEvidence); assert.equal(probe.resolve({ cwd: path.join(f.repos, 'escape') }).reason, 'unsafe_path');
  assert.equal(probe.resolve({ cwd: f.account }).reason, 'outside_approved_roots');
});
test('runtime local evidence policy cannot be acquired by hosted or alternate account roots', (t) => {
  const f = fixture(t); const resolve = require('../scripts/project-evidence').localRuntimeEvidenceOptions;
  assert(resolve({ feedbackDir: f.account, sourceRoot: f.account, homeDir: f.root }).localPathEvidence.trustedLocalSource);
  assert.deepEqual(resolve({ feedbackDir: f.account, sourceRoot: f.account, hosted: true, homeDir: f.root }), {});
  assert.deepEqual(resolve({ feedbackDir: f.repos, sourceRoot: f.account, homeDir: f.root }), {});
});

test('a recorded legacy scope remains its primary evidence when a session repeats that identity', (t) => {
  const f = fixture(t); write(f.account, 'feedback-log.jsonl', [{ id: 'self', scope: { projectId: 'known' }, source: 'hook', sessionId: 'stable-session', timestamp: '2026-01-01T00:00:00Z' }]);
  const counts = require('../scripts/migrate-project-scope').migrateProjectScope(f.account, f.options);
  assert.equal(counts.evidence.legacy_scope, 1); assert.equal(counts.evidence.session_anchor || 0, 0);
});

test('local source attestation never propagates into hosted tenant descendants', (t) => {
  const f = fixture(t); const a = repo(f.repos, 'a', 'https://github.com/account/a');
  const tenant = path.join(f.account, 'tenants', 'customer'); fs.mkdirSync(tenant, { recursive: true });
  write(f.account, 'feedback-log.jsonl', [{ id: 'local', cwd: a }]); write(tenant, 'feedback-log.jsonl', [{ id: 'hosted', cwd: a }]);
  const counts = require('../scripts/migrate-project-scope').migrateProjectScope(f.account, f.options);
  assert.equal(counts.rows, 2); assert.equal(counts.canonicalAttributed, 1); assert.equal(counts.unassignedReasons.path_probe_disabled, 1);
});

test('canonical scope mapping and canonical registry references must agree without a path', () => {
  const a = identity.projectFromRemote('https://github.com/account/a'); const b = identity.projectFromRemote('https://github.com/account/b');
  const result = identity.resolveProjectEvidence({ scope: { projectId: 'alias' }, agentId: 'agent' }, { aliases: new Map([['alias', a]]), registryById: new Map([['agent', b]]) });
  assert.equal(result.descriptor.projectKey, 'unassigned'); assert.equal(result.reason, 'conflicting_references');
});
