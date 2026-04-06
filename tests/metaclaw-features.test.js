const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-metaclaw-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const billing = require('../scripts/metered-billing');
const digest = require('../scripts/daily-digest');
const packs = require('../scripts/skill-packs');
const evalH = require('../scripts/eval-harness');
const slow = require('../scripts/slow-loop');

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (fs.existsSync(packs.SKILL_PACKS_DIR)) {
    for (const f of fs.readdirSync(packs.SKILL_PACKS_DIR)) { if (f.startsWith('test-')) fs.unlinkSync(path.join(packs.SKILL_PACKS_DIR, f)); }
  }
});

// === Metered Billing ===
test('metered rates are positive and pro > team', () => { assert.ok(billing.METERED_RATE_PRO > billing.METERED_RATE_TEAM); });
test('MINUTES_SAVED_PER_BLOCK is 16', () => { assert.equal(billing.MINUTES_SAVED_PER_BLOCK, 16); });
test('recordMeteredUsage writes entry to ledger', () => {
  const e = billing.recordMeteredUsage({ agentId: 'a1', gateId: 'g1', decision: 'deny', toolName: 'Bash' });
  assert.ok(e.id.startsWith('meter_'));
  assert.ok(fs.readFileSync(billing.getMeteredLedgerPath(), 'utf-8').includes(e.id));
});
test('recordMeteredUsage defaults missing fields', () => { assert.equal(billing.recordMeteredUsage({}).agentId, 'unknown'); });
test('getMeteredUsageSummary computes Pro pricing', () => {
  for (let i = 0; i < 5; i++) billing.recordMeteredUsage({ decision: 'deny' });
  for (let i = 0; i < 3; i++) billing.recordMeteredUsage({ decision: 'warn' });
  const s = billing.getMeteredUsageSummary({ periodDays: 1, plan: 'pro' });
  assert.ok(s.blockedCount >= 5); assert.ok(s.warnedCount >= 3);
  assert.ok(s.billedAmount >= billing.PRO_FLOOR); assert.ok(s.hoursSaved > 0);
});
test('getMeteredUsageSummary Team pricing with seats', () => {
  const s = billing.getMeteredUsageSummary({ periodDays: 1, plan: 'team', seats: 5 });
  assert.equal(s.floor, billing.TEAM_FLOOR_PER_SEAT * 5);
});
test('getMeteredUsageSummary respects min seats', () => {
  assert.equal(billing.getMeteredUsageSummary({ plan: 'team', seats: 1 }).floor, billing.TEAM_FLOOR_PER_SEAT * billing.TEAM_MIN_SEATS);
});
test('getMeteredUsageSummary zero for empty period', () => { assert.equal(billing.getMeteredUsageSummary({ periodDays: 0 }).blockedCount, 0); });

// === Daily Digest ===
test('formatDailyDigest produces title and message', () => {
  const { title, message } = digest.formatDailyDigest({ activeAgents: 3, totalAgents: 5, totalToolCalls: 100, totalBlocked: 12, totalWarned: 8, totalAllowed: 80, orgAdherenceRate: 88, topBlockedGates: [{ gateId: 'force-push', blocked: 5, warned: 2 }], riskAgents: [{ id: 'risky', adherenceRate: 60, toolCalls: 20 }] });
  assert.ok(title.includes('ThumbGate')); assert.ok(message.includes('Blocked: 12')); assert.ok(message.includes('Hours saved'));
});
test('formatDailyDigest empty dashboard', () => {
  assert.ok(!digest.formatDailyDigest({ activeAgents: 0, totalAgents: 0, totalToolCalls: 0, totalBlocked: 0, totalWarned: 0, totalAllowed: 0, orgAdherenceRate: 100, topBlockedGates: [], riskAgents: [] }).message.includes('Hours saved'));
});
test('generateWeeklyStatsPost returns post', () => {
  const { post } = digest.generateWeeklyStatsPost({ periodDays: 1 });
  assert.ok(post.includes('ThumbGate blocked')); assert.ok(post.includes('Pre-action gates'));
});
test('createDailyDigestSchedule works', () => {
  const r = digest.createDailyDigestSchedule({ platform: 'slack', webhookUrl: 'https://hooks.slack.com/test' });
  assert.ok(r.success); assert.ok(r.schedule.command.includes('sendDailyDigest'));
});

// === Skill Packs ===
test('3 built-in packs', () => { assert.ok(packs.BUILTIN_PACKS['stripe-integration']); assert.ok(packs.BUILTIN_PACKS['railway-deploy']); assert.ok(packs.BUILTIN_PACKS['database-migration']); });
test('listSkillPacks', () => { const l = packs.listSkillPacks(); assert.ok(l.length >= 3); l.forEach((p) => assert.ok(p.ruleCount > 0)); });
test('getSkillPack by name', () => { assert.ok(packs.getSkillPack('stripe-integration')); });
test('getSkillPack null for unknown', () => { assert.equal(packs.getSkillPack('nope'), null); });
test('matchSkillPacks stripe', () => { assert.equal(packs.matchSkillPacks('stripe payment')[0].name, 'stripe-integration'); });
test('matchSkillPacks railway', () => { assert.equal(packs.matchSkillPacks('deploy railway')[0].name, 'railway-deploy'); });
test('matchSkillPacks empty for unrelated', () => { assert.equal(packs.matchSkillPacks('quantum physics').length, 0); });
test('registerSkillPack persists', () => { packs.registerSkillPack({ name: 'test-pack', triggers: ['test'], rules: ['Rule 1'] }); assert.ok(fs.existsSync(path.join(packs.SKILL_PACKS_DIR, 'test-pack.json'))); });
test('registerSkillPack validates name', () => { assert.throws(() => packs.registerSkillPack({ rules: ['x'] }), /name/); });
test('registerSkillPack validates rules', () => { assert.throws(() => packs.registerSkillPack({ name: 'x', rules: [] }), /rule/); });
test('installSkillPackRules', () => { assert.ok(packs.installSkillPackRules('stripe-integration').id); });
test('installSkillPackRules unknown', () => { assert.throws(() => packs.installSkillPackRules('nope'), /not found/); });

// === Eval Harness ===
test('6+ eval cases, 3 domains', () => { assert.ok(evalH.BUILTIN_EVAL_CASES.length >= 6); assert.ok(new Set(evalH.BUILTIN_EVAL_CASES.map((c) => c.domain)).size >= 3); });
test('runEvalCase detects idempotency', () => { assert.ok(evalH.runEvalCase(evalH.BUILTIN_EVAL_CASES.find((c) => c.id === 'stripe-no-idempotency')).passed); });
test('runEvalCase detects health check', () => { assert.ok(evalH.runEvalCase(evalH.BUILTIN_EVAL_CASES.find((c) => c.id === 'railway-no-health-check')).passed); });
test('runEvalSuite 100% pass rate', () => { const { summary } = evalH.runEvalSuite(); assert.equal(summary.passRate, 100); assert.ok(summary.avgContextChars > 0); });
test('runEvalSuite before/after', () => { const { summary } = evalH.runEvalSuite(); assert.equal(summary.withoutThumbgate.passRate, 0); assert.ok(summary.withThumbgate.passRate > 0); });
test('formatEvalReport markdown', () => { const r = evalH.formatEvalReport(evalH.runEvalSuite()); assert.ok(r.includes('# ThumbGate Eval Report')); assert.ok(r.includes('PASS')); });

// === Slow Loop ===
test('isIdle true when no feedback', () => { assert.ok(slow.isIdle()); });
test('isIdle false when fresh feedback + high threshold', () => {
  fs.writeFileSync(path.join(tmpDir, 'feedback-log.jsonl'), '{"id":"fb_1"}\n');
  assert.equal(slow.isIdle({ thresholdMinutes: 999 }), false);
});
test('runSlowLoop skips when not idle', () => {
  fs.writeFileSync(path.join(tmpDir, 'feedback-log.jsonl'), '{"id":"fb_1"}\n');
  assert.equal(slow.runSlowLoop({ thresholdMinutes: 999999 }).action, 'skipped');
});
test('runSlowLoop exports when forced', () => {
  fs.writeFileSync(path.join(tmpDir, 'feedback-log.jsonl'), '{"id":"fb_1"}\n{"id":"fb_2"}\n');
  const r = slow.runSlowLoop({ force: true });
  assert.equal(r.action, 'exported'); assert.ok(r.totalExports >= 1);
});
test('slow loop state persists', () => { assert.ok(slow.loadState().lastExportAt); });
test('createSlowLoopSchedule', () => {
  const r = slow.createSlowLoopSchedule({ schedule: 'hourly' });
  assert.ok(r.success); assert.ok(r.schedule.command.includes('runSlowLoop'));
});

// === Gemini Adapter ===
test('Gemini adapter declares new tools', () => {
  const a = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'adapters', 'gemini', 'function-declarations.json'), 'utf-8'));
  const names = a.tools.map((t) => t.name);
  assert.ok(names.includes('list_skill_packs')); assert.ok(names.includes('run_eval'));
  assert.ok(a.tools.length >= 14);
});
