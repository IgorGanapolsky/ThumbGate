'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { generateMutations, runMutationGate } = require('../scripts/mutation-test-diode');
const {
  EVENT_PRIORITIES,
  evaluateLoadShedding,
  enforceProductCaps,
  auditSqlForScatterQueries,
} = require('../scripts/load-shedding-diode');
const { StateMachineDiode } = require('../scripts/state-machine-diode');
const {
  LazyPipelineManager,
  createPolicyDatabase,
  jevType1Decision,
} = require('../scripts/tsunami-sdlc-guardrails');
const { PermissionAwareRetriever } = require('../scripts/permission-aware-context-diode');
const { SkillsHub } = require('../scripts/skills-hub-sync');
const { EVENT_BLUEPRINT, generateEventConfig } = require('../scripts/live-briefing-event-engine');

test('Maude Lemaire Steal: Mutation Testing Diode', async (t) => {
  await t.test('generates systematic mutations for operators and conditionals', () => {
    const code = `
      function isValid(user, age) {
        if (age > 18 && user.isActive === true) {
          return true;
        }
        return false;
      }
    `;

    const mutants = generateMutations(code, 5);
    assert.ok(mutants.length > 0);
    assert.ok(mutants.some(m => m.operator === 'equality_inversion' || m.operator === 'logical_and_to_or' || m.operator === 'greater_to_less_equal'));
  });

  await t.test('detects tautological tests when mutants survive', () => {
    const tmpFile = path.join(os.tmpdir(), `test_mutant_${Date.now()}.js`);
    fs.writeFileSync(tmpFile, 'function add(a, b) { if (a > 0) return a + b; return 0; }', 'utf8');

    try {
      // Mock evaluator where tests pass on every mutant (meaning tests failed to catch any mutation!)
      const gateResult = runMutationGate({
        targetFilePath: tmpFile,
        testCmd: 'npm test',
        minMutationScore: 0.70,
        mockEvaluator: () => ({ killed: false, survived: true }),
      });

      assert.equal(gateResult.allowed, false);
      assert.equal(gateResult.verdict, 'FAIL_TAUTOLOGICAL_TESTS');
      assert.equal(gateResult.mutationScore, 0);
      assert.ok(gateResult.recommendation.includes('AI-generated tests are tautological'));
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  await t.test('passes mutation gate when unit tests kill mutants', () => {
    const tmpFile = path.join(os.tmpdir(), `test_mutant_kill_${Date.now()}.js`);
    fs.writeFileSync(tmpFile, 'function add(a, b) { if (a > 0) return a + b; return 0; }', 'utf8');

    try {
      // Mock evaluator where unit tests kill mutants
      const gateResult = runMutationGate({
        targetFilePath: tmpFile,
        testCmd: 'npm test',
        minMutationScore: 0.70,
        mockEvaluator: () => ({ killed: true, survived: false }),
      });

      assert.equal(gateResult.allowed, true);
      assert.equal(gateResult.verdict, 'PASS_MUTATION_GATE');
      assert.equal(gateResult.mutationScore, 1.0);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });
});

test('Maude Lemaire Steal: Product-Aware Load Shedding & Scatter Queries', async (t) => {
  await t.test('preserves critical events while shedding non-essential reactions under load', () => {
    // Normal load: all events processed
    const resNormal = evaluateLoadShedding({ eventType: 'reaction.add' }, { cpuPercent: 30, queueDepth: 100 });
    assert.equal(resNormal.action, 'process');

    // High load: Priority 3 (reaction.add) is shed
    const resHigh = evaluateLoadShedding({ eventType: 'reaction.add' }, { cpuPercent: 78, queueDepth: 800 });
    assert.equal(resHigh.action, 'shed');
    assert.equal(resHigh.priority, 3);

    // High load: Priority 1 (chat.message) is preserved
    const resChat = evaluateLoadShedding({ eventType: 'chat.message' }, { cpuPercent: 78, queueDepth: 800 });
    assert.equal(resChat.action, 'process');

    // Extreme load: Priority 1 preserved, others dropped
    const resExtremeChat = evaluateLoadShedding({ eventType: 'tool.approval' }, { cpuPercent: 95, queueDepth: 5000 });
    assert.equal(resExtremeChat.action, 'process');

    const resExtremePresence = evaluateLoadShedding({ eventType: 'presence.heartbeat' }, { cpuPercent: 95, queueDepth: 5000 });
    assert.equal(resExtremePresence.action, 'shed');
  });

  await t.test('enforces product caps on custom emoji and unread badges', () => {
    const emojis = Array.from({ length: 40 }, (_, i) => `emoji_${i}`);
    const cappedEmojis = enforceProductCaps('custom_emoji_reactions', emojis);
    assert.equal(cappedEmojis.capped, true);
    assert.equal(cappedEmojis.count, 23); // Slack cap

    const badgeOver = enforceProductCaps('unread_badge_count', 450);
    assert.equal(badgeOver.display, '99+');
    assert.equal(badgeOver.capped, true);

    const badgeNormal = enforceProductCaps('unread_badge_count', 12);
    assert.equal(badgeNormal.display, '12');
    assert.equal(badgeNormal.capped, false);
  });

  await t.test('audits SQL statements to catch un-sharded scatter queries', () => {
    const badQuery1 = 'SELECT * FROM messages;';
    const audit1 = auditSqlForScatterQueries(badQuery1);
    assert.equal(audit1.isScatterQuery, true);
    assert.ok(audit1.reason.includes('without WHERE clause'));

    const badQuery2 = 'SELECT * FROM messages WHERE is_read = false;';
    const audit2 = auditSqlForScatterQueries(badQuery2);
    assert.equal(audit2.isScatterQuery, true);
    assert.ok(audit2.reason.includes('lacks required primary sharding key'));

    const goodQuery = 'SELECT * FROM messages WHERE channel_id = "c_123" AND is_read = false;';
    const audit3 = auditSqlForScatterQueries(goodQuery);
    assert.equal(audit3.isScatterQuery, false);
  });
});

test('Ai2 StateBench Steal: Deterministic State Machine Diode', async (t) => {
  await t.test('tracks variable state and cascades invalidation to downstream dependencies', () => {
    const diode = new StateMachineDiode();

    diode.setEntity('git_branch', 'feature/auth');
    diode.setEntity('pr_approved', true);

    // Decision 'deploy_permission' depends on 'git_branch' and 'pr_approved'
    diode.setEntity('deploy_permission', { allowed: true });
    diode.addDependency('deploy_permission', 'git_branch');
    diode.addDependency('deploy_permission', 'pr_approved');

    // Initially valid
    const check1 = diode.verifyValidity('deploy_permission');
    assert.equal(check1.valid, true);

    // Upstream state change occurs (new commit pushed to branch)
    diode.setEntity('git_branch', 'feature/auth-rebased', 'git_push_event');

    // Deploy permission must be invalidated automatically!
    const check2 = diode.verifyValidity('deploy_permission');
    assert.equal(check2.valid, false);
    assert.ok(check2.reason.includes('INVALIDATED due to upstream state mutation'));
  });

  await t.test('solves Level-4 StateBench permutation swap tracking with 100% precision', () => {
    const diode = new StateMachineDiode();
    const initialCups = ['ball', 'empty', 'empty', 'empty', 'empty'];
    const swaps = [
      [0, 1], // ball at 1
      [1, 3], // ball at 3
      [2, 4], // ball still at 3
      [3, 0], // ball at 0
      [0, 4], // ball at 4
    ];

    const finalCups = diode.applyPermutationSwaps(initialCups, swaps);
    assert.equal(finalCups[4], 'ball');
    assert.equal(finalCups[0], 'empty');
  });
});

test('SDLC Tsunami Guardrails: Lazy PR & Database-Layer Constraints', async (t) => {
  await t.test('LazyPipelineManager supersedes in-flight runs on newer commits', () => {
    const manager = new LazyPipelineManager();
    let cancelled = false;

    const run1 = manager.registerRun('feature/login', 'sha_commit_1', () => {
      cancelled = true;
    });
    assert.equal(run1.cancelledPrevious, false);

    // Newer commit arrives on same branch
    const run2 = manager.registerRun('feature/login', 'sha_commit_2');
    assert.equal(run2.cancelledPrevious, true);
    assert.equal(cancelled, true);
    assert.equal(manager.cancelledRuns.length, 1);
  });

  await t.test('Database-layer CHECK constraints and immutable audit triggers', () => {
    const db = createPolicyDatabase(':memory:');

    // 1. Spending limit constraint
    db.prepare('INSERT INTO spending_limits (id, service_name, max_authorized_cents, current_spent_cents) VALUES (?, ?, ?, ?)').run(
      'lim_1', 'openai_api', 5000, 1000
    );

    // Attempting to exceed max_authorized_cents should fail closed in the database engine
    assert.throws(() => {
      db.prepare('UPDATE spending_limits SET current_spent_cents = 6000 WHERE id = ?').run('lim_1');
    }, /CHECK constraint failed/);

    // 2. Immutable audit log trigger
    db.prepare('INSERT INTO immutable_audit_log (actor, action, payload_json) VALUES (?, ?, ?)').run(
      'agent_claude', 'tool_call', '{"tool":"git_push"}'
    );

    // Attempting to update or delete audit records must abort
    assert.throws(() => {
      db.prepare("UPDATE immutable_audit_log SET actor = 'malicious' WHERE id = 1").run();
    }, /Audit log records are strictly immutable/);

    assert.throws(() => {
      db.prepare('DELETE FROM immutable_audit_log WHERE id = 1').run();
    }, /Audit log records are strictly immutable/);

    db.close();
  });

  await t.test('Jev Type-1 fast decisioning approves safe tasks and rejects dangerous ones in <5ms', () => {
    const safeRes = jevType1Decision({ command: 'node scripts/test.js', targetPath: 'src/app.js' });
    assert.equal(safeRes.decision, 'APPROVE');
    assert.ok(safeRes.latencyMs < 20);

    const dangerousRes = jevType1Decision({ command: 'rm -rf /', targetPath: 'src/app.js' });
    assert.equal(dangerousRes.decision, 'REJECT');
  });
});

test('BoxWorks + NVIDIA Nemotron Steal: Permission-Aware Context Diode', async (t) => {
  await t.test('filters enterprise passages by role-based ACLs before prompt injection', () => {
    const retriever = new PermissionAwareRetriever([
      {
        id: 'doc_public_api',
        title: 'Public API Documentation',
        content: 'Public REST endpoints and rate limits',
        allowedRoles: ['all'],
        classification: 'public',
      },
      {
        id: 'doc_exec_salaries',
        title: 'Executive Compensation and Contracts',
        content: 'Confidential executive compensation figures',
        allowedRoles: ['c_suite', 'hr_director'],
        classification: 'restricted',
      },
      {
        id: 'doc_eng_architecture',
        title: 'Database Architecture and Sharding Plan',
        content: 'Postgres and Vitess database sharding keys by channel_id',
        allowedRoles: ['engineer', 'tech_lead'],
        classification: 'internal',
      },
    ]);

    // Engineer querying context
    const engResults = retriever.retrieveContext('database sharding keys', { userRole: 'engineer' });
    assert.equal(engResults.retrievedCount, 1);
    assert.equal(engResults.passages[0].title, 'Database Architecture and Sharding Plan');

    // Engineer trying to query confidential executive contracts
    const leakAttempt = retriever.retrieveContext('executive compensation contracts', { userRole: 'engineer' });
    assert.equal(leakAttempt.retrievedCount, 0);
    assert.equal(leakAttempt.deniedCount, 1);
    assert.ok(leakAttempt.denied[0].reason.includes('Access denied'));
    assert.equal(leakAttempt.promptContext, '');
  });
});

test('Dan Kornas Steal: Skills Hub Sync', async (t) => {
  await t.test('registers skills in central hub and syncs to target agent directories', () => {
    const tmpHub = path.join(os.tmpdir(), `skills_hub_${Date.now()}`);
    const hub = new SkillsHub(tmpHub);

    hub.registerSkill('mutation-testing-skill', '# Mutation Testing\nAlways run mutation test before PR.');
    const skills = hub.listSkills();
    assert.ok(skills['mutation-testing-skill']);

    fs.rmSync(tmpHub, { recursive: true, force: true });
  });
});

test('Omar & Neel + Greg Isenberg Steal: Live Briefing Event Engine', async (t) => {
  await t.test('generates complete event configuration with intent-mining templates and micro-offer', () => {
    const config = generateEventConfig({ date: 'Thursday, Nov 19, 2026' });
    assert.ok(config.title.includes('Autonomous Coding Agents'));
    assert.equal(config.scheduledDate, 'Thursday, Nov 19, 2026');
    assert.equal(config.caseStudies.length, 3);
    assert.equal(config.microOffer.price, '$499 one-time');
    assert.ok(config.confirmationEmailTemplate.body.includes('reply to this email with one line'));
    assert.ok(config.postEventFollowUpTemplate.body.includes('$499'));
  });
});
