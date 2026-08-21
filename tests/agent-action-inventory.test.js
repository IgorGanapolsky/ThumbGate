'use strict';

/**
 * Tests for scripts/agent-action-inventory.js.
 *
 * Every test builds its own fixture store under os.tmpdir(). Nothing here ever
 * reads or writes the operator's real `.thumbgate/` directory — a report about
 * gate denials must never be tested against the very store it reports on.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildInventory,
  renderInventoryText,
  normalizeWindowDays,
  readJsonlSource,
  pairDeniesWithClears,
  SOURCE_STATUS,
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  MIN_WINDOW_DAYS,
} = require('../scripts/agent-action-inventory');

const AUDIT = 'audit-trail.jsonl';
const GATE_EVENTS = 'gate-events-log.jsonl';
const TOOL_KPI = 'tool-kpi.jsonl';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-inventory-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJsonl(dir, fileName, records) {
  fs.writeFileSync(
    path.join(dir, fileName),
    records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '')
  );
}

/** Hours ago as an ISO string, so fixtures always land inside a day window. */
function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

function daysAgo(d) {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
}

// Shapes copied from real records in scripts/audit-trail.js (recordAuditEvent)
// and scripts/tool-kpi-tracker.js (recordToolCall).
function auditRecord(overrides) {
  return {
    id: `audit_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: hoursAgo(1),
    toolName: 'Bash',
    toolInput: { command: 'echo hi' },
    decision: 'allow',
    gateId: null,
    message: null,
    severity: null,
    latencyMs: null,
    source: 'gates-engine',
    ...overrides,
  };
}

function kpiRecord(overrides) {
  return {
    id: `kpi_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: hoursAgo(1),
    toolName: 'Bash',
    serverName: 'mcp',
    latencyMs: 12,
    success: true,
    agentId: 'unknown',
    metadata: { category: 'success', traceId: null },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// windowDays normalization
// ---------------------------------------------------------------------------

test('normalizeWindowDays clamps and defaults without throwing', () => {
  assert.equal(normalizeWindowDays(undefined), DEFAULT_WINDOW_DAYS);
  assert.equal(normalizeWindowDays(''), DEFAULT_WINDOW_DAYS);
  assert.equal(normalizeWindowDays('not-a-number'), DEFAULT_WINDOW_DAYS);
  assert.equal(normalizeWindowDays(0), MIN_WINDOW_DAYS);
  assert.equal(normalizeWindowDays(-5), MIN_WINDOW_DAYS);
  assert.equal(normalizeWindowDays(99999), MAX_WINDOW_DAYS);
  assert.equal(normalizeWindowDays('7'), 7);
  assert.equal(normalizeWindowDays(7.9), 7);
});

// ---------------------------------------------------------------------------
// Populated store
// ---------------------------------------------------------------------------

test('populated store: aggregates tool calls, gates, daily rows and agents', (t) => {
  const dir = makeDataDir(t);

  writeJsonl(dir, AUDIT, [
    auditRecord({ timestamp: hoursAgo(30), toolName: 'Bash', decision: 'allow' }),
    auditRecord({ timestamp: hoursAgo(29), toolName: 'Bash', decision: 'allow' }),
    auditRecord({
      timestamp: hoursAgo(28),
      toolName: 'Bash',
      decision: 'deny',
      gateId: 'force-push',
      message: 'Force push blocked. This is destructive and irreversible.',
      severity: 'critical',
    }),
    auditRecord({
      timestamp: hoursAgo(5),
      toolName: 'Write',
      decision: 'deny',
      gateId: 'task-scope-edit-boundary',
      message: 'Outside declared task scope',
      severity: 'critical',
    }),
    auditRecord({
      timestamp: hoursAgo(4),
      toolName: 'Bash',
      decision: 'warn',
      gateId: 'deploy-unverified-claim',
      message: 'Deployment claim detected.',
    }),
    auditRecord({ timestamp: hoursAgo(3), toolName: 'Read', decision: 'allow' }),
  ]);

  writeJsonl(dir, GATE_EVENTS, [
    { id: 'gate_1', gateId: 'force-push', decision: 'deny', toolName: 'Bash', message: 'Force push blocked.', source: 'gates-engine', timestamp: hoursAgo(28) },
    { id: 'gate_2', gateId: 'task-scope-edit-boundary', decision: 'deny', toolName: 'Write', message: 'Outside scope', source: 'gates-engine', timestamp: hoursAgo(5) },
    { id: 'gate_3', gateId: 'deploy-unverified-claim', decision: 'warn', toolName: 'Bash', message: 'Deployment claim', source: 'gates-engine', timestamp: hoursAgo(4) },
  ]);

  writeJsonl(dir, TOOL_KPI, [
    kpiRecord({ agentId: 'builder-1', toolName: 'Bash' }),
    kpiRecord({ agentId: 'builder-1', toolName: 'Bash' }),
    kpiRecord({ agentId: 'builder-1', toolName: 'Write', success: false }),
    kpiRecord({ agentId: 'reviewer-2', toolName: 'Read' }),
  ]);

  const inv = buildInventory({ dataDir: dir, windowDays: 7 });

  assert.deepEqual(inv.sources, {
    auditTrail: SOURCE_STATUS.OK,
    gateEvents: SOURCE_STATUS.OK,
    toolKpi: SOURCE_STATUS.OK,
  });

  assert.equal(inv.allowCount, 3);
  assert.equal(inv.denyCount, 2);
  assert.equal(inv.warnCount, 1);
  assert.equal(inv.gateEventDenies, 2);

  // toolCalls grouped by tool name
  assert.equal(inv.toolCalls.Bash.total, 4);
  assert.equal(inv.toolCalls.Bash.allow, 2);
  assert.equal(inv.toolCalls.Bash.deny, 1);
  assert.equal(inv.toolCalls.Bash.warn, 1);
  assert.equal(inv.toolCalls.Write.deny, 1);
  assert.equal(inv.toolCalls.Read.allow, 1);

  // denyReasonsByGate carries the verbatim gate message and its count
  assert.equal(inv.denyReasonsByGate['force-push'].denies, 1);
  assert.equal(
    inv.denyReasonsByGate['force-push'].reasons[0].message,
    'Force push blocked. This is destructive and irreversible.'
  );
  assert.equal(inv.denyReasonsByGate['task-scope-edit-boundary'].denies, 1);

  // topGates ranks by denies, then warns
  const gateNames = inv.topGates.map((g) => g.gate);
  assert.ok(gateNames.includes('force-push'));
  assert.ok(gateNames.includes('task-scope-edit-boundary'));
  assert.equal(gateNames[gateNames.length - 1], 'deploy-unverified-claim');

  // daily rows sum back to the window totals
  const totalCalls = inv.daily.reduce((sum, d) => sum + d.calls, 0);
  const totalDenies = inv.daily.reduce((sum, d) => sum + d.denies, 0);
  assert.equal(totalCalls, 6);
  assert.equal(totalDenies, 2);
  assert.ok(inv.daily.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)));

  // agents come from tool-kpi only
  assert.equal(inv.agents.length, 2);
  assert.equal(inv.agents[0].agentId, 'builder-1');
  assert.equal(inv.agents[0].calls, 3);
  assert.equal(inv.agents[0].failures, 1);
  assert.equal(inv.agents[0].tools[0].tool, 'Bash');
  assert.equal(inv.agentAttribution.status, 'partial');
  assert.equal(inv.agentAttribution.gateDecisionsPerAgent, 'unavailable');

  // text rendering must not throw and must surface the honest bits
  const text = renderInventoryText(inv);
  assert.match(text, /ThumbGate agent action inventory/);
  assert.match(text, /force-push/);
  assert.match(text, /False-deny rate/);
});

test('records outside the window are excluded, not silently counted', (t) => {
  const dir = makeDataDir(t);
  writeJsonl(dir, AUDIT, [
    auditRecord({ timestamp: daysAgo(40), decision: 'deny', gateId: 'force-push', message: 'old' }),
    auditRecord({ timestamp: hoursAgo(2), decision: 'allow' }),
  ]);

  const inv = buildInventory({ dataDir: dir, windowDays: 7 });
  assert.equal(inv.denyCount, 0);
  assert.equal(inv.allowCount, 1);
  // The file itself is still 'ok' and its total is still reported, so an
  // operator can see that data exists outside the window.
  assert.equal(inv.sources.auditTrail, SOURCE_STATUS.OK);
  assert.equal(inv.sourceDetail.auditTrail.recordsTotal, 2);
  assert.equal(inv.sourceDetail.auditTrail.recordsInWindow, 1);
});

// ---------------------------------------------------------------------------
// Empty source vs missing source — must be visibly different
// ---------------------------------------------------------------------------

test('empty source: present-but-empty files report "empty", never a bare zero', (t) => {
  const dir = makeDataDir(t);
  fs.writeFileSync(path.join(dir, AUDIT), '');
  fs.writeFileSync(path.join(dir, GATE_EVENTS), '\n\n');
  fs.writeFileSync(path.join(dir, TOOL_KPI), '');

  const inv = buildInventory({ dataDir: dir, windowDays: 7 });

  assert.deepEqual(inv.sources, {
    auditTrail: SOURCE_STATUS.EMPTY,
    gateEvents: SOURCE_STATUS.EMPTY,
    toolKpi: SOURCE_STATUS.EMPTY,
  });
  // recordsInWindow is null (not 0) because nothing was measured.
  assert.equal(inv.sourceDetail.auditTrail.recordsInWindow, null);
  assert.equal(inv.sourceDetail.auditTrail.recordsTotal, 0);
  assert.equal(inv.gateEventDenies, null);
  assert.equal(inv.agents.length, 0);
  assert.equal(inv.agentAttribution.status, 'empty-source');
  assert.match(inv.agentAttribution.reason, /exists at/);
  assert.match(inv.agentAttribution.reason, /no parsable records/);
});

test('missing source: absent files report "missing" and are distinguishable from empty', (t) => {
  const dir = makeDataDir(t); // nothing written at all

  const inv = buildInventory({ dataDir: dir, windowDays: 7 });

  assert.deepEqual(inv.sources, {
    auditTrail: SOURCE_STATUS.MISSING,
    gateEvents: SOURCE_STATUS.MISSING,
    toolKpi: SOURCE_STATUS.MISSING,
  });
  assert.equal(inv.agentAttribution.status, 'missing-source');
  assert.match(inv.agentAttribution.reason, /is not present at/);

  // The whole point: empty and missing must not collapse into the same output.
  const emptyDir = makeDataDir(t);
  fs.writeFileSync(path.join(emptyDir, AUDIT), '');
  const emptyInv = buildInventory({ dataDir: emptyDir, windowDays: 7 });
  assert.notEqual(inv.sources.auditTrail, emptyInv.sources.auditTrail);
  assert.notEqual(inv.falseDenyReason, emptyInv.falseDenyReason);
});

test('a source of only malformed lines reads as empty-of-data, not missing', (t) => {
  const dir = makeDataDir(t);
  fs.writeFileSync(path.join(dir, AUDIT), 'not json\n{broken\n');

  const source = readJsonlSource(path.join(dir, AUDIT));
  assert.equal(source.status, SOURCE_STATUS.EMPTY);
  assert.equal(source.malformed, 2);

  const inv = buildInventory({ dataDir: dir, windowDays: 7 });
  assert.equal(inv.sources.auditTrail, SOURCE_STATUS.EMPTY);
  assert.equal(inv.sourceDetail.auditTrail.malformedLines, 2);
});

// ---------------------------------------------------------------------------
// falseDenyRate — computed
// ---------------------------------------------------------------------------

test('falseDenyRate is computed when denies and later reversals both exist', (t) => {
  const dir = makeDataDir(t);

  writeJsonl(dir, AUDIT, [
    // Four denies across three gates...
    auditRecord({ timestamp: hoursAgo(10), decision: 'deny', gateId: 'pr_threads_checked', message: 'PR threads unchecked' }),
    auditRecord({ timestamp: hoursAgo(9), decision: 'deny', gateId: 'pr_threads_checked', message: 'PR threads unchecked' }),
    auditRecord({ timestamp: hoursAgo(8), decision: 'deny', gateId: 'force-push', message: 'Force push blocked' }),
    auditRecord({ timestamp: hoursAgo(7), decision: 'deny', gateId: 'workflow-sentinel', message: 'learned policy deny' }),
    // ...two of which are genuinely reversed, by the two distinct receipt shapes.
    auditRecord({
      timestamp: hoursAgo(6),
      toolName: 'gate-override',
      decision: 'override',
      gateId: 'pr_threads_checked',
      message: 'CEO cleared the PR-thread halt',
      source: 'override-audit',
    }),
    auditRecord({
      timestamp: hoursAgo(5),
      decision: 'allow',
      gateId: 'force-push',
      message: 'Single-use admin override consumed for sha256:abc.',
      source: 'gates-engine-admin-override',
    }),
  ]);

  const inv = buildInventory({ dataDir: dir, windowDays: 7 });

  assert.equal(inv.denyCount, 4);
  assert.equal(inv.falseDenyDenominator, 4);
  assert.equal(inv.falseDenyNumerator, 2);
  assert.equal(inv.falseDenyClearEvents, 2);
  assert.equal(inv.falseDenyRate, 0.5);
  assert.equal(inv.falseDenyReason, null);
  assert.match(inv.falseDenyMethod, /1:1 pairing/);
  assert.equal(inv.overrideCount, 2);
});

test("decision 'approve' is a block, never a reversal", (t) => {
  const dir = makeDataDir(t);

  writeJsonl(dir, AUDIT, [
    auditRecord({ timestamp: hoursAgo(9), decision: 'deny', gateId: 'workflow-sentinel', message: 'learned policy deny' }),
    auditRecord({ timestamp: hoursAgo(8), decision: 'deny', gateId: 'workflow-sentinel', message: 'learned policy deny' }),
    // gates-engine writes this with requiresApproval:true and formatOutput renders
    // it to the harness as permissionDecision 'deny'. It is a HELD action.
    auditRecord({
      timestamp: hoursAgo(2),
      decision: 'approve',
      gateId: 'workflow-sentinel',
      message: 'APPROVAL REQUIRED',
      severity: 'critical',
    }),
  ]);

  const inv = buildInventory({ dataDir: dir, windowDays: 7 });

  // The approval hold must not reverse either deny.
  assert.equal(inv.falseDenyNumerator, 0);
  assert.equal(inv.falseDenyClearEvents, 0);
  assert.equal(inv.falseDenyDenominator, 2);
  assert.equal(inv.falseDenyRate, 0);
  assert.equal(inv.overrideCount, 0);

  // It is surfaced on its own, and never silently folded into allow or deny.
  assert.equal(inv.approvalRequiredCount, 1);
  assert.equal(inv.allowCount, 0);
  assert.equal(inv.denyCount, 2);
  assert.equal(inv.toolCalls.Bash.approvalRequired, 1);

  const sentinel = inv.topGates.find((g) => g.gate === 'workflow-sentinel');
  assert.equal(sentinel.approvalRequired, 1);
  assert.equal(sentinel.overrides, 0);

  // And the method string states the exclusion, so the choice is auditable.
  assert.match(inv.falseDenyMethod, /"approve" is deliberately NOT counted/);
});

test("a plain 'allow' without the admin-override source is not a reversal", () => {
  const records = [
    { timestamp: hoursAgo(5), decision: 'deny', gateId: 'force-push' },
    // Ordinary allow — same gateId, but no admin-override source.
    { timestamp: hoursAgo(4), decision: 'allow', gateId: 'force-push', source: 'gates-engine' },
  ];
  const { numerator, denominator, clearEvents } = pairDeniesWithClears(records);
  assert.equal(denominator, 1);
  assert.equal(clearEvents, 0);
  assert.equal(numerator, 0);
});

test('one clear never reverses more than one deny of the same gate', () => {
  const records = [
    { timestamp: hoursAgo(5), decision: 'deny', gateId: 'force-push' },
    { timestamp: hoursAgo(4), decision: 'deny', gateId: 'force-push' },
    { timestamp: hoursAgo(3), decision: 'deny', gateId: 'force-push' },
    { timestamp: hoursAgo(2), decision: 'override', gateId: 'force-push' },
  ];
  const { numerator, denominator, clearEvents } = pairDeniesWithClears(records);
  assert.equal(denominator, 3);
  assert.equal(clearEvents, 1);
  // A single override must not brand all three denies as false.
  assert.equal(numerator, 1);
});

test('a clear that precedes every deny of its gate pairs with nothing', () => {
  const records = [
    { timestamp: hoursAgo(5), decision: 'override', gateId: 'force-push' },
    { timestamp: hoursAgo(4), decision: 'deny', gateId: 'force-push' },
  ];
  const { numerator, denominator } = pairDeniesWithClears(records);
  assert.equal(denominator, 1);
  assert.equal(numerator, 0);
});

test('denies with zero clears give a measured rate of 0, with clearEvents proving it', (t) => {
  const dir = makeDataDir(t);
  writeJsonl(dir, AUDIT, [
    auditRecord({ timestamp: hoursAgo(3), decision: 'deny', gateId: 'force-push', message: 'blocked' }),
    auditRecord({ timestamp: hoursAgo(2), decision: 'deny', gateId: 'force-push', message: 'blocked' }),
  ]);

  const inv = buildInventory({ dataDir: dir, windowDays: 7 });
  assert.equal(inv.falseDenyRate, 0);
  assert.equal(inv.falseDenyNumerator, 0);
  assert.equal(inv.falseDenyDenominator, 2);
  assert.equal(inv.falseDenyClearEvents, 0);
  assert.equal(inv.falseDenyReason, null);
});

// ---------------------------------------------------------------------------
// falseDenyRate — null with a reason
// ---------------------------------------------------------------------------

test('falseDenyRate is null with a reason when the audit trail is missing', (t) => {
  const dir = makeDataDir(t);

  const inv = buildInventory({ dataDir: dir, windowDays: 7 });

  assert.equal(inv.falseDenyRate, null);
  assert.equal(inv.falseDenyNumerator, null);
  assert.equal(inv.falseDenyDenominator, null);
  assert.equal(inv.falseDenyClearEvents, null);
  assert.match(inv.falseDenyReason, /is missing at/);
  assert.match(inv.falseDenyReason, /audit-trail\.jsonl/);
});

test('falseDenyRate is null with a reason when the audit trail is empty', (t) => {
  const dir = makeDataDir(t);
  fs.writeFileSync(path.join(dir, AUDIT), '');

  const inv = buildInventory({ dataDir: dir, windowDays: 7 });

  assert.equal(inv.falseDenyRate, null);
  assert.equal(inv.falseDenyNumerator, null);
  assert.equal(inv.falseDenyDenominator, null);
  assert.match(inv.falseDenyReason, /no parsable records/);
  assert.match(inv.falseDenyReason, /not a rate of zero/);
});

test('falseDenyRate is null when there are calls but zero denies in the window', (t) => {
  const dir = makeDataDir(t);
  writeJsonl(dir, AUDIT, [
    auditRecord({ timestamp: hoursAgo(3), decision: 'allow' }),
    auditRecord({ timestamp: hoursAgo(2), decision: 'allow' }),
  ]);

  const inv = buildInventory({ dataDir: dir, windowDays: 7 });

  assert.equal(inv.allowCount, 2);
  assert.equal(inv.falseDenyRate, null);
  // Raw counts are still present so nobody has to guess what was measured.
  assert.equal(inv.falseDenyNumerator, 0);
  assert.equal(inv.falseDenyDenominator, 0);
  assert.match(inv.falseDenyReason, /No deny records/);
  assert.match(inv.falseDenyReason, /invented denominator/);
});

test('null-rate text output says NOT MEASURED rather than printing 0%', (t) => {
  const dir = makeDataDir(t);
  const inv = buildInventory({ dataDir: dir, windowDays: 7 });
  const text = renderInventoryText(inv);
  assert.match(text, /null — NOT MEASURED/);
  assert.doesNotMatch(text, /^\s+0\.00%$/m);
  assert.match(text, /MISSING \(file not found\)/);
});

// ---------------------------------------------------------------------------
// Bounded tail reads
// ---------------------------------------------------------------------------

test('a source larger than maxBytes is read as a tail and reports truncated', (t) => {
  const dir = makeDataDir(t);
  // ~200 records; each is well over 100 bytes, so a 4 KiB window keeps only a few.
  const many = [];
  for (let i = 0; i < 200; i++) {
    many.push(auditRecord({ timestamp: hoursAgo(3), decision: 'allow', message: `filler-${i}` }));
  }
  writeJsonl(dir, AUDIT, many);

  const source = readJsonlSource(path.join(dir, AUDIT), { maxBytes: 4096 });
  assert.equal(source.status, SOURCE_STATUS.OK);
  assert.equal(source.truncated, true);
  assert.ok(source.bytesRead <= 4096, `bytesRead ${source.bytesRead} should be <= 4096`);
  assert.ok(source.fileBytes > source.bytesRead);
  assert.ok(source.records.length > 0 && source.records.length < 200);
  // The partial first record must have been dropped, so nothing is malformed.
  assert.equal(source.malformed, 0);
});

test('an untruncated source reports truncated:false and full byte counts', (t) => {
  const dir = makeDataDir(t);
  writeJsonl(dir, AUDIT, [auditRecord({ decision: 'allow' })]);

  const source = readJsonlSource(path.join(dir, AUDIT));
  assert.equal(source.truncated, false);
  assert.equal(source.bytesRead, source.fileBytes);
  assert.ok(source.fileBytes > 0);
});

test('a truncated window that misses the requested window is flagged, not hidden', (t) => {
  const dir = makeDataDir(t);
  const many = [];
  for (let i = 0; i < 200; i++) {
    many.push(auditRecord({ timestamp: hoursAgo(3), decision: 'allow', message: `filler-${i}` }));
  }
  writeJsonl(dir, AUDIT, many);

  const inv = buildInventory({ dataDir: dir, windowDays: 7, maxBytes: 4096 });

  assert.equal(inv.sourceDetail.auditTrail.truncated, true);
  // Every surviving record is 3h old, far newer than the 7-day `since`, so the
  // tail demonstrably did not reach the start of the window.
  assert.equal(inv.sourceDetail.auditTrail.coversWindow, false);
  assert.equal(inv.windowFullyCovered, false);
  assert.match(renderInventoryText(inv), /TRUNCATED: read the last/);
  assert.match(renderInventoryText(inv), /PARTIAL view/);
});

test('a fully-read source reports windowFullyCovered true', (t) => {
  const dir = makeDataDir(t);
  writeJsonl(dir, AUDIT, [auditRecord({ decision: 'allow' })]);

  const inv = buildInventory({ dataDir: dir, windowDays: 7 });
  assert.equal(inv.windowFullyCovered, true);
  assert.equal(inv.sourceDetail.auditTrail.truncated, false);
  assert.doesNotMatch(renderInventoryText(inv), /PARTIAL view/);
});

test('windowFullyCovered is null when the audit trail was never readable', (t) => {
  const dir = makeDataDir(t);
  const inv = buildInventory({ dataDir: dir, windowDays: 7 });
  assert.equal(inv.sources.auditTrail, SOURCE_STATUS.MISSING);
  assert.equal(inv.windowFullyCovered, null);
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

test('buildInventory writes nothing to the data directory', (t) => {
  const dir = makeDataDir(t);
  writeJsonl(dir, AUDIT, [auditRecord({ decision: 'deny', gateId: 'force-push', message: 'blocked' })]);

  const before = fs.readdirSync(dir).sort();
  buildInventory({ dataDir: dir, windowDays: 7 });
  const after = fs.readdirSync(dir).sort();

  assert.deepEqual(after, before);
});

// ---------------------------------------------------------------------------
// Packaged command path
//
// `bin/cli.js` loads this module with
//   require(path.join(PKG_ROOT, 'scripts', 'agent-action-inventory'))
// and package.json#files is an explicit per-file whitelist, not a directory
// glob. If the module is not enumerated there, `npm pack` omits it and
// `npx thumbgate inventory` throws MODULE_NOT_FOUND for every npm consumer
// while still working perfectly in a repo checkout — the exact split that made
// this defect invisible in CI.
//
// The bundle-count ratchets in tests/package-boundary.test.js,
// tests/public-bundle-ratchet.test.js and tests/public-core-boundary.test.js
// only assert a TOTAL file count, which stays satisfiable with this specific
// file missing. This test names the file.
// ---------------------------------------------------------------------------

test('the inventory module the CLI requires is enumerated in package.json#files', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  );

  assert.ok(Array.isArray(pkg.files), 'package.json#files must be an explicit array');
  assert.ok(
    pkg.files.includes('scripts/agent-action-inventory.js'),
    'scripts/agent-action-inventory.js missing from package.json#files — '
      + '`npx thumbgate inventory` would throw MODULE_NOT_FOUND for npm installs'
  );

  // The CLI resolves the module by that exact path relative to the package
  // root, so a rename must break this test rather than ship a broken command.
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'scripts', 'agent-action-inventory.js')),
    'the whitelisted path must exist on disk'
  );

  const cli = fs.readFileSync(path.join(__dirname, '..', 'bin', 'cli.js'), 'utf8');
  assert.ok(
    cli.includes("'scripts', 'agent-action-inventory'"),
    'bin/cli.js no longer requires scripts/agent-action-inventory — update this guard with it'
  );
});
