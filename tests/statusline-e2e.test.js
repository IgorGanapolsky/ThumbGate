'use strict';

// TRUE end-to-end test for the statusline cross-store feedback aggregation
// shipped in PR #2545. This does NOT call the aggregation function directly.
// It spawns the REAL entry point — `node scripts/statusline-local-stats.js` —
// as a child process with a fully isolated, offline env (fresh temp HOME +
// temp THUMBGATE_PROJECT_DIR) and asserts on the JSON the statusline consumes.
//
// Stores exercised:
//   ~/.thumbgate/projects/projA/feedback-log.jsonl   (global store A)
//   ~/.thumbgate/projects/projB/feedback-log.jsonl   (global store B)
//   $THUMBGATE_PROJECT_DIR/.thumbgate/feedback-log.jsonl (active project store)
// One feedback `id` ("shared-dup") is present in BOTH projA and projB to prove
// the aggregate dedupes by id and counts it exactly once.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'statusline-local-stats.js');

// ---- Fixtures: known positive/negative entries with a cross-store duplicate id.
const PROJ_A_ENTRIES = [
  { id: 'a-pos-1', signal: 'positive', timestamp: '2026-01-01T00:00:00Z' },
  { id: 'a-neg-1', signal: 'negative', timestamp: '2026-01-02T00:00:00Z' },
  { id: 'shared-dup', signal: 'positive', timestamp: '2026-01-03T00:00:00Z' },
];
const PROJ_B_ENTRIES = [
  { id: 'b-pos-1', signal: 'positive', timestamp: '2026-01-04T00:00:00Z' },
  { id: 'b-neg-1', signal: 'negative', timestamp: '2026-01-05T00:00:00Z' },
  // Same id as in projA -> must be counted ONCE across the aggregate.
  { id: 'shared-dup', signal: 'positive', timestamp: '2026-01-06T00:00:00Z' },
];
const ACTIVE_PROJECT_ENTRIES = [
  { id: 'p-pos-1', signal: 'positive', timestamp: '2026-02-01T00:00:00Z' },
  { id: 'p-pos-2', signal: 'positive', timestamp: '2026-02-02T00:00:00Z' },
  { id: 'p-neg-1', signal: 'negative', timestamp: '2026-02-03T00:00:00Z' },
];

// Compute the TRUE deduped aggregate (by id) from the fixtures, so the
// assertions can never silently drift from the data above.
function dedupedSummary(...entryGroups) {
  const seen = new Set();
  let up = 0;
  let down = 0;
  for (const group of entryGroups) {
    for (const entry of group) {
      const key = entry.id ? `id:${entry.id}` : `anon:${up + down}:${JSON.stringify(entry)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (entry.signal === 'positive') up += 1;
      if (entry.signal === 'negative') down += 1;
    }
  }
  const total = up + down;
  return {
    thumbs_up: up,
    thumbs_down: down,
    total_feedback: total,
    // normalizeStatsPayload renders approval_rate as round(rate*1000)/10 (a %).
    approval_rate: total > 0 ? String(Math.round((up / total) * 1000) / 10) : '0',
  };
}

function writeLog(dir, entries) {
  fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, 'feedback-log.jsonl');
  fs.writeFileSync(
    logPath,
    entries.map((entry) => JSON.stringify({ ...entry, reviewOrigin: 'human' })).join('\n') + '\n'
  );
  return logPath;
}

// Run the real statusline script as a child process with a controlled env.
// extraEnv overrides; scope selects aggregate (default) vs project opt-out.
function runStatusline({ home, projectDir, extraEnv = {} }) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: projectDir,
    encoding: 'utf8',
    // env -i style isolation: only the keys we explicitly pass through.
    env: {
      PATH: process.env.PATH || '',
      HOME: home,
      TMPDIR: process.env.TMPDIR || os.tmpdir(),
      THUMBGATE_PROJECT_DIR: projectDir,
      THUMBGATE_DISABLE_CLAUDE_HISTORY_SYNC: '1',
      // Keep everything offline/local: no network, no DB side effects.
      THUMBGATE_OFFLINE: '1',
      NODE_ENV: 'test',
      ...extraEnv,
    },
  });
  return result;
}

function makeTempHomeDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('statusline e2e: aggregates feedback across all stores, deduped by id', () => {
  const home = makeTempHomeDir('tg-e2e-home-');
  const projectRoot = makeTempHomeDir('tg-e2e-proj-');
  try {
    writeLog(path.join(home, '.thumbgate', 'projects', 'projA'), PROJ_A_ENTRIES);
    writeLog(path.join(home, '.thumbgate', 'projects', 'projB'), PROJ_B_ENTRIES);
    writeLog(path.join(projectRoot, '.thumbgate'), ACTIVE_PROJECT_ENTRIES);

    const result = runStatusline({ home, projectDir: projectRoot });

    assert.equal(result.status, 0, `script must exit 0; stderr=${result.stderr}`);
    const payload = JSON.parse(result.stdout);

    const expected = dedupedSummary(PROJ_A_ENTRIES, PROJ_B_ENTRIES, ACTIVE_PROJECT_ENTRIES);
    // up: a-pos-1, shared-dup(once), b-pos-1, p-pos-1, p-pos-2 = 5
    // down: a-neg-1, b-neg-1, p-neg-1 = 3
    assert.equal(expected.thumbs_up, 5, 'fixture sanity: deduped positives');
    assert.equal(expected.thumbs_down, 3, 'fixture sanity: deduped negatives');
    assert.equal(expected.total_feedback, 8, 'fixture sanity: deduped total');

    assert.equal(payload.thumbs_up, String(expected.thumbs_up));
    assert.equal(payload.thumbs_down, String(expected.thumbs_down));
    assert.equal(payload.total_feedback, String(expected.total_feedback));
    assert.equal(payload.approval_rate, expected.approval_rate);

    // Prove the aggregate path actually ran across multiple stores.
    assert.equal(payload.aggregate.enabled, true);
    assert.equal(payload.aggregate.stores, 3, 'should discover projA, projB, and active project');

    // Hard proof of dedup: naive (non-deduped) sum would be 6 up / total 9.
    // The shared-dup id appears in BOTH projA and projB; counting it once
    // yields 5 up / total 8. If dedup regressed, these would be 6 and 9.
    assert.notEqual(payload.thumbs_up, '6', 'shared-dup id must not be double-counted');
    assert.notEqual(payload.total_feedback, '9', 'shared-dup id must not be double-counted');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('statusline e2e: THUMBGATE_STATUSLINE_SCOPE=project reflects ONLY the active store', () => {
  const home = makeTempHomeDir('tg-e2e-home-');
  const projectRoot = makeTempHomeDir('tg-e2e-proj-');
  try {
    // Same multi-store layout — but the project scope must ignore the global stores.
    writeLog(path.join(home, '.thumbgate', 'projects', 'projA'), PROJ_A_ENTRIES);
    writeLog(path.join(home, '.thumbgate', 'projects', 'projB'), PROJ_B_ENTRIES);
    writeLog(path.join(projectRoot, '.thumbgate'), ACTIVE_PROJECT_ENTRIES);

    const result = runStatusline({
      home,
      projectDir: projectRoot,
      extraEnv: { THUMBGATE_STATUSLINE_SCOPE: 'project' },
    });

    assert.equal(result.status, 0, `script must exit 0; stderr=${result.stderr}`);
    const payload = JSON.parse(result.stdout);

    const expected = dedupedSummary(ACTIVE_PROJECT_ENTRIES);
    // Active store only: p-pos-1, p-pos-2 up; p-neg-1 down.
    assert.equal(expected.thumbs_up, 2, 'fixture sanity: active-store positives');
    assert.equal(expected.thumbs_down, 1, 'fixture sanity: active-store negatives');

    assert.equal(payload.thumbs_up, String(expected.thumbs_up));
    assert.equal(payload.thumbs_down, String(expected.thumbs_down));
    assert.equal(payload.total_feedback, String(expected.total_feedback));
    assert.equal(payload.approval_rate, expected.approval_rate);

    // Opt-out path uses analyzeFeedback(), which does NOT aggregate.
    assert.equal(payload.aggregate.enabled, false, 'project scope must not aggregate');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('statusline e2e: exits 0 with sane zeros when there are zero stores', () => {
  const home = makeTempHomeDir('tg-e2e-home-');
  const projectRoot = makeTempHomeDir('tg-e2e-proj-');
  try {
    // No feedback logs written anywhere.
    const result = runStatusline({ home, projectDir: projectRoot });

    assert.equal(result.status, 0, `script must exit 0; stderr=${result.stderr}`);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.thumbs_up, '0');
    assert.equal(payload.thumbs_down, '0');
    assert.equal(payload.total_feedback, '0');
    assert.equal(payload.approval_rate, '0');
    assert.ok('aggregate' in payload, 'payload must still carry an aggregate descriptor');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
