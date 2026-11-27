'use strict';

// Cloud agents (claude.ai projects, cloud Claude Code, Codex, Cursor background agents) never run ThumbGate hooks, so
// `thumbgate export-rules` writes the learned rules into files they read from the repo. These tests pin what goes into
// those files, what stays out, and that the file only changes when a rule changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ex = require('../scripts/cloud-rules-export');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const DAY = 24 * 60 * 60 * 1000;
// Built at runtime so the repo's secret scanners don't flag a fixture as a real token.
const FAKE_TOKEN = ['gh', 'p_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cloud-rules-'));
  const feedbackDir = path.join(root, 'fb');
  const cwd = path.join(root, 'repo');
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  const future = new Date(Date.now() + 30 * DAY).toISOString();
  const past = new Date(Date.now() - DAY).toISOString();
  fs.writeFileSync(path.join(feedbackDir, 'auto-promoted-gates.json'), JSON.stringify({
    version: 1,
    gates: [
      { id: 'rm-rf', active: true, action: 'block', pattern: 'rm\\s+-rf\\s+/', message: 'Auto-promoted repeated executable action: "rm -rf /" (3 occurrences in 30 days)', expiresAt: future },
      { id: 'npm-publish', active: true, action: 'warn', pattern: 'npm\\s+publish', message: 'Ask before publishing', expiresAt: null },
      { id: 'expired', active: true, action: 'block', pattern: 'old-thing', message: 'expired gate', expiresAt: past },
      { id: 'off', active: false, action: 'block', pattern: 'disabled-thing', message: 'inactive gate' },
      { id: 'other-repo', active: true, scope: 'project', projectKey: 'repo_' + 'a'.repeat(64), action: 'block', pattern: 'other-repo-thing', message: 'learned in another repo' },
    ],
  }));
  fs.writeFileSync(path.join(feedbackDir, 'claim-gate-rules.json'), JSON.stringify({
    version: 1,
    rules: [{ id: 'claim-host', key: 'class:host', pattern: 'x', message: `A host claim needs a check this turn. Mail ops@example.com, token ${FAKE_TOKEN}` }],
    evidence: {},
  }));
  fs.writeFileSync(path.join(feedbackDir, 'prevention-rules.md'), [
    '# Prevention Rules', '', '## git-workflow', '- Recurrence count: 3 (weighted: 2.4)', '- Rule: never force push main',
    '- Latest mistake: MISTAKE: pushed from /Users/someone/secret-project', '',
  ].join('\n'));
  fs.writeFileSync(path.join(feedbackDir, 'memory-log.jsonl'), `${JSON.stringify({ id: 'm1', category: 'error', signal: 'negative', context: 'private lesson prose about the customer deal', timestamp: new Date().toISOString() })}\n`);
  return { root, feedbackDir, cwd };
}

test('export writes live learned gates, claim rules and rules to .claude/rules/thumbgate.md', () => {
  const { feedbackDir, cwd } = fixture();
  const result = ex.exportRules({ cwd, feedbackDir });
  const file = path.join(cwd, '.claude', 'rules', 'thumbgate.md');
  assert.equal(result.files[0].path, file);
  assert.equal(result.files[0].changed, true);
  const md = fs.readFileSync(file, 'utf8');
  assert.ok(md.startsWith(ex.MARKER));
  assert.match(md, /## Blocked: do not run\n\n- `rm\\s\+-rf\\s\+\/`/);
  assert.match(md, /## Ask the user first\n\n- `npm\\s\+publish`.*Ask before publishing/);
  assert.match(md, /A host claim needs a check this turn/);
  assert.match(md, /- never force push main \(git-workflow\)/);
  assert.doesNotMatch(md, /old-thing|disabled-thing/, 'expired and inactive gates stay out');
  assert.doesNotMatch(md, /other-repo-thing|another repo/, "another project's gates stay out");
  assert.doesNotMatch(md, /occurrences in 30 days/, 'fire counts stay out so the file is stable');
  assert.doesNotMatch(md, /Recurrence count|weighted/);
  assert.deepEqual(result.counts, { gates: 2, claims: 1, prevention: 1, lessons: 0 });
});

test('secrets, emails and home paths are redacted; lesson prose stays out unless asked for', () => {
  const { feedbackDir, cwd } = fixture();
  ex.exportRules({ cwd, feedbackDir });
  const md = fs.readFileSync(path.join(cwd, '.claude', 'rules', 'thumbgate.md'), 'utf8');
  assert.doesNotMatch(md, /ghp_[A-Za-z0-9]{30}/);
  assert.doesNotMatch(md, /ops@example\.com/);
  assert.doesNotMatch(md, /\/Users\/someone/);
  assert.doesNotMatch(md, /customer deal/);
  const withLessons = ex.renderMarkdown(ex.collectRules({ feedbackDir, cwd, includeLessons: true }));
  assert.match(withLessons, /## Recent lessons/);
});

test('output is deterministic: a second export changes nothing and --check passes', () => {
  const { feedbackDir, cwd } = fixture();
  ex.exportRules({ cwd, feedbackDir });
  const again = ex.exportRules({ cwd, feedbackDir });
  assert.equal(again.files[0].changed, false);
  assert.equal(ex.exportRules({ cwd, feedbackDir, check: true }).ok, true);
  const claims = JSON.parse(fs.readFileSync(path.join(feedbackDir, 'claim-gate-rules.json'), 'utf8'));
  claims.rules.push({ id: 'claim-deployed', message: 'A deployed claim needs a live request this turn.' });
  fs.writeFileSync(path.join(feedbackDir, 'claim-gate-rules.json'), JSON.stringify(claims));
  const stale = ex.exportRules({ cwd, feedbackDir, check: true });
  assert.equal(stale.ok, false);
  assert.equal(stale.files[0].changed, true);
  assert.doesNotMatch(fs.readFileSync(stale.files[0].path, 'utf8'), /deployed claim/, '--check never writes');
});

test('AGENTS.md target keeps the rest of the file and replaces only its own block', () => {
  const { feedbackDir, cwd } = fixture();
  const agents = path.join(cwd, 'AGENTS.md');
  fs.writeFileSync(agents, '# Team rules\n\nUse pnpm.\n');
  ex.exportRules({ cwd, feedbackDir, target: 'agents' });
  ex.exportRules({ cwd, feedbackDir, target: 'agents' });
  const md = fs.readFileSync(agents, 'utf8');
  assert.ok(md.startsWith('# Team rules\n\nUse pnpm.\n\n'));
  assert.equal(md.split(ex.BLOCK_START).length, 2, 'exactly one managed block');
  assert.match(md, /## ThumbGate rules for this project/);
  assert.throws(() => ex.exportRules({ cwd, feedbackDir, target: 'nope' }), /Unknown target/);
});

test('refreshExistingExports only touches files the user already exported', () => {
  const { feedbackDir, cwd } = fixture();
  assert.deepEqual(ex.refreshExistingExports({ cwd, feedbackDir }), []);
  assert.equal(fs.existsSync(path.join(cwd, '.claude', 'rules', 'thumbgate.md')), false);
  fs.mkdirSync(path.join(cwd, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.claude', 'rules', 'thumbgate.md'), 'my own hand-written notes\n');
  assert.deepEqual(ex.refreshExistingExports({ cwd, feedbackDir }), [], 'a hand-written file without the marker is left alone');
  ex.exportRules({ cwd, feedbackDir });
  fs.appendFileSync(path.join(feedbackDir, 'prevention-rules.md'), '\n## deploy\n- Rule: verify /health before saying deployed\n');
  const refreshed = ex.refreshExistingExports({ cwd, feedbackDir });
  assert.equal(refreshed.length, 1);
  assert.match(fs.readFileSync(refreshed[0], 'utf8'), /verify \/health before saying deployed/);
});

test('CLI: export-rules writes the file, --check exits 1 when stale, a bad target exits 1', () => {
  const { feedbackDir, cwd } = fixture();
  const env = { ...process.env, THUMBGATE_FEEDBACK_DIR: feedbackDir, THUMBGATE_NO_TELEMETRY: '1', DO_NOT_TRACK: '1' };
  const out = execFileSync(process.execPath, [CLI, 'export-rules', '--json'], { cwd, env, encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.counts.gates, 2);
  assert.ok(fs.existsSync(path.join(cwd, '.claude', 'rules', 'thumbgate.md')));
  fs.appendFileSync(path.join(feedbackDir, 'prevention-rules.md'), '\n## deploy\n- Rule: verify before claiming\n');
  assert.equal(spawnSync(process.execPath, [CLI, 'export-rules', '--check'], { cwd, env }).status, 1);
  assert.equal(spawnSync(process.execPath, [CLI, 'export-rules', '--target=bogus'], { cwd, env }).status, 1);
});

test('refresh never empties a committed export when this machine has no rules', () => {
  const { feedbackDir, cwd } = fixture();
  ex.exportRules({ cwd, feedbackDir });
  const file = path.join(cwd, '.claude', 'rules', 'thumbgate.md');
  const before = fs.readFileSync(file, 'utf8');
  const emptyStore = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cloud-rules-empty-'));
  assert.deepEqual(ex.refreshExistingExports({ cwd, feedbackDir: emptyStore }), []);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test("a gate scoped to this repo's own project is kept", () => {
  const { feedbackDir, cwd } = fixture();
  const { resolveLocalProject } = require('../scripts/project-identity');
  const own = resolveLocalProject(cwd).projectKey;
  const file = path.join(feedbackDir, 'auto-promoted-gates.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.gates.push({ id: 'mine', active: true, scope: 'project', projectKey: own, action: 'block', pattern: 'own-repo-thing', message: 'learned here' });
  fs.writeFileSync(file, JSON.stringify(data));
  const md = ex.renderMarkdown(ex.collectRules({ feedbackDir, cwd }));
  if (own === 'unassigned') assert.doesNotMatch(md, /own-repo-thing/, 'unassigned never matches, same as enforcement');
  else assert.match(md, /own-repo-thing/);
});
